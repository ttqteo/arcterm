// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agent's design-local canvas, shown on the Agent surface in place of its (still mounted, hidden) terminal.
// Thin: what it shows comes from canvasmodel/canvasmarks, and what it knows comes from the agent's canvas state,
// which useCanvasPoller keeps current.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { getApi } from "@/app/store/global";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { SquareDashed, X } from "lucide-react";
import { useEffect, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
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
    updatedAgo,
    type BoardFrame,
} from "./canvasmodel";
import { sendCanvasMarks } from "./canvassend";
import {
    canvasStateAtom,
    clearMarks,
    detachCanvas,
    selectCanvasBoard,
    selectCanvasTab,
    setMarking,
    updateCanvas,
    type CanvasState,
} from "./canvasstore";
import { SWAP_BAR, SWAP_BTN, SWAP_BTN_ON, SWAP_LABEL, SWAP_PRIMARY_BTN, SwapTabs } from "./swapbar";

// room above a board's frame for its label; the scroll pane's top padding
const CANVAS_TOP_PAD = 36;
const LABEL_OFFSET = 22;

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

export function CanvasPane({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const s = useAtomValue(canvasStateAtom(agent.id));
    const now = useAtomValue(model.nowAtom);
    const [measureRef, scrollRef, rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const selected = s != null ? shownBoard(s).name : null;
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
    }, [selected]);
    if (s == null) {
        return null;
    }
    const pane = paneState(s);
    const board = shownBoard(s);
    const layout = canvasLayout(shownBoards(s), rect?.width ?? 0);
    const scale = layout.scale;
    const marking = s.marking && pane === "board";
    const meta = [updatedAgo(now, s.lastModifiedMs), `${Math.round(scale * 100)}%`].filter(Boolean).join(" · ");

    return (
        <div data-canvas-pane className="flex min-h-0 flex-1 flex-col">
            <div className={SWAP_BAR}>
                <span className={SWAP_LABEL}>{s.topic}</span>
                {s.boards.length > 0 ? (
                    <SwapTabs
                        ariaLabel="Boards"
                        title={`Previous and next board (${formatChordString("[")} and ${formatChordString("]")})`}
                        value={currentTab(s)}
                        options={canvasTabs(s.boards).map((t) => ({
                            key: t,
                            label: t === ALL_TAB ? "All" : boardLabel(t),
                        }))}
                        onChange={(tab) => selectCanvasTab(agent.id, tab)}
                    />
                ) : null}
                <div className="flex-1" />
                {pane === "board" ? <span className="text-[10.5px] tabular-nums text-muted">{meta}</span> : null}
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
                        {s.boards.length > 0 ? (
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
                    <Removed agent={agent} topic={s.topic} />
                ) : (
                    // the shown boards (every one under All) at their canvas.json frames, each iframe at the board's full size, so the canvas
                    // scrolls here, in arcterm, instead of showing the board pages' own scrollbars. The gutter is
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
                                    scale={scale}
                                    selected={f.board.name === board.name}
                                    single={layout.frames.length === 1}
                                    src={
                                        pane === "board" && s.base != null
                                            ? boardUrl(s.base, s.topic, f.board.name)
                                            : null
                                    }
                                    reloadKey={s.reloadKey}
                                    onSelect={() => selectCanvasBoard(agent.id, f.board.name)}
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

// A board the user hasn't picked wears a transparent cover: its iframe would swallow the click, and the first
// click on a board should pick it (the one marks and Open in browser act on), not operate it
function BoardFrameView({
    frame,
    scale,
    selected,
    single,
    src,
    reloadKey,
    onSelect,
    children,
}: {
    frame: BoardFrame;
    scale: number;
    selected: boolean;
    single: boolean;
    src: string | null;
    reloadKey: number;
    onSelect: () => void;
    children?: ReactNode;
}) {
    const { board } = frame;
    const label = boardLabel(board.name);
    return (
        <>
            <button
                type="button"
                onClick={onSelect}
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
                data-canvas-frame={board.name}
                data-canvas-board={selected ? "" : undefined}
                className={cn(
                    "absolute overflow-hidden rounded-[8px] border bg-background",
                    selected && !single ? "border-accent" : "border-edge-mid"
                )}
                style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
            >
                {src != null ? (
                    <iframe
                        key={`${reloadKey}:${board.name}`}
                        src={src}
                        title={board.name}
                        sandbox="allow-scripts allow-same-origin"
                        className="absolute left-0 top-0 border-0"
                        style={{
                            width: board.w,
                            height: board.h,
                            transform: `scale(${scale})`,
                            transformOrigin: "0 0",
                        }}
                    />
                ) : null}
                {!selected ? (
                    <button
                        type="button"
                        aria-label={`Select ${label}`}
                        onClick={onSelect}
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

function EdgeState({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px] p-[24px] text-center">
            {children}
        </div>
    );
}

const EXPLAINER = "max-w-[440px] text-[13px] leading-[1.5] text-secondary";

// wavesrv serves the canvas itself, so this is a refusal or a dropped request, and the poller's next tick retries
function ServerDown() {
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

function Removed({ agent, topic }: { agent: AgentVM; topic: string }) {
    return (
        <EdgeState>
            <span className="text-[14px] font-semibold text-primary">{topic} was removed</span>
            <span className={EXPLAINER}>
                Its folder under .superpowers/design is gone, usually because the feature shipped. The swap control
                disappears once you go back to the terminal.
            </span>
            <button type="button" onClick={() => detachCanvas(agent.id)} className={cn("mt-[4px]", SWAP_BTN)}>
                Back to terminal
            </button>
        </EdgeState>
    );
}
