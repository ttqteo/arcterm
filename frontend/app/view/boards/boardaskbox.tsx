// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The line under the board where you ask, or ask the drawer to draw. While the board is edited it says what is selected on
// the canvas (the shapes go with the line, and the drawer or the agent reads them) or, with nothing selected, that
// selecting shapes asks about them. In view mode a selection is only Show's: while a part is read the line asks about
// that part (its shapes go as the selection), otherwise it says Edit is what asks about shapes. Ask is off while the
// drawer answers: one turn at a time per board.

import { useState } from "react";
import type { BoardSelection } from "./boardcanvas";

export interface BoardAskBoxProps {
    // the board's Edit switch (boardEditingAtom): only then is the selection what a line is about
    editing: boolean;
    selection: BoardSelection | null;
    // in view mode, the name of the part being read, which the line asks about; null on the whole drawing
    part?: string | null;
    // askAllowed(talk, alive): no turn is running or queued
    allowed: boolean;
    // what the box says while it waits for a line; the board cell says to pick a chat when its chat has ended
    placeholder?: string;
    // true once the line went; false keeps the words in the box (the caller says why)
    onAsk: (question: string) => Promise<boolean>;
}

export function BoardAskBox({ editing, selection, part, allowed, onAsk, placeholder }: BoardAskBoxProps) {
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const question = text.trim();
    const canSend = allowed && !sending && question !== "";

    async function send(): Promise<void> {
        if (!canSend) {
            return;
        }
        setSending(true);
        try {
            if (await onAsk(question)) {
                setText("");
            }
        } finally {
            setSending(false);
        }
    }

    return (
        <div
            data-board-ask
            className="mx-3 mb-3.5 flex flex-none flex-col gap-1.5 rounded-[10px] border border-edge-strong px-2.5 py-2"
        >
            <span data-board-ask-selected className="truncate text-[11.5px] text-muted">
                {!editing && part != null ? (
                    <>
                        Asking about <span className="text-primary">{part}</span>
                    </>
                ) : !editing ? (
                    "Press Edit to ask about shapes"
                ) : selection?.label != null ? (
                    <>
                        Selected <span className="text-primary">{selection.label}</span>
                    </>
                ) : (
                    "Select shapes to ask about them"
                )}
            </span>
            <div className="flex items-center gap-2">
                <input
                    data-board-ask-input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        // Enter that commits an IME composition is not a send
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                    placeholder={placeholder ?? "Ask, or ask for a drawing…"}
                    aria-label="Ask about this board"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-ink-faint"
                />
                <button
                    type="button"
                    data-board-ask-send
                    disabled={!canSend}
                    onClick={() => void send()}
                    className="flex-none cursor-pointer rounded-[6px] bg-accent px-2.5 py-[3px] text-[12px] text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-45 disabled:hover:bg-accent"
                >
                    Ask
                </button>
            </div>
        </div>
    );
}
