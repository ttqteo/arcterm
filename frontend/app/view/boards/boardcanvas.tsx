// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The open board: plain Excalidraw over the board file, in view mode (drags pan, nothing is drawn) unless the board's
// Edit switch is on (boardEditingAtom). It loads the file, autosaves your edits under the rev it read, and takes the
// drawer's answers live (registerLiveBoard), so an answer landing while you edit goes through updateScene instead of
// overwriting the file under you, and one Ctrl+Z takes the whole turn back. Excalidraw's runtime is ~2 MB, so it loads
// (React.lazy) only when a canvas first shows. It fills its nearest positioned ancestor.
// A sun/moon in its top-right corner turns every board light or dark (boardThemeAtom).
//
// A board is a row of drawings, each an Excalidraw frame (boarddrawings.ts). The canvas publishes the row, the drawing in
// view and the selection's drawing (boardDrawingsAtom), eases to a drawing the row picks (boardPickAtom), and follows
// the newest drawing: a new one landing while it is the one in view is fitted, else marked new in the row. A board
// drawn before drawings is wrapped in one "Earlier drawings" frame as it opens. The strip's Copy view, Export and
// Delete call this canvas directly (boardcommands.ts).
//
// A dense drawing fitted to the canvas shows its text at 6 or 7px, so it reads one part at a time (boardparts.ts): while
// the text is too small to read, the part under the pointer shows a Read label, and a click on it (or → and ←, or the
// header's stepper) eases the view to that part at a size its text reads at; Esc goes back to the whole drawing. A zoom
// of your own leaves the part.

import { pushToast } from "@/app/cockpit/notificationstore";
import { MOTION } from "@/app/element/motiontokens";
import { cubicBezier } from "@/app/element/pulse";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { arrayToBase64 } from "@/util/util";
import type { ExcalidrawElement, ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAtom, useAtomValue } from "jotai";
import { Moon, Sun } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import "./boardcanvas.css";
import {
    drawingAfterDelete,
    drawingIds,
    exportFileName,
    registerBoardCommands,
    setDeleted,
    type ExportKind,
} from "./boardcommands";
import {
    afterLanding,
    drawingInView,
    drawingShapes,
    drawingsOf,
    drawingViewport,
    isFollowing,
    rowState,
    stepDrawing,
    type Drawing,
} from "./boarddrawings";
import { parseBoardFile, serializeBoard, withReadableFont, wrapEarlier, type BoardScene } from "./boardmodel";
import {
    boardParts,
    lerpViewport,
    needsParts,
    partAt,
    partOnView,
    partViewport,
    READ_ZOOM,
    stepPart,
    viewToScene,
    type BoardPart,
    type PartElement,
    type Viewport,
} from "./boardparts";
import { copyBoardView } from "./boardshot";
import {
    boardDrawingsAtom,
    boardEditingAtom,
    boardPickAtom,
    boardThemeAtom,
    boardViewportAtom,
    loadBoardConvert,
    pointExcalidrawAtLocalFonts,
    registerLiveBoard,
    type BoardViewport,
} from "./boardstore";

const AUTOSAVE_MS = 500;
const SAVE_TRIES = 3;

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");

// set when the lazy chunk has loaded; read only once a canvas is ready, which is after it
let excalidraw: ExcalidrawModule | undefined;

const LazyExcalidraw = lazy(async () => {
    pointExcalidrawAtLocalFonts();
    const [mod] = await Promise.all([import("@excalidraw/excalidraw"), import("@excalidraw/excalidraw/index.css")]);
    excalidraw = mod;
    return { default: mod.Excalidraw };
});

export interface BoardCanvasProps {
    project: string;
    boardId: string;
    // the part being read (an index into the parts), null for the whole board; left out, the canvas keeps its own
    part?: number | null;
    onPart?: (part: number | null) => void;
    // the board's parts, again each time they change
    onParts?: (parts: BoardPart[]) => void;
}

const easeFluid = cubicBezier(...MOTION.easeFluid);

function reducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// the view as Excalidraw last reported it, for the part labels: a store of its own, so a pinch re-renders the labels
// and never the canvas
class ViewStore {
    vp: Viewport | null = null;
    private listeners = new Set<() => void>();
    set(vp: Viewport): void {
        if (this.vp?.zoom === vp.zoom && this.vp.scrollX === vp.scrollX && this.vp.scrollY === vp.scrollY) {
            return;
        }
        this.vp = vp;
        this.listeners.forEach((fn) => fn());
    }
    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    };
    get = (): Viewport | null => this.vp;
}

function partsKey(parts: readonly BoardPart[]): string {
    return parts
        .map((p) => [p.id, p.label, Math.round(p.x), Math.round(p.y), Math.round(p.w), Math.round(p.h)].join(":"))
        .join("|");
}

// changes when an element is added, removed or edited; Excalidraw bumps version on every edit
function elementsSig(elements: readonly ExcalidrawElement[]): string {
    let sum = 0;
    for (const el of elements) {
        sum += el.version;
    }
    return `${elements.length}:${sum}`;
}

function selectedIds(appState: AppState): string[] {
    return Object.entries(appState.selectedElementIds)
        .filter(([, on]) => on)
        .map(([id]) => id);
}

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
}

function deferred(): Deferred {
    let resolve: () => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    promise.catch(() => {});
    return { promise, resolve, reject };
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// one Excalidraw per board: it reads its initial scene once, so another board is a new canvas, not new props
export function BoardCanvas(props: BoardCanvasProps) {
    return <OpenBoard key={`${props.project}/${props.boardId}`} {...props} />;
}

function OpenBoard({ project, boardId, part: partProp, onPart, onParts }: BoardCanvasProps) {
    const [initial, setInitial] = useState<BoardScene | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [theme, setTheme] = useAtom(boardThemeAtom);
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    // the file as last read or saved: its arc record, appState and files ride along with Excalidraw's elements
    const sceneRef = useRef<BoardScene | null>(null);
    const revRef = useRef("");
    const sigRef = useRef("");
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef<Promise<void>>(Promise.resolve());
    const selectionRef = useRef("");
    // a shape is selected: Excalidraw's style panel is open in the top-left corner, where a part's Read label lands
    const [selecting, setSelecting] = useState(false);
    // settles once the scene is in Excalidraw; an answer that arrives before then waits for it
    const readyRef = useRef<Deferred | null>(null);
    // The Edit switch, shared by every view of the board: off, Excalidraw is in view mode (drags pan, nothing is drawn).
    const editing = useAtomValue(boardEditingAtom(boardId));
    const editingRef = useRef(editing);
    // the row this board's canvases publish: its drawing in view is on the root for the scenarios
    const row = useAtomValue(boardDrawingsAtom(boardId));
    // a pick in the drawings row; one made before this canvas opened is not for it
    const pick = useAtomValue(boardPickAtom(boardId));
    const seenPickRef = useRef(pick);
    // the wrapper, which Copy view reads Excalidraw's canvas from
    const rootRef = useRef<HTMLDivElement>(null);
    // How the board opens, set as the file loads: a board never opened here, or left following its newest drawing, is
    // fitted to that drawing (fitOnOpen, pending until the view has a size); any other returns to the view it was left in.
    const fitOnOpenRef = useRef(false);
    const startViewRef = useRef<BoardViewport | null>(null);
    // the first frame has placed the view where the board opens; until then a change publishes nothing
    const openedRef = useRef(false);
    // The file was changed on opening, so it is saved once refitted: opened in another face than it was saved in
    // (withReadableFont), or wrapped in an Earlier drawings frame (wrapEarlier).
    const changedOnOpenRef = useRef(false);
    // as of the last change that was not mid-ease: the drawing in view, and whether it is the newest
    const inViewRef = useRef<string | null>(null);
    const followingRef = useRef(true);
    const [parts, setParts] = useState<BoardPart[]>([]);
    const partsKeyRef = useRef("");
    // the canvas size the parts were last computed at: needsParts reads it, so a resize recomputes them (syncView)
    const partsSizeRef = useRef<{ width: number; height: number } | null>(null);
    const onPartsRef = useRef(onParts);
    onPartsRef.current = onParts;
    // controlled by the split's header; Library's canvas keeps its own
    const [ownPart, setOwnPart] = useState<number | null>(null);
    const part = onPart != null ? (partProp ?? null) : ownPart;
    const setPart = onPart ?? setOwnPart;
    const partRef = useRef(part);
    partRef.current = part;
    const views = useRef(new ViewStore()).current;
    // the zoom a part was opened at, and whether the view is easing there: a zoom of the person's own leaves the part
    const partZoomRef = useRef<number | null>(null);
    const easingRef = useRef<number | null>(null);
    // the part was left by a move of the view's own (a zoom of the person's, a fit to a drawing): the view stays where
    // that took it, no easing back to the whole drawing
    const leftByZoomRef = useRef(false);
    const prevPartRef = useRef<number | null>(null);

    const ref = { project, boardid: boardId };

    function current(): BoardScene {
        const api = apiRef.current;
        const scene = sceneRef.current;
        if (api == null || scene == null) {
            throw new Error("the board is not open");
        }
        return { ...scene, elements: api.getSceneElementsIncludingDeleted(), files: api.getFiles() as BinaryFiles };
    }

    // one save at a time, in order; the canvas holds your edits, so a conflict takes the file's new rev and
    // writes again rather than dropping them (every answer reaches an open board through this canvas)
    function save(): Promise<void> {
        const run = savingRef.current.then(async () => {
            const scene = current();
            sigRef.current = elementsSig(scene.elements);
            const data = serializeBoard(scene);
            for (let i = 0; i < SAVE_TRIES; i++) {
                const saved = await RpcApi.BoardSaveCommand(TabRpcClient, { ...ref, data, baserev: revRef.current });
                if (!saved?.conflict) {
                    revRef.current = saved?.rev ?? revRef.current;
                    return;
                }
                console.warn(
                    "boards: the board file changed under the open canvas; saving the canvas over it",
                    boardId
                );
                const read = await RpcApi.BoardReadCommand(TabRpcClient, ref);
                revRef.current = read.rev;
            }
            throw new Error(`the board changed under ${SAVE_TRIES} saves in a row`);
        });
        savingRef.current = run.catch(() => {});
        return run;
    }

    // the Nunito text measured again once its face has loaded (refitNunitoText), not as a step of its own to undo; the
    // version bump makes onChange save it. turnedOnOpen: the file was opened in another face, so save it either way.
    async function refitText(turnedOnOpen: boolean): Promise<void> {
        const api = apiRef.current;
        if (api == null || excalidraw == null) {
            return;
        }
        const { refitNunitoText } = await loadBoardConvert();
        const next = await refitNunitoText(api.getSceneElementsIncludingDeleted(), Date.now());
        if (apiRef.current !== api) {
            return;
        }
        if (next != null) {
            api.updateScene({ elements: next, captureUpdate: excalidraw.CaptureUpdateAction.NEVER });
        } else if (turnedOnOpen) {
            await save();
        }
    }

    // the parts are read inside the drawing in view; with none in view there are none. A new list closes the part that
    // was open, since its index may point past the list (or into an empty one); the view stays where it is.
    function updateParts(): void {
        const api = apiRef.current;
        if (api == null) {
            return;
        }
        const inView = inViewRef.current;
        const found =
            inView == null
                ? []
                : boardParts(drawingShapes(api.getSceneElements(), inView) as unknown as readonly PartElement[]);
        const st = api.getAppState();
        partsSizeRef.current = { width: st.width, height: st.height };
        const next = needsParts(found, st.width, st.height) ? found : [];
        const key = partsKey(next);
        if (key === partsKeyRef.current) {
            return;
        }
        partsKeyRef.current = key;
        closePart();
        setParts(next);
        onPartsRef.current?.(next);
    }

    function applyView(vp: Viewport, easing: boolean): void {
        const api = apiRef.current;
        if (api == null || excalidraw == null) {
            return;
        }
        api.updateScene({
            appState: {
                zoom: { value: vp.zoom } as AppState["zoom"],
                scrollX: vp.scrollX,
                scrollY: vp.scrollY,
                // while easing, the shapes are scaled from their cache and drawn sharp once at the end
                shouldCacheIgnoreZoom: easing,
            },
            captureUpdate: excalidraw.CaptureUpdateAction.NEVER,
        });
    }

    function stopEasing(): void {
        if (easingRef.current != null) {
            cancelAnimationFrame(easingRef.current);
            easingRef.current = null;
        }
    }

    // eases the view to a part over durMacro on the Fluid curve; reduced motion jumps there
    function easeTo(to: Viewport): void {
        const api = apiRef.current;
        if (api == null) {
            return;
        }
        stopEasing();
        const st = api.getAppState();
        const from: Viewport = { zoom: st.zoom.value, scrollX: st.scrollX, scrollY: st.scrollY };
        if (reducedMotion()) {
            applyView(to, false);
            return;
        }
        const start = performance.now();
        const ms = MOTION.durMacro * 1000;
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / ms);
            if (t >= 1) {
                easingRef.current = null;
                applyView(to, false);
                return;
            }
            applyView(lerpViewport(from, to, easeFluid(t), st.width, st.height), true);
            easingRef.current = requestAnimationFrame(step);
        };
        easingRef.current = requestAnimationFrame(step);
    }

    function wholeBoard(): void {
        const api = apiRef.current;
        if (api == null) {
            return;
        }
        stopEasing();
        const shapes = api.getSceneElements();
        if (shapes.length > 0) {
            api.scrollToContent(shapes, { fitToViewport: true, viewportZoomFactor: 0.9, animate: !reducedMotion() });
        }
    }

    // A fit to a drawing (a pick, a landing, the board opening) moves the view itself, so a part that was open closes and
    // the view stays where the fit put it.
    function closePart(): void {
        if (partRef.current == null) {
            return;
        }
        partZoomRef.current = null;
        leftByZoomRef.current = true;
        setPart(null);
    }

    // The view that shows a drawing whole, eased to (or jumped to when the board opens). A canvas with no size yet has
    // no view to fit: false, and the caller tries again at its next change.
    function fitDrawing(d: Drawing | undefined, jump: boolean): boolean {
        const api = apiRef.current;
        if (api == null || d == null) {
            return false;
        }
        const st = api.getAppState();
        if (st.width === 0 || st.height === 0) {
            return false;
        }
        closePart();
        const to = drawingViewport(d, st.width, st.height);
        if (jump) {
            stopEasing();
            applyView(to, false);
        } else {
            easeTo(to);
        }
        return true;
    }

    // leaving a part: back to the whole drawing in view, to the whole board only when none is
    function wholeDrawing(): void {
        const api = apiRef.current;
        if (api == null) {
            return;
        }
        const inView = drawingsOf(api.getSceneElements()).find((d) => d.id === inViewRef.current);
        if (!fitDrawing(inView, false)) {
            wholeBoard();
        }
    }

    // a board that opens fitted to its newest drawing is placed once its view has a size; the change that placing
    // causes publishes the row (syncView)
    function placeOpening(): void {
        const api = apiRef.current;
        if (api == null || !fitOnOpenRef.current) {
            return;
        }
        const newest = drawingsOf(api.getSceneElements()).at(-1);
        if (newest == null || fitDrawing(newest, true)) {
            fitOnOpenRef.current = false;
        }
    }

    // The drawings row, the drawing in view, the drawing the selection names and following, from the scene and view as
    // they are now: published only when something changed. Not mid-ease (the end of it publishes), and not on a view
    // with no size (a hidden canvas leaves them as the shown one set them).
    function syncView(elements: readonly ExcalidrawElement[], appState: AppState): void {
        if (!openedRef.current || easingRef.current != null || appState.width === 0 || appState.height === 0) {
            return;
        }
        if (fitOnOpenRef.current) {
            placeOpening();
            return;
        }
        const drawings = drawingsOf(elements);
        const inView = drawingInView(drawings, {
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom.value,
            width: appState.width,
            height: appState.height,
        });
        const following = isFollowing(drawings, inView);
        const drawingChanged = inView !== inViewRef.current;
        inViewRef.current = inView;
        followingRef.current = following;
        const vpAtom = boardViewportAtom(boardId);
        const vp = globalStore.get(vpAtom);
        if (
            vp?.scrollX !== appState.scrollX ||
            vp?.scrollY !== appState.scrollY ||
            vp?.zoom !== appState.zoom.value ||
            vp?.following !== following
        ) {
            globalStore.set(vpAtom, {
                scrollX: appState.scrollX,
                scrollY: appState.scrollY,
                zoom: appState.zoom.value,
                following,
            });
        }
        const rowAtom = boardDrawingsAtom(boardId);
        const prev = globalStore.get(rowAtom);
        const next = rowState(prev, drawings, inView);
        if (next !== prev) {
            globalStore.set(rowAtom, next);
        }
        const sized = partsSizeRef.current;
        if (drawingChanged) {
            // another drawing in view reads from its own parts; a part open in the one left is closed, the view stays
            closePart();
            updateParts();
        } else if (sized?.width !== appState.width || sized?.height !== appState.height) {
            // the canvas was resized (Expand or Collapse, the grid, the window): whether a drawing needs its parts
            // depends on the size it is read at
            updateParts();
        }
    }

    // a drawing that landed while the view was on an earlier one is marked new in the row
    function markFresh(id: string): void {
        globalStore.set(boardDrawingsAtom(boardId), (prev) =>
            prev == null || prev.fresh.includes(id) ? prev : { ...prev, fresh: [...prev.fresh, id] }
        );
    }

    // → and ← step through the parts of a dense drawing, else from drawing to drawing (stopping at either end, eased as a
    // pick in the row is); Esc goes back to the whole drawing. Only while nothing is selected or being written, with the
    // select or hand tool, so Excalidraw's own keys (nudging a selection, leaving a tool) stay its own
    function onKeyDownCapture(e: KeyboardEvent<HTMLDivElement>): void {
        const api = apiRef.current;
        if (api == null || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
            return;
        }
        const arrow = e.key === "ArrowRight" || e.key === "ArrowLeft";
        if (parts.length === 0 && !arrow) {
            return;
        }
        const target = e.target as HTMLElement;
        if (target.closest("input, textarea, [contenteditable='true']") != null) {
            return;
        }
        const st = api.getAppState();
        const idle =
            !Object.values(st.selectedElementIds).some(Boolean) &&
            st.editingTextElement == null &&
            (st.activeTool.type === "selection" || st.activeTool.type === "hand");
        if (!idle) {
            return;
        }
        if (parts.length === 0) {
            const to = stepDrawing(row?.drawings ?? [], row?.inView ?? null, e.key === "ArrowRight" ? 1 : -1);
            if (to == null) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            globalStore.set(boardPickAtom(boardId), { drawingId: to, ts: Date.now() });
            return;
        }
        let next: number | null | undefined;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            next = stepPart(parts.length, part, e.key === "ArrowRight" ? 1 : -1);
        } else if (e.key === "Escape" && part != null) {
            next = null;
        }
        if (next === undefined) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setPart(next);
    }

    useEffect(() => {
        let cancelled = false;
        const readyNow = deferred();
        readyRef.current = readyNow;
        // registered before the read, so no answer can reach the file between this read and the first save. The
        // whole answer is one updateScene, so one undo takes it back.
        const unregister = registerLiveBoard(project, boardId, async (answer) => {
            await readyNow.promise;
            const api = apiRef.current;
            if (api == null || excalidraw == null) {
                throw new Error("the board is not open");
            }
            const { landAnswer } = await loadBoardConvert();
            const before = current();
            // as the person left the view: landing a drawing changes which one is newest
            const beforeIds = drawingsOf(before.elements).map((d) => d.id);
            const following = followingRef.current;
            const inView = inViewRef.current;
            const { scene, shapeIds } = landAnswer(before, answer, Date.now());
            api.updateScene({
                elements: scene.elements,
                captureUpdate: excalidraw.CaptureUpdateAction.IMMEDIATELY,
            });
            // the view only moves (NEVER captured), so the landing stays one undo step
            const after = drawingsOf(scene.elements);
            const landed = afterLanding(beforeIds, following, inView, after, answer.drawingid);
            if (landed.fit != null) {
                const target = after.find((d) => d.id === landed.fit);
                fitDrawing(target, false);
            }
            if (landed.fresh != null) {
                markFresh(landed.fresh);
            }
            updateParts();
            await save();
            refitText(false).catch((e) => console.warn("boards: refitting the text failed", boardId, e));
            return shapeIds;
        });
        (async () => {
            try {
                const read = await RpcApi.BoardReadCommand(TabRpcClient, ref);
                if (read?.info?.loaderror) {
                    throw new Error(read.info.loaderror);
                }
                const parsed = parseBoardFile(read.data);
                // a board drawn before drawings is wrapped in one Earlier drawings frame; saved once the canvas has it
                const wrapped = wrapEarlier(parsed, Date.now());
                // a board drawn before its text had a face that shows it (Vietnamese in Excalifont) turns on opening
                const fonted = withReadableFont(wrapped.elements, Date.now());
                const scene = { ...wrapped, elements: fonted.elements };
                changedOnOpenRef.current = fonted.changed.length > 0 || wrapped !== parsed;
                if (cancelled) {
                    return;
                }
                const left = globalStore.get(boardViewportAtom(boardId));
                fitOnOpenRef.current =
                    drawingsOf(scene.elements).length > 0 && (left == null || left.following === true);
                startViewRef.current = fitOnOpenRef.current ? null : left;
                revRef.current = read.rev;
                sceneRef.current = scene;
                setInitial(scene);
            } catch (e) {
                readyNow.reject(e);
                if (!cancelled) {
                    setError(errorText(e));
                }
            }
        })();
        return () => {
            cancelled = true;
            if (timerRef.current != null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
                save().catch((e) => console.warn("boards: autosave failed", boardId, e));
            }
            unregister();
            apiRef.current = null;
            readyNow.reject(new Error("the board closed"));
        };
    }, [project, boardId]);

    // A trackpad pinch reaches WebKit (the Mac app) as gesture events, and Excalidraw's gesture path, unlike its wheel
    // and touch paths, never sets shouldCacheIgnoreZoom: every frame of the pinch drew each shape again at the new zoom,
    // so zooming stuttered. Held for the whole pinch, the cached shapes are scaled instead and drawn sharp once at its
    // end. Capture on document runs before Excalidraw's own listener there.
    useEffect(() => {
        if (!ready) {
            return;
        }
        let held = false;
        const hold = (on: boolean) => {
            const api = apiRef.current;
            if (api == null || excalidraw == null || held === on) {
                return;
            }
            held = on;
            api.updateScene({
                appState: { shouldCacheIgnoreZoom: on },
                captureUpdate: excalidraw.CaptureUpdateAction.NEVER,
            });
        };
        const start = () => hold(true);
        const end = () => hold(false);
        document.addEventListener("gesturestart", start, true);
        document.addEventListener("gestureend", end, true);
        return () => {
            document.removeEventListener("gesturestart", start, true);
            document.removeEventListener("gestureend", end, true);
        };
    }, [ready]);

    // the part to read: eased to when another is chosen; the whole drawing in view again when it closes. An edit that
    // reshapes the open part does not move the view under the pen.
    const partId = part != null ? (parts[part]?.id ?? null) : null;
    useEffect(() => {
        if (!ready) {
            return;
        }
        const prev = prevPartRef.current;
        prevPartRef.current = part;
        const api = apiRef.current;
        if (api == null) {
            return;
        }
        if (part == null) {
            partZoomRef.current = null;
            if (prev != null && !leftByZoomRef.current) {
                wholeDrawing();
            }
            leftByZoomRef.current = false;
            return;
        }
        const at = parts[part];
        if (at == null) {
            setPart(null);
            return;
        }
        const st = api.getAppState();
        const to = partViewport(at, st.width, st.height);
        partZoomRef.current = to.zoom;
        easeTo(to);
    }, [ready, part, partId]);

    useEffect(() => stopEasing, []);

    // turning Edit off leaves nothing selected and no tool armed (Excalidraw drops the selection itself when its mode
    // flips, but not the tool)
    useEffect(() => {
        const was = editingRef.current;
        editingRef.current = editing;
        const api = apiRef.current;
        if (!was || editing || api == null || excalidraw == null) {
            return;
        }
        api.setActiveTool({ type: "selection" });
        api.updateScene({
            appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null },
            captureUpdate: excalidraw.CaptureUpdateAction.NEVER,
        });
    }, [editing]);

    // a pick in the drawings row: the view eases to that drawing, whole (a part that was open closes)
    useEffect(() => {
        const api = apiRef.current;
        if (!ready || api == null || pick == null || pick === seenPickRef.current) {
            return;
        }
        seenPickRef.current = pick;
        const target = drawingsOf(api.getSceneElements()).find((d) => d.id === pick.drawingId);
        fitDrawing(target, false);
    }, [ready, pick]);

    // These shapes off the board as one undo step, saved, with a toast whose Undo brings them back (Ctrl+Z only reaches
    // Excalidraw in Edit). `moved` places the view once they are gone, `back` once Undo restored them.
    function deleteWithUndo(
        ids: ReadonlySet<string>,
        toast: { title: string; message: string },
        moved: () => void,
        back: () => void
    ): boolean {
        const api = apiRef.current;
        const mod = excalidraw;
        if (api == null || mod == null || ids.size === 0) {
            return false;
        }
        api.updateScene({
            elements: setDeleted(api.getSceneElementsIncludingDeleted(), ids, true, Date.now()),
            captureUpdate: mod.CaptureUpdateAction.IMMEDIATELY,
        });
        moved();
        save().catch((e) => console.warn("boards: saving the delete failed", boardId, e));
        pushToast({
            ...toast,
            level: "info",
            check: true,
            action: {
                label: "Undo",
                run: () => {
                    if (apiRef.current !== api) {
                        return;
                    }
                    api.updateScene({
                        elements: setDeleted(api.getSceneElementsIncludingDeleted(), ids, false, Date.now()),
                        captureUpdate: mod.CaptureUpdateAction.IMMEDIATELY,
                    });
                    back();
                    save().catch((e) => console.warn("boards: saving the undone delete failed", boardId, e));
                },
            },
        });
        return true;
    }

    // Delete on the strip: the drawing and everything in it, the view eased to the drawing before it
    function deleteDrawing(drawingId: string): boolean {
        const api = apiRef.current;
        if (api == null) {
            return false;
        }
        const before = api.getSceneElementsIncludingDeleted();
        const drawings = drawingsOf(before);
        const gone = drawings.find((d) => d.id === drawingId);
        if (gone == null) {
            return false;
        }
        return deleteWithUndo(
            drawingIds(before, drawingId),
            {
                title: "Drawing deleted",
                message: gone.title !== "" ? `${gone.n}. ${gone.title}` : `Drawing ${gone.n}`,
            },
            () => {
                fitDrawing(drawingAfterDelete(drawings, drawingId) ?? undefined, false);
                updateParts();
            },
            () => {
                fitDrawing(
                    drawingsOf(api.getSceneElements()).find((d) => d.id === drawingId),
                    false
                );
                updateParts();
            }
        );
    }

    // Delete on the header while a part is read: its shapes (boardparts.ts ids), the view back on the whole drawing
    function deletePart(p: BoardPart): boolean {
        const live = new Set(apiRef.current?.getSceneElements().map((el) => el.id) ?? []);
        const ids = new Set(p.ids.filter((id) => live.has(id)));
        const placeWhole = () => {
            closePart();
            updateParts();
            wholeDrawing();
        };
        return deleteWithUndo(ids, { title: "Part deleted", message: p.label }, placeWhole, placeWhole);
    }

    // Export on the strip: the drawing in view, cut to its frame, in the board's theme on its ground (PNG at twice its
    // size, SVG with its fonts inlined), to a file the person picks
    async function exportDrawing(drawingId: string, kind: ExportKind): Promise<string | null> {
        const api = apiRef.current;
        const mod = excalidraw;
        if (api == null || mod == null) {
            throw new Error("the board is not open");
        }
        const live = api.getSceneElements();
        const frame = live.find((el): el is ExcalidrawFrameElement => el.id === drawingId && el.type === "frame");
        const drawing = drawingsOf(live).find((d) => d.id === drawingId);
        if (frame == null || drawing == null) {
            throw new Error("that drawing is no longer on the board");
        }
        const { save: pickFile } = await import("@tauri-apps/plugin-dialog");
        const path = await pickFile({
            defaultPath: exportFileName(drawing, kind),
            filters: [{ name: kind === "png" ? "PNG image" : "SVG image", extensions: [kind] }],
        });
        if (path == null) {
            return null;
        }
        const elements = live.filter((el) => el.id === drawingId || el.frameId === drawingId);
        const files = api.getFiles() as BinaryFiles;
        const appState = {
            exportBackground: true,
            exportWithDarkMode: theme === "dark",
            viewBackgroundColor: "#ffffff",
        };
        let bytes: Uint8Array;
        if (kind === "png") {
            const blob = await mod.exportToBlob({
                elements,
                files,
                appState,
                exportingFrame: frame,
                mimeType: "image/png",
                getDimensions: (width, height) => ({ width: width * 2, height: height * 2, scale: 2 }),
            });
            bytes = new Uint8Array(await blob.arrayBuffer());
        } else {
            const svg = await mod.exportToSvg({ elements, files, appState, exportingFrame: frame });
            bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
        }
        await RpcApi.FileWriteCommand(TabRpcClient, { info: { path }, data64: arrayToBase64(bytes) });
        return path;
    }

    // the strip's Copy view, Export and Delete, answered by this canvas while it is the newest of its board's
    useEffect(() => {
        if (!ready) {
            return;
        }
        return registerBoardCommands(boardId, {
            copyView: () => {
                const root = rootRef.current;
                return root == null ? Promise.reject(new Error("the board is not open")) : copyBoardView(root);
            },
            exportDrawing,
            deleteDrawing,
            deletePart,
        });
    }, [ready, boardId, theme]);

    function onApi(api: ExcalidrawImperativeAPI): void {
        apiRef.current = api;
        if (sceneRef.current == null) {
            return;
        }
        // Excalidraw hands the api over before it has restored the initial scene
        requestAnimationFrame(() => {
            if (apiRef.current !== api) {
                return;
            }
            const scene = current();
            sigRef.current = elementsSig(scene.elements);
            const st = api.getAppState();
            views.set({ zoom: st.zoom.value, scrollX: st.scrollX, scrollY: st.scrollY });
            // places the view where the board opens (initialData's scrollToContent only centres at zoom 1, so a drawing
            // wider than the half cell would run off its edge) and publishes the row
            openedRef.current = true;
            syncView(scene.elements, st);
            readyRef.current?.resolve();
            setReady(true);
            refitText(changedOnOpenRef.current).catch((e) =>
                console.warn("boards: refitting the text failed", boardId, e)
            );
        });
    }

    function onChange(elements: readonly ExcalidrawElement[], appState: AppState): void {
        const ids = selectedIds(appState);
        const selection = ids.join(",");
        if (selection !== selectionRef.current) {
            selectionRef.current = selection;
            setSelecting(ids.length > 0);
        }
        views.set({ zoom: appState.zoom.value, scrollX: appState.scrollX, scrollY: appState.scrollY });
        // a zoom of the person's own (a pinch, the + and −) leaves the part; a scroll reads on through it
        const partZoom = partZoomRef.current;
        if (
            partRef.current != null &&
            easingRef.current == null &&
            partZoom != null &&
            Math.abs(appState.zoom.value - partZoom) > 0.01
        ) {
            partZoomRef.current = null;
            leftByZoomRef.current = true;
            setPart(null);
        }
        syncView(elements, appState);
        const sig = elementsSig(elements);
        if (sigRef.current === "" || sig === sigRef.current || sceneRef.current == null) {
            sigRef.current = sigRef.current || sig;
            return;
        }
        sigRef.current = sig;
        if (timerRef.current != null) {
            clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            updateParts();
            save().catch((e) => console.warn("boards: autosave failed", boardId, e));
        }, AUTOSAVE_MS);
    }

    if (error != null) {
        return (
            <div
                className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-muted"
                data-board-error={boardId}
            >
                This board won't open: {error}
            </div>
        );
    }
    if (initial == null) {
        return null;
    }
    const viewport = startViewRef.current;
    return (
        <div
            ref={rootRef}
            className="arc-board absolute inset-0 overflow-hidden"
            data-board-canvas={boardId}
            data-board-ready={ready ? "true" : "false"}
            data-board-view-mode={editing ? "false" : "true"}
            data-board-in-view={row?.inView ?? ""}
            data-board-parts={parts.length}
            data-board-part={part ?? ""}
            onKeyDownCapture={onKeyDownCapture}
        >
            <Suspense fallback={null}>
                <LazyExcalidraw
                    excalidrawAPI={onApi}
                    onChange={onChange}
                    theme={theme}
                    // controlled, so only the Edit switch changes it (Excalidraw's own toggle is off)
                    viewModeEnabled={!editing}
                    initialData={{
                        elements: initial.elements as ExcalidrawElement[],
                        files: initial.files as BinaryFiles,
                        appState: {
                            // transparent: the dark theme inverts the canvas's own colour, so the board's `background`
                            // comes from boardcanvas.css instead
                            viewBackgroundColor: "transparent",
                            ...(viewport != null
                                ? {
                                      scrollX: viewport.scrollX,
                                      scrollY: viewport.scrollY,
                                      zoom: { value: viewport.zoom },
                                  }
                                : {}),
                        } as Partial<AppState>,
                        scrollToContent: viewport == null,
                    }}
                    UIOptions={{
                        canvasActions: {
                            changeViewBackgroundColor: false,
                            clearCanvas: false,
                            export: false,
                            loadScene: false,
                            saveToActiveFile: false,
                            saveAsImage: false,
                            toggleTheme: false,
                        },
                    }}
                />
            </Suspense>
            <button
                type="button"
                data-board-theme={theme}
                aria-label={theme === "dark" ? "Light board" : "Dark board"}
                title={theme === "dark" ? "Light board" : "Dark board"}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border border-edge-mid bg-surface-raised text-muted shadow-popover-line hover:bg-surface-hover hover:text-primary"
            >
                {theme === "dark" ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
            </button>
            {ready && part == null && !selecting ? <PartHover parts={parts} views={views} onPick={setPart} /> : null}
        </div>
    );
}

// While the board is too small to read, the part under the pointer gets a dashed outline and one label, Read <name>,
// inside its top-left corner (below the toolbar when its top is off the view); a click on the label opens it. One label
// at a time, so nothing piles up, and none while a button is held (drawing, dragging). It follows every pan and pinch
// through the view store, without re-rendering the canvas. Only the drawing itself (Excalidraw's canvas) or the label
// counts as over a part: over the toolbar, the zoom buttons or a shape's style panel the label would cover the control.
// While a shape is selected there is no label at all (BoardCanvas), as its style panel holds the corner it clamps to.
function PartHover({
    parts,
    views,
    onPick,
}: {
    parts: readonly BoardPart[];
    views: ViewStore;
    onPick: (part: number) => void;
}) {
    const vp = useSyncExternalStore(views.subscribe, views.get);
    const root = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<number | null>(null);
    const small = vp != null && parts.length > 0 && vp.zoom < READ_ZOOM * 0.95;
    useEffect(() => {
        const wrap = root.current?.parentElement;
        if (wrap == null || !small) {
            setHover(null);
            return;
        }
        const onMove = (e: PointerEvent) => {
            const at = views.get();
            const onDrawing =
                e.target instanceof HTMLCanvasElement ||
                (e.target instanceof Node && root.current?.contains(e.target) === true);
            if (at == null || e.buttons !== 0 || !onDrawing) {
                setHover(null);
                return;
            }
            const r = wrap.getBoundingClientRect();
            const p = viewToScene(at, e.clientX - r.left, e.clientY - r.top);
            setHover(partAt(parts, p.x, p.y));
        };
        const onLeave = () => setHover(null);
        wrap.addEventListener("pointermove", onMove, { passive: true });
        wrap.addEventListener("pointerleave", onLeave);
        return () => {
            wrap.removeEventListener("pointermove", onMove);
            wrap.removeEventListener("pointerleave", onLeave);
        };
    }, [parts, views, small]);
    const p = hover != null ? parts[hover] : undefined;
    const outline = small && p != null && vp != null ? partOnView(p, vp) : null;
    return (
        <div ref={root} data-board-part-hover-layer className="pointer-events-none absolute inset-0 z-[5]">
            {outline != null && hover != null ? (
                <>
                    <div
                        aria-hidden
                        className="absolute rounded-[8px] border-2 border-dashed border-ink-mid"
                        style={{
                            left: outline.left - 8,
                            top: outline.top - 8,
                            width: outline.width + 16,
                            height: outline.height + 16,
                        }}
                    />
                    <button
                        type="button"
                        data-board-part-hover={hover}
                        title="Read this part (→ ← step through them, Esc for the whole drawing)"
                        onClick={() => onPick(hover)}
                        className="pointer-events-auto absolute max-w-[240px] cursor-pointer truncate rounded-full border border-edge-mid bg-surface-raised px-2 py-0.5 text-[11.5px] text-secondary shadow-popover-line hover:bg-surface-hover hover:text-primary"
                        style={{ left: Math.max(8, outline.left), top: Math.max(64, outline.top + 4) }}
                    >
                        Read <span className="text-primary">{p!.label}</span>
                    </button>
                </>
            ) : null}
        </div>
    );
}
