// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Marking a board: the layer drawn over the shown board (drag a box around what should change) and the tray under it
// (a note per mark, Clear, Send). Shared by the canvas pane and a brainstorm's board rail, so both mark the same way;
// the marks live in the agent's canvas state (canvasstore), keyed by agent.

import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { X } from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { addMark, removeMark, setMarkNote, type Box, type Mark } from "./canvasmarks";
import { sendCanvasMarks } from "./canvassend";
import { clearMarks, updateCanvas } from "./canvasstore";
import { SWAP_BTN, SWAP_PRIMARY_BTN } from "./swapbar";

const MARK_CHIP =
    "h-[20px] w-[20px] rounded-full bg-accent text-center text-[11px] font-bold tabular-nums leading-[20px] text-background";

// arcterm DOM over the iframe, so the iframe can't take the pointer or focus while marking, and the window capture
// includes the boxes
export function MarkLayer({ agentId, marks }: { agentId: string; marks: Mark[] }) {
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
            data-canvas-mark-layer
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
                    data-canvas-mark={i + 1}
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

export function MarkTray({ agent, marks }: { agent: AgentVM; marks: Mark[] }) {
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
