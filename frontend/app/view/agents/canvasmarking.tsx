// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Marking a board: the mode toggle (Try | Mark), the layer drawn over the shown board (drag a box around what should
// change) and the tray under it (a note per mark, Clear, Send). Shared by the canvas pane and a brainstorm's board rail,
// so both mark the same way; the marks live in the agent's canvas state (canvasstore), keyed by agent.
//
// A mark remembers the screen and the variants the board showed when it was drawn (its ctx) and takes a clean picture of
// the board then; the layer draws the marks of the context on screen only, the tray lists them all.

import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { SquareCheck, SquareDashed, X } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AgentVM } from "./agentsviewmodel";
import {
    boxToMark,
    markContextLabel,
    marksIn,
    NO_CONTEXT,
    removeMark,
    setMarkNote,
    setMarkShot,
    spansContexts,
    type Box,
    type Mark,
} from "./canvasmarks";
import { frameSendIO, sendCanvasMarks, shootBoard, tauriSendIO } from "./canvassend";
import { clearMarks, setMarking, updateCanvas } from "./canvasstore";
import { contextKey, HIDE_WHILE_CAPTURING, type MarkContext } from "./protomodel";
import { SWAP_BTN, SWAP_BTN_ON, SWAP_PRIMARY_BTN } from "./swapbar";

const MARK_CHIP =
    "h-[20px] w-[20px] rounded-full bg-accent text-center text-[11px] font-bold tabular-nums leading-[20px] text-background";

// the segments of Try | Mark, as board A draws them: a raised container, the shown mode lifted out of it
const SEGMENT =
    "flex cursor-pointer items-center whitespace-nowrap rounded-[5px] border-0 px-[10px] py-[3px] text-[12px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const SEGMENT_ON = "bg-edge-mid text-primary";
const SEGMENT_OFF = "bg-transparent text-muted hover:text-secondary";

// What turns marking on and off. On an interactive board a segmented Try | Mark: Try runs the prototype, Mark freezes it
// and draws boxes. On a static board there is nothing to try, so it is the one Mark button it always was. The key `m`
// toggles either (bindings.ts). markProps: extra attributes for the Mark button, so a caller keeps its own hook
// (the rail's data-brainstorm-rail-mark)
export function ModeToggle({
    agentId,
    marking,
    interactive,
    disabled,
    markProps,
}: {
    agentId: string;
    marking: boolean;
    interactive: boolean;
    disabled?: boolean;
    markProps?: Record<string, string | number | boolean>;
}) {
    const key = formatChordString("m");
    if (!interactive) {
        return (
            <button
                type="button"
                data-canvas-mode="mark"
                {...markProps}
                title={`Mark parts of the board (${key})`}
                aria-pressed={marking}
                disabled={disabled}
                onClick={() => setMarking(agentId, !marking)}
                className={cn(SWAP_BTN, marking && SWAP_BTN_ON)}
            >
                {/* on, the toggle reads as a ticked box, so it no longer looks like the same button turned orange */}
                {marking ? (
                    <SquareCheck size={14} strokeWidth={1.8} aria-hidden />
                ) : (
                    <SquareDashed size={14} strokeWidth={1.8} aria-hidden />
                )}
                Mark
            </button>
        );
    }
    return (
        <div
            role="group"
            aria-label="Board mode"
            className="flex flex-none gap-[2px] rounded-[7px] border border-border bg-surface-raised p-[2px]"
        >
            <button
                type="button"
                data-canvas-mode="try"
                title={`Click through the prototype (${key})`}
                aria-pressed={!marking}
                disabled={disabled}
                onClick={() => setMarking(agentId, false)}
                className={cn(SEGMENT, marking ? SEGMENT_OFF : SEGMENT_ON)}
            >
                Try
            </button>
            <button
                type="button"
                data-canvas-mode="mark"
                {...markProps}
                title={`Mark parts of the board (${key})`}
                aria-pressed={marking}
                disabled={disabled}
                onClick={() => setMarking(agentId, true)}
                className={cn(SEGMENT, marking ? SEGMENT_ON : SEGMENT_OFF)}
            >
                Mark
            </button>
        </div>
    );
}

// arcterm DOM over the iframe, so the iframe can't take the pointer or focus while marking. It holds the marks drawn on
// ctx (the screen and variants showing; none when a caller names none, as a static board) with their numbers in the whole
// list. A picture of the board is taken for each new mark, with every overlay in the frame hidden (HIDE_WHILE_CAPTURING),
// so Send can draw the boxes on a clean one; the layer itself keeps taking the pointer meanwhile, so a press then does
// not fall through to the board
export function MarkLayer({ agentId, marks, ctx }: { agentId: string; marks: Mark[]; ctx?: MarkContext }) {
    const where = ctx ?? NO_CONTEXT;
    const layerRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<Box | null>(null);
    // read when a picture arrives, which can be after a chip swapped the variant the mark was drawn on
    const showing = useRef(contextKey(where));
    showing.current = contextKey(where);
    const here = marksIn(marks, where);
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
    // the mark stands at once; its picture follows, and a capture that fails (no Tauri host, no screen recording) leaves it
    // with none, so drawing never needs one
    const shoot = async (id: number, frame: HTMLElement, key: string) => {
        try {
            const shot = await shootBoard(frameSendIO(frame));
            if (showing.current === key) {
                updateCanvas(agentId, (s) => ({ ...s, marks: setMarkShot(s.marks, id, shot) }));
            }
        } catch (e) {
            console.warn("canvas mark: no picture of the board", e);
        }
    };
    const up = () => {
        if (draft == null) {
            return;
        }
        const mark = boxToMark(draft, where);
        setDraft(null);
        if (mark == null) {
            return;
        }
        updateCanvas(agentId, (s) => ({ ...s, marks: [...s.marks, mark] }));
        const frame = layerRef.current?.closest<HTMLElement>("[data-canvas-board]");
        if (frame != null) {
            void shoot(mark.id, frame, contextKey(where));
        }
    };
    return (
        <div
            ref={layerRef}
            data-canvas-mark-layer
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setDraft(null)}
            className="absolute inset-0 cursor-crosshair select-none"
        >
            <div
                className={cn(
                    "pointer-events-none absolute inset-0 rounded-[8px] outline outline-2 -outline-offset-1 outline-accent",
                    HIDE_WHILE_CAPTURING
                )}
            />
            {here.length === 0 && draft == null ? (
                <div
                    className={cn(
                        "pointer-events-none absolute left-1/2 top-[64px] -translate-x-1/2 rounded-full bg-accentbg px-[12px] py-[5px] text-[12.5px] font-semibold text-accent-soft",
                        HIDE_WHILE_CAPTURING
                    )}
                >
                    Drag a box around what you want changed
                </div>
            ) : null}
            {here.map(({ n, mark: m }) => (
                <div
                    key={m.id}
                    data-canvas-mark={n}
                    className={cn(
                        "pointer-events-none absolute rounded-[6px] border-2 border-accent bg-accentbg",
                        HIDE_WHILE_CAPTURING
                    )}
                    style={{ left: m.x, top: m.y, width: m.w, height: m.h }}
                >
                    <span className={cn("absolute left-[-11px] top-[-11px]", MARK_CHIP)}>{n}</span>
                </div>
            ))}
            {draft != null ? (
                <div
                    className={cn(
                        "pointer-events-none absolute rounded-[6px] border-2 border-dashed border-accent",
                        HIDE_WHILE_CAPTURING
                    )}
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

// ctx: what the board shows now, which Send needs for a group of marks that has no picture (canvassend.ts). Left out, it is
// a board with no screen and no slot
export function MarkTray({ agent, marks, ctx }: { agent: AgentVM; marks: Mark[]; ctx?: MarkContext }) {
    const agentId = agent.id;
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const noMarks = marks.length === 0;
    // the marks of one screen need no name; once they span more than one, each says where it was drawn
    const named = spansContexts(marks);

    const send = async () => {
        setSending(true);
        setError(null);
        try {
            await sendCanvasMarks(agent, tauriSendIO, ctx ?? NO_CONTEXT);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSending(false);
        }
    };

    return (
        <div
            data-canvas-tray
            className="flex flex-none items-start gap-[16px] border-t border-border bg-surface px-[22px] py-[12px]"
        >
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
                {marks.length === 0 ? (
                    <span className="py-[6px] text-[13px] text-muted">
                        No marks yet. Each box you draw gets a number and a note here.
                    </span>
                ) : null}
                {marks.map((m, i) => {
                    const label = markContextLabel(m.ctx);
                    return (
                        <div key={m.id} className="flex items-center gap-[10px]">
                            <span className={cn("flex-none", MARK_CHIP)}>{i + 1}</span>
                            {named ? (
                                <span
                                    data-canvas-mark-context={i + 1}
                                    title={label}
                                    className="max-w-[38%] flex-none truncate text-[11.5px] text-muted"
                                >
                                    {label}
                                </span>
                            ) : null}
                            <input
                                aria-label={`Note for mark ${i + 1}`}
                                placeholder="What should change here? (optional)"
                                value={m.note}
                                onChange={(e) =>
                                    updateCanvas(agentId, (s) => ({
                                        ...s,
                                        marks: setMarkNote(s.marks, i, e.target.value),
                                    }))
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
                    );
                })}
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
                    {named
                        ? "Saves a picture of each screen you marked, with your marks, then types one line into the agent."
                        : "Saves a picture of the board with your marks, then types one line into the agent."}
                </span>
                {error != null ? <span className="max-w-[440px] text-[12px] text-error">{error}</span> : null}
            </div>
        </div>
    );
}
