// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agent's design-local canvas, shown on the Agent surface in place of its (still mounted, hidden) terminal.
// Thin: what it shows comes from canvasmodel/canvasmarks, and what it knows comes from the agent's canvas state,
// which useCanvasPoller keeps current.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/app/store/global";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronLeft, ChevronRight, SquareDashed, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { openLauncher } from "./launcherstore";
import { addMark, removeMark, setMarkNote, type Box, type Mark } from "./canvasmarks";
import {
    ALL_TAB,
    boardLabel,
    boardUrl,
    buildGoal,
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
    type BoardFrame,
    type CanvasBoard,
} from "./canvasmodel";
import { sendCanvasMarks } from "./canvassend";
import {
    canvasStateAtom,
    clearMarks,
    detachCanvas,
    selectCanvasTab,
    setMarking,
    stepCanvasBoard,
    updateCanvas,
    type CanvasState,
} from "./canvasstore";
import { maybeCaptureThumb, tauriThumbIO, THUMB_SETTLE_MS } from "./canvasthumb";
import { SWAP_BAR, SWAP_BTN, SWAP_BTN_ON, SWAP_LABEL, SWAP_PRIMARY_BTN, SwapTabs } from "./swapbar";

// room above a board's frame for its label; the scroll pane's top padding
export const CANVAS_TOP_PAD = 36;
const LABEL_OFFSET = 22;

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

const MARK_CHIP =
    "h-[20px] w-[20px] rounded-full bg-accent text-center text-[11px] font-bold tabular-nums leading-[20px] text-background";

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
    const layout = canvasLayout(shownBoards(s), fitWidth);
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
                    <div className="flex flex-none items-center gap-[4px] self-stretch">
                        <StepButton dir="prev" onStep={(delta) => stepCanvasBoard(agent.id, delta)} />
                        <SwapTabs
                            ariaLabel="Boards"
                            title={`Previous and next board (${formatChordString("[")} and ${formatChordString("]")}, or ← and →)`}
                            value={currentTab(s)}
                            options={canvasTabs(s.boards).map((t) => ({
                                key: t,
                                label: t === ALL_TAB ? "All" : boardLabel(t),
                            }))}
                            onChange={(tab) => selectCanvasTab(agent.id, tab)}
                        />
                        <StepButton dir="next" onStep={(delta) => stepCanvasBoard(agent.id, delta)} />
                    </div>
                ) : null}
                <div className="flex-1" />
                {pane === "board" ? (
                    <span className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-muted">{meta}</span>
                ) : null}
                <button
                    type="button"
                    title={`Mark parts of the board (${formatChordString("m")})`}
                    aria-pressed={marking}
                    disabled={pane !== "board"}
                    onClick={() => setMarking(agent.id, !s.marking)}
                    className={cn(SWAP_BTN, marking && SWAP_BTN_ON)}
                >
                    <SquareDashed size={14} strokeWidth={1.8} aria-hidden />
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
                className="min-w-0"
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
    children,
}: {
    frame: BoardFrame;
    selected: boolean;
    tile: boolean;
    src: string | null;
    reloadKey: number;
    onOpen: () => void;
    // called with the board's frame THUMB_SETTLE_MS after its page loads, if the caller still wants it by then (the
    // latest prop is read when the time is up, so a board left or marked meanwhile passes undefined)
    onSettled?: (frameEl: HTMLElement) => void;
    children?: ReactNode;
}) {
    const { board, scale } = frame;
    const label = boardLabel(board.name);
    const frameRef = useRef<HTMLDivElement>(null);
    const settleTimer = useRef<number | undefined>(undefined);
    const latestSettled = useRef(onSettled);
    latestSettled.current = onSettled;
    useEffect(() => () => window.clearTimeout(settleTimer.current), []);
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
                style={{ left: frame.left, top: frame.top - LABEL_OFFSET, maxWidth: frame.width }}
            >
                <span className="flex-none font-semibold">{label}</span>
                {board.title != null ? <span className="truncate">{board.title}</span> : null}
            </button>
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

// arcterm DOM over the iframe, so the iframe can't take the pointer or focus while marking, and the window capture
// includes the boxes
function MarkLayer({ agentId, marks }: { agentId: string; marks: Mark[] }) {
    const [draft, setDraft] = useState<Box | null>(null);
    const at = (e: ReactPointerEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = at(e);
        setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    };
    const move = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (draft != null) {
            const p = at(e);
            setDraft({ ...draft, x1: p.x, y1: p.y });
        }
    };
    const up = () => {
        if (draft != null) {
            updateCanvas(agentId, (s) => ({ ...s, marks: addMark(s.marks, draft) }));
            setDraft(null);
        }
    };
    return (
        <div
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setDraft(null)}
            className="absolute inset-0 cursor-crosshair select-none rounded-[8px] outline outline-2 -outline-offset-1 outline-accent"
        >
            {marks.length === 0 && draft == null ? (
                <div className="pointer-events-none absolute left-1/2 top-[64px] -translate-x-1/2 rounded-full bg-accentbg px-[12px] py-[5px] text-[12.5px] font-semibold text-accent-soft">
                    Drag a box around what you want changed
                </div>
            ) : null}
            {marks.map((m, i) => (
                <div
                    key={i}
                    className="pointer-events-none absolute rounded-[6px] border-2 border-accent bg-accentbg"
                    style={{ left: m.x, top: m.y, width: m.w, height: m.h }}
                >
                    <span className={cn("absolute left-[-11px] top-[-11px]", MARK_CHIP)}>{i + 1}</span>
                </div>
            ))}
            {draft != null ? (
                <div
                    className="pointer-events-none absolute rounded-[6px] border-2 border-dashed border-accent"
                    style={{
                        left: Math.min(draft.x0, draft.x1),
                        top: Math.min(draft.y0, draft.y1),
                        width: Math.abs(draft.x1 - draft.x0),
                        height: Math.abs(draft.y1 - draft.y0),
                    }}
                />
            ) : null}
        </div>
    );
}

function MarkTray({ agent, marks }: { agent: AgentVM; marks: Mark[] }) {
    const agentId = agent.id;
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const noMarks = marks.length === 0;

    const send = async () => {
        setSending(true);
        setError(null);
        try {
            await sendCanvasMarks(agent);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex flex-none items-start gap-[16px] border-t border-border bg-surface px-[22px] py-[12px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
                {marks.length === 0 ? (
                    <span className="py-[6px] text-[13px] text-muted">
                        No marks yet. Each box you draw gets a number and a note here.
                    </span>
                ) : null}
                {marks.map((m, i) => (
                    <div key={i} className="flex items-center gap-[10px]">
                        <span className={cn("flex-none", MARK_CHIP)}>{i + 1}</span>
                        <input
                            aria-label={`Note for mark ${i + 1}`}
                            placeholder="What should change here? (optional)"
                            value={m.note}
                            onChange={(e) =>
                                updateCanvas(agentId, (s) => ({ ...s, marks: setMarkNote(s.marks, i, e.target.value) }))
                            }
                            className="min-w-0 flex-1 rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] py-[6px] text-[13px] text-primary outline-none"
                        />
                        <button
                            type="button"
                            aria-label={`Remove mark ${i + 1}`}
                            onClick={() => updateCanvas(agentId, (s) => ({ ...s, marks: removeMark(s.marks, i) }))}
                            className="flex-none cursor-pointer rounded-[7px] border border-edge-mid bg-surface-raised p-[6px] leading-none text-secondary hover:border-edge-strong"
                        >
                            <X size={14} strokeWidth={1.9} aria-hidden />
                        </button>
                    </div>
                ))}
            </div>
            <div className="flex flex-none flex-col items-end gap-[6px]">
                <div data-canvas-tray-actions className="flex items-center gap-[10px]">
                    <button type="button" onClick={() => clearMarks(agentId)} className={SWAP_BTN}>
                        Clear
                    </button>
                    <button
                        type="button"
                        data-canvas-send
                        title={`Send the marks to the agent (${formatChordString("Mod:Enter")})`}
                        disabled={noMarks || sending}
                        onClick={() => void send()}
                        className={cn(
                            SWAP_PRIMARY_BTN,
                            noMarks &&
                                "border-edge-mid bg-surface-hover text-muted hover:bg-surface-hover disabled:opacity-100"
                        )}
                    >
                        {sending ? "Sending…" : `Send to ${agent.name}`}
                    </button>
                </div>
                <span className="text-[12px] text-muted">
                    Saves a picture of the board with your marks, then types one line into the agent.
                </span>
                {error != null ? <span className="max-w-[440px] text-[12px] text-error">{error}</span> : null}
            </div>
        </div>
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
