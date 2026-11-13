// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agent's design-local canvas, shown on the Agent surface in place of its (still mounted, hidden) terminal.
// Thin: what it shows comes from canvasmodel/canvasmarks, and what it knows comes from the agent's canvas state,
// which useCanvasPoller keeps current.

import { pushToast } from "@/app/cockpit/notificationstore";
import { COPY_HOLD_MS } from "@/app/element/copyfeedback";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/app/store/global";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, SquareCheck, SquareDashed } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { copyBoardShot, tauriCopyShotIO } from "./canvascopy";
import { MarkLayer, MarkTray } from "./canvasmarking";
import {
    ALL_TAB,
    boardLabel,
    boardUrl,
    buildGoal,
    canvasHeightReport,
    canvasLayout,
    canvasTabs,
    currentTab,
    paneState,
    prototypePath,
    shownBoard,
    shownBoards,
    steadyFitWidth,
    stepKeys,
    stripWindow,
    tabsFitStrip,
    updatedAgo,
    withContentHeights,
    type BoardFrame,
    type CanvasBoard,
} from "./canvasmodel";
import {
    canvasStateAtom,
    detachCanvas,
    selectCanvasTab,
    setMarking,
    stepCanvasBoard,
    type CanvasState,
} from "./canvasstore";
import { maybeCaptureThumb, tauriThumbIO, THUMB_SETTLE_MS } from "./canvasthumb";
import { openLauncher } from "./launcherstore";
import { SWAP_BAR, SWAP_BTN, SWAP_BTN_ON, SWAP_LABEL, SWAP_PRIMARY_BTN, SwapTabs } from "./swapbar";

// room above a board's frame for its label; the scroll pane's top padding
export const CANVAS_TOP_PAD = 36;
const LABEL_OFFSET = 22;
// the label row's right end, kept for the Copy screenshot button
const COPY_ROOM = 84;

// the scroll pane's measured width, held through a wobble of a few pixels so the fitted board does not flicker
// (steadyFitWidth); set during render, so the held width lands in the same commit as the measurement
export function useSteadyFitWidth(measured: number): number {
    const [held, setHeld] = useState<number | null>(null);
    const fit = steadyFitWidth(held, measured);
    if (fit !== held) {
        setHeld(fit);
    }
    return fit;
}

// The heights the boards' pages reported (BoardFrameView's onContentHeight), dropped when resetKey changes: a reloaded
// page, edited shorter, reports from the h canvas.json gives it again, not from the frame its old self grew
export function useContentHeights(
    resetKey: string
): [Readonly<Record<string, number>>, (board: string, h: number) => void] {
    const [kept, setKept] = useState<{ key: string; heights: Record<string, number> }>({ key: resetKey, heights: {} });
    const heights = kept.key === resetKey ? kept.heights : {};
    const report = useCallback(
        (board: string, h: number) =>
            setKept((k) => {
                const prev = k.key === resetKey ? k.heights : {};
                return prev[board] === h ? k : { key: resetKey, heights: { ...prev, [board]: h } };
            }),
        [resetKey]
    );
    return [heights, report];
}

// the New dialog opens on Orchestrate in the agent's project, with this canvas as the run's prototype
function openBuildRun(model: AgentsViewModel, agent: AgentVM, s: CanvasState): void {
    openLauncher(model, "run", {
        projectName: projectOf(agent),
        goal: buildGoal(s.dir, shownBoards(s)),
        shape: "orchestrator",
        prototype: prototypePath(s.dir, shownBoards(s)),
    });
}

// onBack: shown inside a brainstorm, which owns the way back (backLabel says where to) and the run launch
export function CanvasPane({
    model,
    agent,
    onBack,
    backLabel,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    onBack?: () => void;
    backLabel?: string;
}) {
    const s = useAtomValue(canvasStateAtom(agent.id));
    const now = useAtomValue(model.nowAtom);
    const [measureRef, scrollRef, rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const fitWidth = useSteadyFitWidth(rect?.width ?? 0);
    const [heights, reportHeight] = useContentHeights(`${s?.topic}:${s?.reloadKey}`);
    const selected = s != null ? shownBoard(s).name : null;
    const tab = s != null ? currentTab(s) : null;
    // a tab, [ or ] can pick a board below the fold. Only its top edge is brought into view, label included:
    // scrollIntoView top-aligns any board taller than the pane, which scrolled the labels away on every pick
    useEffect(() => {
        const pane = scrollRef.current;
        const frame = pane?.querySelector(`[data-canvas-frame="${CSS.escape(selected ?? "")}"]`);
        if (pane == null || frame == null) {
            return;
        }
        const top = frame.getBoundingClientRect().top - pane.getBoundingClientRect().top;
        if (top < CANVAS_TOP_PAD || top > pane.clientHeight - CANVAS_TOP_PAD) {
            pane.scrollTop += top - CANVAS_TOP_PAD;
        }
    }, [selected, tab]);
    if (s == null) {
        return null;
    }
    const pane = paneState(s);
    const board = shownBoard(s);
    const layout = canvasLayout(withContentHeights(shownBoards(s), heights), fitWidth);
    const scale = (layout.frames.find((f) => f.board.name === board.name) ?? layout.frames[0]).scale;
    const all = layout.frames.length > 1;
    const marking = s.marking && pane === "board";
    const meta = [updatedAgo(now, s.lastModifiedMs), `${Math.round(scale * 100)}%`].filter(Boolean).join(" · ");

    return (
        <div data-canvas-pane className="flex min-h-0 flex-1 flex-col">
            <div className={SWAP_BAR}>
                {onBack != null ? (
                    <button type="button" onClick={onBack} className={SWAP_BTN}>
                        {backLabel}
                    </button>
                ) : null}
                <span className={SWAP_LABEL}>{s.topic}</span>
                {s.boards.length > 0 && !tabsFitStrip(s.boards) ? (
                    <BoardPicker
                        boards={s.boards}
                        value={currentTab(s)}
                        onChange={(t) => selectCanvasTab(agent.id, t)}
                        onStep={(delta) => stepCanvasBoard(agent.id, delta)}
                    />
                ) : s.boards.length > 0 ? (
                    <div className="flex min-w-0 flex-initial items-center gap-[4px] self-stretch">
                        <StepButton dir="prev" onStep={(delta) => stepCanvasBoard(agent.id, delta)} />
                        <SwapTabs
                            ariaLabel="Boards"
                            title={`Previous and next board (${formatChordString("[")} and ${formatChordString("]")}, or ← and →)`}
                            value={currentTab(s)}
                            options={canvasTabs(s.boards).map((t) => ({
                                key: t,
                                label: <span className="truncate">{t === ALL_TAB ? "All" : boardLabel(t)}</span>,
                            }))}
                            onChange={(tab) => selectCanvasTab(agent.id, tab)}
                            className="min-w-0 flex-initial"
                        />
                        <StepButton dir="next" onStep={(delta) => stepCanvasBoard(agent.id, delta)} />
                    </div>
                ) : null}
                <div className="flex-1" />
                {/* the bar gives way when the pane is narrow or zoomed in: this line first, then the topic and the tabs;
                    the buttons keep their size */}
                {pane === "board" ? (
                    <span className="min-w-0 shrink-[6] truncate text-[10.5px] tabular-nums text-muted">{meta}</span>
                ) : null}
                <button
                    type="button"
                    title={`Mark parts of the board (${formatChordString("m")})`}
                    aria-pressed={marking}
                    disabled={pane !== "board"}
                    onClick={() => setMarking(agent.id, !s.marking)}
                    className={cn(SWAP_BTN, marking && SWAP_BTN_ON)}
                >
                    {marking ? (
                        <SquareCheck size={14} strokeWidth={1.8} aria-hidden />
                    ) : (
                        <SquareDashed size={14} strokeWidth={1.8} aria-hidden />
                    )}
                    Mark
                </button>
                {!marking ? (
                    <div className="flex items-center gap-[10px]">
                        {s.base != null ? (
                            <button
                                type="button"
                                onClick={() => getApi().openExternal(boardUrl(s.base!, s.topic, board.name))}
                                className={SWAP_BTN}
                            >
                                Open in browser
                            </button>
                        ) : null}
                        {s.boards.length > 0 && onBack == null ? (
                            <button
                                type="button"
                                onClick={() => openBuildRun(model, agent, s)}
                                className={SWAP_PRIMARY_BTN}
                            >
                                Build this…
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col bg-surface-code">
                {pane === "server-down" ? (
                    <ServerDown />
                ) : pane === "removed" ? (
                    <Removed topic={s.topic} after="The swap control disappears once you go back to the terminal.">
                        <button
                            type="button"
                            onClick={() => detachCanvas(agent.id)}
                            className={cn("mt-[4px]", SWAP_BTN)}
                        >
                            Back to terminal
                        </button>
                    </Removed>
                ) : (
                    // the shown board, or every one under All in a grid of tiles, each iframe at the board's full size, so the
                    // canvas scrolls here, in arcterm, instead of showing the board pages' own scrollbars. The gutter is
                    // reserved so the scrollbar appearing can't narrow the pane, change the fit scale, and make
                    // itself disappear again
                    <div
                        ref={measureRef}
                        data-canvas-scroll
                        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[24px] pb-[24px] [scrollbar-gutter:stable]"
                        style={{ paddingTop: CANVAS_TOP_PAD }}
                    >
                        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
                            {layout.frames.map((f) => (
                                <BoardFrameView
                                    key={f.board.name}
                                    frame={f}
                                    selected={f.board.name === board.name}
                                    tile={all}
                                    src={
                                        pane === "board" && s.base != null
                                            ? boardUrl(s.base, s.topic, f.board.name)
                                            : null
                                    }
                                    reloadKey={s.reloadKey}
                                    onOpen={() => selectCanvasTab(agent.id, f.board.name)}
                                    onContentHeight={(h) => reportHeight(f.board.name, h)}
                                    // the gallery's preview, taken off the board the user is looking at
                                    onSettled={
                                        pane === "board" && !marking && !all && f.board.name === board.name
                                            ? (el) =>
                                                  void maybeCaptureThumb(tauriThumbIO, {
                                                      topicDir: s.dir,
                                                      boardEl: el,
                                                      modts: s.lastModifiedMs ?? 0,
                                                  })
                                            : undefined
                                    }
                                >
                                    {marking && f.board.name === board.name ? (
                                        <MarkLayer agentId={agent.id} marks={s.marks} />
                                    ) : null}
                                </BoardFrameView>
                            ))}
                        </div>
                    </div>
                )}
                {marking ? <MarkTray agent={agent} marks={s.marks} /> : null}
            </div>
        </div>
    );
}

// The header's boards once they outnumber a row of tabs: three tabs around the shown one, between a previous and a
// next arrow that step as [ and ] do, and where the shown one sits, which opens a menu of All and every board
function BoardPicker({
    boards,
    value,
    onChange,
    onStep,
}: {
    boards: CanvasBoard[];
    value: string;
    onChange: (tab: string) => void;
    onStep: (delta: number) => void;
}) {
    const at = boards.findIndex((b) => b.name === value);
    const open = (e: React.MouseEvent) => {
        // the rows [ and ] would open from here wear their key, so the way to step through is in sight
        const keys = stepKeys(canvasTabs(boards), value);
        ContextMenuModel.getInstance().showContextMenu(
            [
                {
                    label: "All boards",
                    type: "radio",
                    checked: value === ALL_TAB,
                    accel: keys.get(ALL_TAB),
                    click: () => onChange(ALL_TAB),
                },
                { type: "separator" },
                ...boards.map(
                    (b): ContextMenuItem => ({
                        label: boardLabel(b.name),
                        type: "radio",
                        checked: b.name === value,
                        accel: keys.get(b.name),
                        click: () => onChange(b.name),
                    })
                ),
            ],
            e
        );
    };
    return (
        <div className="flex min-w-0 flex-initial items-center gap-[4px] self-stretch">
            <StepButton dir="prev" onStep={onStep} />
            <SwapTabs
                ariaLabel="Nearby boards"
                value={value}
                options={stripWindow(canvasTabs(boards), value).map((t) => ({
                    key: t,
                    label: (
                        <span className="max-w-[140px] truncate" title={t === ALL_TAB ? "All boards" : boardLabel(t)}>
                            {t === ALL_TAB ? "All" : boardLabel(t)}
                        </span>
                    ),
                }))}
                onChange={onChange}
                className="min-w-0 flex-initial"
            />
            <button
                type="button"
                data-canvas-board-picker
                aria-haspopup="menu"
                title={`Pick a board (${formatChordString("[")} and ${formatChordString("]")} step through them)`}
                onClick={open}
                className={SWAP_BTN}
            >
                <span className="tabular-nums font-normal text-muted">
                    {at < 0 ? boards.length : `${at + 1}/${boards.length}`}
                </span>
                <ChevronDown size={13} strokeWidth={1.9} className="flex-none text-muted" aria-hidden />
            </button>
            <StepButton dir="next" onStep={onStep} />
        </div>
    );
}

// ‹ or › beside the board tabs, a step as [ or ] takes. The gallery's viewer names only the arrows: a Vietnamese Telex IME
// turns [ and ] into ơ and ư, so it never advertises them
export function StepButton({
    dir,
    onStep,
    keysHint = "brackets",
}: {
    dir: "prev" | "next";
    onStep: (delta: number) => void;
    keysHint?: "brackets" | "arrows";
}) {
    const prev = dir === "prev";
    const arrow = prev ? "←" : "→";
    const keys = keysHint === "arrows" ? arrow : `${formatChordString(prev ? "[" : "]")} or ${arrow}`;
    return (
        <button
            type="button"
            data-canvas-board-step={dir}
            title={`${prev ? "Previous" : "Next"} board (${keys})`}
            aria-label={prev ? "Previous board" : "Next board"}
            onClick={() => onStep(prev ? -1 : 1)}
            className={cn(SWAP_BTN, "px-[5px]")}
        >
            {prev ? (
                <ChevronLeft size={13} strokeWidth={1.9} aria-hidden />
            ) : (
                <ChevronRight size={13} strokeWidth={1.9} aria-hidden />
            )}
        </button>
    );
}

// Under All every tile wears a transparent cover: its iframe would swallow the click, and a click on a tile opens
// that board on its own tab, where it is drawn whole and can be operated
export function BoardFrameView({
    frame,
    selected,
    tile,
    src,
    reloadKey,
    onOpen,
    onSettled,
    onContentHeight,
    children,
}: {
    frame: BoardFrame;
    selected: boolean;
    tile: boolean;
    src: string | null;
    reloadKey: number;
    onOpen: () => void;
    // the height the board's page reports of itself, each time it changes (canvasHeightReport)
    onContentHeight?: (h: number) => void;
    // called with the board's frame THUMB_SETTLE_MS after its page loads, if the caller still wants it by then (the
    // latest prop is read when the time is up, so a board left or marked meanwhile passes undefined)
    onSettled?: (frameEl: HTMLElement) => void;
    children?: ReactNode;
}) {
    const { board, scale } = frame;
    const label = boardLabel(board.name);
    const frameRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const settleTimer = useRef<number | undefined>(undefined);
    const latestSettled = useRef(onSettled);
    latestSettled.current = onSettled;
    const latestHeight = useRef(onContentHeight);
    latestHeight.current = onContentHeight;
    useEffect(() => () => window.clearTimeout(settleTimer.current), []);
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            const iframe = iframeRef.current;
            if (iframe == null || e.source !== iframe.contentWindow) {
                return;
            }
            const h = canvasHeightReport(e.data);
            if (h != null) {
                latestHeight.current?.(h);
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);
    const onLoaded = () => {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => {
            const el = frameRef.current;
            if (el != null && el.querySelector("iframe") != null) {
                latestSettled.current?.(el);
            }
        }, THUMB_SETTLE_MS);
    };
    return (
        <>
            <button
                type="button"
                onClick={onOpen}
                title={board.title ?? label}
                className={cn(
                    "absolute flex cursor-pointer items-baseline gap-[8px] truncate text-left text-[11px]",
                    selected ? "text-accent-soft" : "text-muted hover:text-secondary"
                )}
                style={{
                    left: frame.left,
                    top: frame.top - LABEL_OFFSET,
                    maxWidth: src != null ? Math.max(0, frame.width - COPY_ROOM) : frame.width,
                }}
            >
                <span className="flex-none font-semibold">{label}</span>
                {board.title != null ? <span className="truncate">{board.title}</span> : null}
            </button>
            {src != null ? (
                <CopyShotButton
                    label={label}
                    frameRef={frameRef}
                    style={{ left: frame.left + frame.width, top: frame.top - LABEL_OFFSET }}
                />
            ) : null}
            <div
                ref={frameRef}
                data-canvas-frame={board.name}
                data-canvas-board={selected ? "" : undefined}
                className={cn(
                    "absolute overflow-hidden rounded-[8px] border bg-background",
                    selected && tile ? "border-accent" : "border-edge-mid"
                )}
                style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
            >
                {src != null ? (
                    <iframe
                        ref={iframeRef}
                        key={`${reloadKey}:${board.name}`}
                        src={src}
                        title={board.name}
                        sandbox="allow-scripts allow-same-origin"
                        onLoad={onLoaded}
                        className="absolute left-0 top-0 border-0"
                        style={{
                            width: board.w,
                            height: board.h,
                            transform: `scale(${scale})`,
                            transformOrigin: "0 0",
                        }}
                    />
                ) : null}
                {tile ? (
                    <button
                        type="button"
                        aria-label={`Open ${label}`}
                        onClick={onOpen}
                        className="absolute inset-0 cursor-pointer hover:bg-accentbg"
                    />
                ) : null}
                {children}
            </div>
        </>
    );
}

// above the board's right edge, outside its frame, so the button is never in the picture it takes. A failure is a toast;
// "Copied" shows for a moment, and a click while one is under way or showing does nothing
function CopyShotButton({
    label,
    frameRef,
    style,
}: {
    label: string;
    frameRef: React.RefObject<HTMLDivElement>;
    style: React.CSSProperties;
}) {
    const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
    const timer = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const copy = () => {
        const el = frameRef.current;
        if (el == null || state !== "idle") {
            return;
        }
        setState("busy");
        copyBoardShot(tauriCopyShotIO, el)
            .then(() => {
                setState("copied");
                timer.current = window.setTimeout(() => setState("idle"), COPY_HOLD_MS);
            })
            .catch((e) => {
                setState("idle");
                pushToast({
                    title: `Couldn't copy ${label}`,
                    message: e instanceof Error ? e.message : String(e),
                    level: "error",
                });
            });
    };
    return (
        <button
            type="button"
            data-canvas-copy-shot={label}
            title="Copy a screenshot of this board, as it shows here"
            aria-label={`Copy a screenshot of ${label}`}
            disabled={state === "busy"}
            onClick={copy}
            className="absolute flex -translate-x-full cursor-pointer items-center gap-[5px] whitespace-nowrap text-[11px] text-muted hover:text-secondary disabled:cursor-default"
            style={style}
        >
            {state === "copied" ? (
                <Check size={12} strokeWidth={2} aria-hidden />
            ) : (
                <Copy size={12} strokeWidth={1.8} aria-hidden />
            )}
            {state === "copied" ? "Copied" : "Copy"}
        </button>
    );
}

export function EdgeState({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px] p-[24px] text-center">
            {children}
        </div>
    );
}

export const EXPLAINER = "max-w-[440px] text-[13px] leading-[1.5] text-secondary";

// wavesrv serves the canvas itself, so this is a refusal or a dropped request, and the poller's next tick retries
export function ServerDown() {
    return (
        <EdgeState>
            <span className="flex items-center gap-[8px] text-[14px] font-semibold text-primary">
                <span className="h-[7px] w-[7px] rounded-full bg-error" />
                arcterm could not serve this canvas
            </span>
            <span className={EXPLAINER}>
                The canvas files are on disk, but arcterm got no answer serving them. It tries again every few seconds.
            </span>
        </EdgeState>
    );
}

// `after` is the sentence about where the user goes next, and `children` the button that takes them there
export function Removed({ topic, after, children }: { topic: string; after: string; children: ReactNode }) {
    return (
        <EdgeState>
            <span className="text-[14px] font-semibold text-primary">{topic} was removed</span>
            <span className={EXPLAINER}>
                Its folder under .superpowers/design is gone, usually because the feature shipped. {after}
            </span>
            {children}
        </EdgeState>
    );
}
