// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The open board: plain Excalidraw over the board file. It loads the file, autosaves your edits under the rev it
// read, and takes the drawer's answers live (registerLiveBoard), so an answer landing while you edit goes through
// updateScene instead of overwriting the file under you, and one Ctrl+Z takes the whole turn back. Excalidraw's
// runtime is ~2 MB, so it loads (React.lazy) only when a canvas first shows. It fills its nearest positioned ancestor.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./boardcanvas.css";
import { parseBoardFile, selectionLabel, serializeBoard, withReadableFont, type BoardScene } from "./boardmodel";
import { boardViewportAtom, loadBoardConvert, pointExcalidrawAtLocalFonts, registerLiveBoard } from "./boardstore";

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

export interface BoardSelection {
    ids: string[];
    label: string | null; // the first selected shape's text or label ("wavesrv and 2 more"); null with nothing selected
}

export interface BoardCanvasProps {
    project: string;
    boardId: string;
    // Show: selects exactly these shapes and scrolls to them. A new array re-applies, even with the same ids.
    highlightIds?: readonly string[] | null;
    onSelection?: (selection: BoardSelection) => void;
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

function OpenBoard({ project, boardId, highlightIds, onSelection }: BoardCanvasProps) {
    const [initial, setInitial] = useState<BoardScene | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    // the shapes Show last selected, for the DOM (and a scenario) to read back
    const [shown, setShown] = useState<string[]>([]);
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    // the file as last read or saved: its arc record, appState and files ride along with Excalidraw's elements
    const sceneRef = useRef<BoardScene | null>(null);
    const revRef = useRef("");
    const sigRef = useRef("");
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef<Promise<void>>(Promise.resolve());
    const selectionRef = useRef("");
    // the latest callback, so the long-lived handlers below never call a stale render's
    const onSelectionRef = useRef(onSelection);
    onSelectionRef.current = onSelection;
    // settles once the scene is in Excalidraw; an answer that arrives before then waits for it
    const readyRef = useRef<Deferred | null>(null);
    // a board opened for the first time is fitted to the canvas; one with a remembered view keeps it
    const fitOnOpenRef = useRef(globalStore.get(boardViewportAtom(boardId)) == null);
    // the file was opened in another face than it was saved in (withReadableFont), and is saved once refitted
    const turnedOnOpenRef = useRef(false);

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

    function show(ids: readonly string[]): void {
        const api = apiRef.current;
        if (api == null || excalidraw == null) {
            return;
        }
        const idSet = new Set(ids);
        const found = api.getSceneElements().filter((el) => idSet.has(el.id));
        api.updateScene({
            appState: {
                selectedElementIds: Object.fromEntries(found.map((el) => [el.id, true as const])),
                selectedGroupIds: {},
                editingGroupId: null,
            },
            captureUpdate: excalidraw.CaptureUpdateAction.NEVER,
        });
        if (found.length > 0) {
            api.scrollToContent(found, { animate: true });
        }
        setShown(found.map((el) => el.id));
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
            const { scene, shapeIds } = landAnswer(current(), answer, Date.now());
            api.updateScene({
                elements: scene.elements,
                captureUpdate: excalidraw.CaptureUpdateAction.IMMEDIATELY,
            });
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
                // a board drawn before its text had a face that shows it (Vietnamese in Excalifont) turns on opening
                const fonted = withReadableFont(parsed.elements, Date.now());
                const scene = { ...parsed, elements: fonted.elements };
                turnedOnOpenRef.current = fonted.changed.length > 0;
                if (cancelled) {
                    return;
                }
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

    // Show
    useEffect(() => {
        if (ready && highlightIds != null && highlightIds.length > 0) {
            show(highlightIds);
        }
    }, [ready, highlightIds]);

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
            sigRef.current = elementsSig(current().elements);
            // initialData's scrollToContent only centres at zoom 1: beside Chat a drawing wider than the half cell
            // would run off its edge. A smaller one stays at zoom 1 (maxZoom).
            const shapes = api.getSceneElements();
            if (fitOnOpenRef.current && shapes.length > 0) {
                api.scrollToContent(shapes, { fitToViewport: true, viewportZoomFactor: 0.9 });
            }
            fitOnOpenRef.current = false;
            readyRef.current?.resolve();
            setReady(true);
            refitText(turnedOnOpenRef.current).catch((e) =>
                console.warn("boards: refitting the text failed", boardId, e)
            );
        });
    }

    function onChange(elements: readonly ExcalidrawElement[], appState: AppState): void {
        const ids = selectedIds(appState);
        const selection = ids.join(",");
        if (selection !== selectionRef.current) {
            selectionRef.current = selection;
            onSelectionRef.current?.({ ids, label: selectionLabel(elements, ids) });
        }
        const vpAtom = boardViewportAtom(boardId);
        const vp = globalStore.get(vpAtom);
        if (vp?.scrollX !== appState.scrollX || vp?.scrollY !== appState.scrollY || vp?.zoom !== appState.zoom.value) {
            globalStore.set(vpAtom, {
                scrollX: appState.scrollX,
                scrollY: appState.scrollY,
                zoom: appState.zoom.value,
            });
        }
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
    const viewport = globalStore.get(boardViewportAtom(boardId));
    return (
        <div
            className="arc-board absolute inset-0"
            data-board-canvas={boardId}
            data-board-ready={ready ? "true" : "false"}
            data-board-highlight={shown.join(",")}
        >
            <Suspense fallback={null}>
                <LazyExcalidraw
                    excalidrawAPI={onApi}
                    onChange={onChange}
                    theme="dark"
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
        </div>
    );
}
