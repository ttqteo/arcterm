// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Agent → Canvases (agentcenter.ts' `canvases` mode): every registered project's design canvases as a grid of cards with
// a cached preview, and a viewer that opens one canvas a board at a time. Thin: grouping, search and the card text come
// from canvasgallery.ts, the place and the list from canvasgallerystore.ts, the board frame from canvaspane.tsx. The
// keys are buildAgentBindings' (the arrows, Enter, `/`, `[` `]`, Escape), so this file holds no key handler but the
// search box's own.

import { Skeleton, SkeletonLine } from "@/app/element/skeleton";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowLeft, LayoutGrid, Search } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { changedLine } from "./canvascursor";
import { boardCountLabel, cardMeta, type GalleryCanvas } from "./canvasgallery";
import {
    canvasBase,
    canvasGalleryAtom,
    canvasListAtom,
    canvasListErrorAtom,
    closeCanvas,
    galleryGroups,
    loadCanvases,
    openCanvas,
    openCursorCanvas,
    setGalleryQuery,
    setViewerBoard,
    startCleanup,
    stepViewerBoard,
} from "./canvasgallerystore";
import {
    boardUrl,
    CANVAS_POLL_MS,
    canvasLayout,
    DEFAULT_BOARD_H,
    DEFAULT_BOARD_W,
    paneState,
    type CanvasBoard,
} from "./canvasmodel";
import { BoardFrameView, CANVAS_TOP_PAD, EdgeState, Removed, ServerDown, StepButton } from "./canvaspane";
import { pollCanvasOnce, tauriCanvasIO, type CanvasIO } from "./canvaspoller";
import type { CanvasState } from "./canvasstore";
import { maybeCaptureThumb, tauriThumbIO } from "./canvasthumb";
import { formatSize } from "./storagemodel";
import { SWAP_BTN } from "./swapbar";

const BOARD_EXT = ".dc.html";

const KBD = "rounded-[4px] border border-edge-mid px-1 font-mono text-[10px] font-normal text-muted";

function Kbd({ children }: { children: ReactNode }) {
    return <kbd className={KBD}>{children}</kbd>;
}

export function CanvasGallery({ model }: { model: AgentsViewModel }) {
    const g = useAtomValue(canvasGalleryAtom);
    const list = useAtomValue(canvasListAtom);
    const open = g.view === "viewer" ? (list?.find((c) => c.dir === g.dir) ?? null) : null;
    // the place survives a surface switch, the list's canvas may not: a viewer restored with no list reads it, and one
    // whose canvas the list no longer holds goes back to the grid
    useEffect(() => {
        if (g.view !== "viewer") {
            return;
        }
        if (list == null) {
            void loadCanvases();
        } else if (open == null) {
            closeCanvas();
        }
    }, [g.view, list, open]);
    if (g.view === "viewer") {
        return open != null ? <CanvasViewer key={open.dir} model={model} canvas={open} /> : <GridSkeleton />;
    }
    return <CanvasGrid model={model} />;
}

// where each design folder is served, for the cards that have a preview to show; a card draws its placeholder until
// its folder answers
function useCanvasBases(list: GalleryCanvas[] | null): Map<string, string> {
    const [bases, setBases] = useState<Map<string, string>>(() => new Map());
    const dirs = [...new Set((list ?? []).filter((c) => c.thumbts > 0).map((c) => c.designdir))].sort().join("\n");
    useEffect(() => {
        let live = true;
        for (const dir of dirs.split("\n").filter(Boolean)) {
            void canvasBase(dir).then((base) => {
                if (live && base != null) {
                    setBases((cur) => (cur.has(dir) ? cur : new Map(cur).set(dir, base)));
                }
            });
        }
        return () => {
            live = false;
        };
    }, [dirs]);
    return bases;
}

function GridSkeleton() {
    return (
        <div
            aria-hidden="true"
            className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 px-[24px] pt-[24px]"
        >
            {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                    <Skeleton className="aspect-[16/10] w-full rounded-lg" />
                    <SkeletonLine className="h-[13px] w-2/3" />
                    <SkeletonLine className="h-[11px] w-1/3" />
                </div>
            ))}
        </div>
    );
}

function CanvasGrid({ model }: { model: AgentsViewModel }) {
    const g = useAtomValue(canvasGalleryAtom);
    const list = useAtomValue(canvasListAtom);
    const error = useAtomValue(canvasListErrorAtom);
    const now = useAtomValue(model.nowAtom);
    const bases = useCanvasBases(list);
    const scrollRef = useRef<HTMLDivElement>(null);
    // on mount, so coming back from the viewer shows a preview it just took
    useEffect(() => {
        void loadCanvases();
    }, []);

    const groups = galleryGroups(list, g.query, now);
    const shown = groups.reduce((n, grp) => n + grp.items.length, 0);
    const cursor = Math.min(Math.max(0, g.cursor), shown - 1);
    useEffect(() => {
        scrollRef.current?.querySelector("[data-cursor]")?.scrollIntoView({ block: "nearest" });
    }, [cursor, shown]);

    const has = list != null && list.length > 0;
    const totalBytes = (list ?? []).reduce((n, c) => n + c.bytes, 0);
    const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") {
            // a first Escape empties the box, the next gives the keys back to the grid
            e.preventDefault();
            if (g.query !== "") {
                setGalleryQuery("");
            } else {
                e.currentTarget.blur();
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            openCursorCanvas(now);
        }
    };

    let index = 0;
    return (
        <div data-canvas-gallery className="flex min-h-0 flex-1 flex-col bg-background">
            <div className="flex flex-none items-center gap-[10px] border-b border-border px-[24px] pb-[14px] pt-[18px]">
                <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-primary">Canvases</h1>
                {list != null ? (
                    <span
                        data-canvas-gallery-count
                        className="inline-flex flex-none items-center rounded-full bg-pill px-[9px] py-[3px] text-[10.5px] tabular-nums text-secondary"
                    >
                        {has ? `${list.length} · ${formatSize(totalBytes)}` : "0"}
                    </span>
                ) : null}
                <div className="flex-1" />
                {has ? (
                    <>
                        <button type="button" data-canvas-cleanup-open onClick={startCleanup} className={SWAP_BTN}>
                            Clean up
                        </button>
                        <label className="flex h-[28px] w-[240px] flex-none items-center gap-2 rounded-[6px] border border-edge-mid bg-surface-raised pl-[10px] pr-2 focus-within:border-edge-strong">
                            <Search size={13} strokeWidth={1.8} className="flex-none text-muted" aria-hidden />
                            <input
                                data-canvas-gallery-search
                                aria-label="Search canvases"
                                placeholder="Search topics, boards, projects"
                                value={g.query}
                                onChange={(e) => setGalleryQuery(e.target.value)}
                                onKeyDown={onSearchKey}
                                className="min-w-0 flex-1 bg-transparent text-[12px] text-primary outline-none placeholder:text-muted"
                            />
                            <Kbd>/</Kbd>
                        </label>
                    </>
                ) : null}
            </div>
            {list == null ? (
                error != null ? (
                    <EdgeState>
                        <span className="text-[13.5px] font-semibold text-primary">Could not read the canvases</span>
                        <span className="max-w-[420px] text-[12.5px] text-error">{error}</span>
                        <button type="button" onClick={() => void loadCanvases()} className={SWAP_BTN}>
                            Try again
                        </button>
                    </EdgeState>
                ) : (
                    <GridSkeleton />
                )
            ) : !has ? (
                <div
                    data-canvas-gallery-empty="none"
                    className="flex flex-1 flex-col items-center justify-center gap-2 px-12 text-center"
                >
                    <LayoutGrid size={28} strokeWidth={1.6} className="text-ink-faint" aria-hidden />
                    <span className="text-[13.5px] font-semibold text-primary">No canvases yet</span>
                    <span className="max-w-[380px] text-[12.5px] leading-[1.5] text-muted">
                        An agent draws one when you ask it for a mockup (the design-local skill). Every canvas in your
                        projects shows up here, and stays until you delete it.
                    </span>
                </div>
            ) : shown === 0 ? (
                <div
                    data-canvas-gallery-empty="search"
                    className="flex flex-1 flex-col items-center justify-center gap-2 px-12 text-center"
                >
                    <span className="text-[13.5px] font-semibold text-primary">
                        No canvas matches “{g.query.trim()}”
                    </span>
                    <span className="text-[12.5px] text-muted">
                        The search reads topic, board and project names.{" "}
                        <button
                            type="button"
                            onClick={() => setGalleryQuery("")}
                            className="cursor-pointer text-accent hover:text-accenthover"
                        >
                            Clear the search
                        </button>
                    </span>
                </div>
            ) : (
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[40px] pt-[6px]">
                    {groups.map((grp) => (
                        <div key={grp.key} data-canvas-group={grp.key}>
                            <div className="flex items-center gap-[10px] px-[2px] pb-[10px] pt-[18px]">
                                <span className={cn(REGION_LABEL, "text-muted")}>{grp.label}</span>
                                <div className="h-px flex-1 bg-edge-faint" />
                                <span className="text-[10.5px] tabular-nums text-muted">{grp.items.length}</span>
                            </div>
                            <div
                                data-canvas-grid
                                className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
                            >
                                {grp.items.map((c) => {
                                    const at = index++;
                                    return (
                                        <CanvasCard
                                            key={c.dir}
                                            canvas={c}
                                            base={bases.get(c.designdir)}
                                            now={now}
                                            cursor={at === cursor}
                                            onOpen={() => openCanvas(c.dir, at)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <div className="mt-[28px] flex items-center gap-[14px] text-[11.5px] text-muted">
                        <span>
                            <Kbd>←↑↓→</Kbd> move
                        </span>
                        <span>
                            <Kbd>Enter</Kbd> open
                        </span>
                        <span>
                            <Kbd>/</Kbd> search
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

function CanvasCard({
    canvas: c,
    base,
    now,
    cursor,
    onOpen,
}: {
    canvas: GalleryCanvas;
    base: string | undefined;
    now: number;
    cursor: boolean;
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            data-canvas-card={c.topic}
            data-cursor={cursor ? "" : undefined}
            title={c.topic}
            onClick={onOpen}
            className={cn(
                "flex cursor-pointer flex-col overflow-hidden rounded-lg border border-edge-mid bg-surface-raised text-left hover:border-edge-strong",
                cursor && "ring-2 ring-accent"
            )}
        >
            <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-edge-mid bg-surface-code">
                <CardPreview canvas={c} base={base} />
                <span className="absolute bottom-2 right-2 rounded-full bg-background/85 px-[7px] py-[2px] text-[10.5px] tabular-nums text-secondary">
                    {boardCountLabel(c.boards.length)}
                </span>
            </div>
            <div className="flex min-w-0 flex-col gap-[3px] px-3 pb-[11px] pt-[10px]">
                <span className="truncate text-[13px] font-semibold text-primary">{c.topic}</span>
                <span className="truncate text-[11.5px] tabular-nums text-muted">{cardMeta(c, now)}</span>
            </div>
        </button>
    );
}

// the cached preview, else the board names and when it gets taken. A preview that fails to load (the file went with a
// clean, or the folder is not served yet) is the same card
function CardPreview({ canvas: c, base }: { canvas: GalleryCanvas; base: string | undefined }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        setFailed(false);
    }, [c.thumbts]);
    // a preview whose folder has not answered yet is blank, not "no preview yet"
    if (c.thumbts > 0 && base == null) {
        return null;
    }
    if (c.thumbts > 0 && base != null && !failed) {
        return (
            <img
                loading="lazy"
                alt=""
                draggable={false}
                src={`${base}/${encodeURIComponent(c.topic)}/thumb.png?v=${c.thumbts}`}
                onError={() => setFailed(true)}
                className="h-full w-full object-cover object-top"
            />
        );
    }
    return (
        <div className="absolute inset-0 flex flex-col justify-center gap-1 px-4 py-[14px]">
            {c.boards.slice(0, 4).map((b) => (
                <span key={b} className="truncate text-[11px] text-muted">
                    {b}
                </span>
            ))}
            <span className="mt-[6px] text-[10.5px] text-ink-faint">
                No preview yet: it is taken the first time you open it
            </span>
        </div>
    );
}

function viewerState(c: GalleryCanvas): CanvasState {
    return {
        topic: c.topic,
        dir: c.dir,
        projectDir: c.project,
        mode: "canvas",
        board: null,
        all: false,
        boards: [],
        base: null,
        status: "probing",
        lastModifiedMs: null,
        lastViewedMs: Date.now(),
        marking: false,
        marks: [],
        reloadKey: 0,
    };
}

// the pane's poll, minus its per-agent atoms: it asks wavesrv to serve the folder, reads canvas.json, notices a folder
// that is gone, and reloads the board when a file changes. The base comes from the gallery's own cache
const viewerIO: CanvasIO = { ...tauriCanvasIO, serve: canvasBase };

function useViewerState(c: GalleryCanvas): CanvasState {
    const [s, setS] = useState(() => viewerState(c));
    const latest = useRef(s);
    latest.current = s;
    useEffect(() => {
        let live = true;
        let busy = false;
        // a poll can outlast the interval, so ticks never stack
        const tick = () => {
            if (!live || busy) {
                return;
            }
            busy = true;
            pollCanvasOnce(latest.current, viewerIO, Date.now())
                .then((patch) => {
                    if (live) {
                        setS((cur) => ({ ...cur, ...patch }));
                    }
                })
                .catch((e) => console.debug("canvas viewer poll failed", c.dir, e))
                .finally(() => (busy = false));
        };
        tick();
        const t = setInterval(tick, CANVAS_POLL_MS);
        return () => {
            live = false;
            clearInterval(t);
        };
    }, [c.dir]);
    return s;
}

function CanvasViewer({ model, canvas }: { model: AgentsViewModel; canvas: GalleryCanvas }) {
    const g = useAtomValue(canvasGalleryAtom);
    const now = useAtomValue(model.nowAtom);
    const s = useViewerState(canvas);
    const [measureRef, scrollRef, rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const tabsRef = useRef<HTMLDivElement>(null);
    const at = Math.min(Math.max(0, g.board), canvas.boards.length - 1);
    const name = canvas.boards[at];
    const file = name != null ? name + BOARD_EXT : null;
    const pane = canvas.boards.length === 0 && paneState(s) === "board" ? "empty" : paneState(s);
    // the scan names the boards that exist; canvas.json, once read, gives each its size
    const board: CanvasBoard | null =
        file == null
            ? null
            : (s.boards.find((b) => b.name === file) ?? {
                  name: file,
                  x: 0,
                  y: 0,
                  w: DEFAULT_BOARD_W,
                  h: DEFAULT_BOARD_H,
              });
    const layout = canvasLayout(board != null ? [board] : [], rect?.width ?? 0);
    useEffect(() => {
        tabsRef.current
            ?.querySelector('[aria-selected="true"]')
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (scrollRef.current != null) {
            scrollRef.current.scrollTop = 0;
        }
    }, [at]);

    return (
        <div data-canvas-viewer className="flex min-h-0 flex-1 flex-col bg-background">
            <div className="flex flex-none items-center gap-[10px] border-b border-border px-[20px] pb-3 pt-[14px]">
                <button
                    type="button"
                    data-canvas-viewer-back
                    title="Back to canvases (Esc)"
                    aria-label="Back to canvases (Esc)"
                    onClick={closeCanvas}
                    className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary"
                >
                    <ArrowLeft size={16} strokeWidth={1.8} aria-hidden />
                </button>
                <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-primary">
                    {canvas.topic}
                </h1>
                <span className="flex-none whitespace-nowrap text-[12px] text-muted">{changedLine(canvas, now)}</span>
                <div className="flex-1" />
                {canvas.boards.length > 0 ? (
                    <>
                        <StepButton dir="prev" keysHint="arrows" onStep={stepViewerBoard} />
                        <div
                            ref={tabsRef}
                            role="tablist"
                            aria-label="Boards"
                            className="flex min-w-0 flex-initial gap-[2px] overflow-x-auto rounded-xl border border-edge-faint bg-surface-raised p-[2px] [scrollbar-width:none]"
                        >
                            {canvas.boards.map((b, i) => (
                                <button
                                    key={b}
                                    type="button"
                                    role="tab"
                                    aria-selected={i === at}
                                    data-canvas-viewer-tab={b}
                                    onClick={() => setViewerBoard(i)}
                                    className={cn(
                                        "flex-none cursor-pointer rounded-[10px] border-0 px-[11px] py-1 text-[12px]",
                                        i === at
                                            ? "bg-surface-selected text-primary"
                                            : "bg-transparent text-muted hover:text-secondary"
                                    )}
                                >
                                    {b}
                                </button>
                            ))}
                        </div>
                        <StepButton dir="next" keysHint="arrows" onStep={stepViewerBoard} />
                    </>
                ) : null}
            </div>
            <div data-canvas-viewer-state={pane} className="flex min-h-0 flex-1 flex-col bg-surface-code">
                {pane === "server-down" ? (
                    <ServerDown />
                ) : pane === "removed" ? (
                    <Removed
                        topic={canvas.topic}
                        after="Go back to the canvases: the list is read again when it opens."
                    >
                        <button type="button" onClick={closeCanvas} className={cn("mt-[4px]", SWAP_BTN)}>
                            Back to canvases
                        </button>
                    </Removed>
                ) : pane === "empty" ? (
                    <EdgeState>
                        <span className="text-[14px] font-semibold text-primary">{canvas.topic} has no boards yet</span>
                    </EdgeState>
                ) : pane === "probing" ? (
                    <div className="p-[24px]">
                        <Skeleton className="aspect-[16/10] w-full rounded-lg" />
                    </div>
                ) : (
                    // the board at its full size, scaled to the pane's width and scrolled here, as the agent's canvas pane
                    // draws it. The gutter is reserved so a scrollbar appearing can't narrow the pane and change the scale
                    <div
                        ref={measureRef}
                        data-canvas-viewer-scroll
                        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[24px] pb-[24px] [scrollbar-gutter:stable]"
                        style={{ paddingTop: CANVAS_TOP_PAD }}
                    >
                        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
                            {layout.frames.map((f) => (
                                <BoardFrameView
                                    key={f.board.name}
                                    frame={f}
                                    selected
                                    tile={false}
                                    src={s.base != null ? boardUrl(s.base, s.topic, f.board.name) : null}
                                    reloadKey={s.reloadKey}
                                    onOpen={() => {}}
                                    onSettled={(el) =>
                                        void maybeCaptureThumb(tauriThumbIO, {
                                            topicDir: canvas.dir,
                                            boardEl: el,
                                            modts: canvas.modts,
                                        })
                                    }
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="flex flex-none items-center gap-[14px] border-t border-border px-[20px] py-2 text-[11.5px] text-muted">
                {board != null ? (
                    <span className="tabular-nums">
                        {board.name} · {board.w} × {board.h}
                    </span>
                ) : null}
                <div className="flex-1" />
                <span className="flex items-center gap-1">
                    <Kbd>←</Kbd>
                    <Kbd>→</Kbd> boards
                </span>
                <span className="flex items-center gap-1">
                    <Kbd>Esc</Kbd> back to canvases
                </span>
            </div>
        </div>
    );
}
