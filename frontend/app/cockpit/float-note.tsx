// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Note tab's body in Float (docs/superpowers/specs/2026-10-17-float-note-translate-design.md): the one global
// scratch note, drawn over the terminal area, one tone above the terminal. The terminal stack stays mounted under it,
// so the terminal never refits or replays. The state, the save and the open/close are floatnotestore.ts; the bar's
// Edit | Preview switch (float-bar.tsx) writes scratchPreviewAtom.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import {
    closeFloatNote,
    editScratch,
    loadScratch,
    scratchBodyAtom,
    scratchErrorAtom,
    scratchPreviewAtom,
} from "@/app/view/agents/floatnotestore";
import { MarkdownMessage } from "@/app/view/agents/markdownmessage";
import { useAtomValue } from "jotai";
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

const PLACEHOLDER = "Write markdown…\n\nIt saves as you type. Esc goes back to the terminal.";

export function FloatNote({ model }: { model: AgentsViewModel }) {
    const body = useAtomValue(scratchBodyAtom);
    const error = useAtomValue(scratchErrorAtom);
    const preview = useAtomValue(scratchPreviewAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        loadScratch().catch((err) => console.error("reading the scratch note failed", err));
    }, []);
    // any change of focus closes the note (a ledge tab, Ctrl+Tab, j/k…); not on its first value
    const firstFocus = useRef(true);
    useEffect(() => {
        if (firstFocus.current) {
            firstFocus.current = false;
            return;
        }
        closeFloatNote();
    }, [focusId]);
    // the note leaving saves a pending edit and gives the keyboard back to the terminal, unless a route (a ledge tab,
    // the switcher) already moved it
    const focusIdRef = useRef(focusId);
    focusIdRef.current = focusId;
    useEffect(
        () => () => {
            closeFloatNote();
            requestAnimationFrame(() => {
                const active = document.activeElement;
                if (active != null && active !== document.body) {
                    return;
                }
                const term = document.querySelector<HTMLElement>(
                    `[data-agent-terminal="${focusIdRef.current}"] .xterm-helper-textarea`
                );
                if (term?.checkVisibility()) {
                    term.focus({ preventScroll: true });
                }
            });
        },
        []
    );
    const shown = body != null;
    // the caret goes to the end, where a scratch note is added to
    useEffect(() => {
        const editor = editorRef.current;
        if (shown && !preview && editor != null) {
            editor.focus({ preventScroll: true });
            editor.setSelectionRange(editor.value.length, editor.value.length);
            editor.scrollTop = editor.scrollHeight;
        }
    }, [shown, preview]);
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeFloatNote();
        }
    };
    return (
        <div data-float-note className="absolute inset-0 flex flex-col bg-surface">
            {!shown ? null : preview ? (
                <div data-float-note-body className="min-h-0 flex-1 overflow-y-auto px-[22px] py-3.5">
                    <MarkdownMessage text={body} />
                </div>
            ) : (
                <textarea
                    ref={editorRef}
                    data-float-note-editor
                    aria-label="Note"
                    spellCheck={false}
                    value={body}
                    placeholder={PLACEHOLDER}
                    onChange={(e) => editScratch(e.target.value)}
                    onKeyDown={onKeyDown}
                    className="min-h-0 w-full flex-1 resize-none bg-transparent px-5 py-3.5 font-mono text-[13px] leading-[21px] text-primary caret-primary outline-none placeholder:text-muted"
                />
            )}
            {error != null ? (
                <div
                    role="status"
                    data-float-note-error
                    className="flex flex-none items-center gap-2 border-t border-border px-5 py-2 text-[12px] text-error-soft"
                >
                    <CircleAlert size={14} strokeWidth={2} className="flex-none text-error" />
                    <span>{error}</span>
                </div>
            ) : null}
        </div>
    );
}
