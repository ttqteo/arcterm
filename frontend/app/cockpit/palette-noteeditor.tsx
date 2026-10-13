// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The note editor: the whole palette while a draft is open. Presentational only: command-palette.tsx owns
// the draft, the keys, saving and leaving. The title is the palette's own header field.

import { Pencil } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import type { NoteDraft } from "./palette-notes";
import { FooterKeyLine } from "./palette-rows";

export interface NoteEditorProps {
    draft: NoteDraft;
    error?: string;
    discardArmed: boolean; // one leave was pressed over unsaved changes
    titleRef: RefObject<HTMLInputElement>;
    bodyRef: RefObject<HTMLTextAreaElement>;
    onChange: (patch: { title?: string; body?: string }) => void;
    onKeyDown: (e: KeyboardEvent) => void;
    onLeave: () => void;
}

export function PaletteNoteEditor(props: NoteEditorProps) {
    const { draft, error, discardArmed, titleRef, bodyRef, onChange, onKeyDown, onLeave } = props;
    const title = draft.title.trim();
    return (
        <div data-note-editor className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 pb-[11px] pt-[13px]">
                <Pencil size={15} strokeWidth={2} className="shrink-0 text-muted" />
                <button
                    type="button"
                    data-palette-drill
                    aria-label="Back to notes"
                    onClick={onLeave}
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-edge-mid bg-surface-raised px-2 py-0.5 text-[12px] text-secondary"
                >
                    <span className="text-muted">Notes</span>
                    <span className="text-muted">›</span>
                    <span>{draft.id == null ? "New" : "Edit"}</span>
                </button>
                <input
                    ref={titleRef}
                    data-palette-input
                    aria-label="Title"
                    value={draft.title}
                    onChange={(e) => onChange({ title: e.target.value })}
                    placeholder="Title"
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-primary outline-none placeholder:text-muted"
                />
                <span className="shrink-0 rounded-[5px] border border-edge-mid px-[7px] py-0.5 font-mono text-[10.5px] text-muted">
                    esc
                </span>
            </div>
            {error ? (
                <div
                    role="alert"
                    className="shrink-0 border-b border-error/30 bg-error/10 px-4 py-2 text-[12px] text-error-soft"
                >
                    {error}
                </div>
            ) : null}
            <textarea
                ref={bodyRef}
                data-note-body
                aria-label="Note body, markdown"
                value={draft.body}
                onChange={(e) => onChange({ body: e.target.value })}
                placeholder="Markdown…"
                spellCheck={false}
                className="min-h-0 flex-1 resize-none bg-transparent px-[18px] py-3.5 font-mono text-[12px] leading-[1.6] text-ink-hi outline-none placeholder:text-muted"
            />
            <div className="flex shrink-0 flex-col gap-1 border-t border-border px-4 py-[9px]">
                <div className="flex items-center gap-3">
                    <span className="w-[60px] shrink-0 font-mono text-[11px] text-accent-soft">ctrl ⏎</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">
                        {title === "" ? "Saves the note" : `Saves “${title}”`}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 font-mono text-[10.5px] text-muted">
                        <span>Tab title / body</span>
                        <span>esc back</span>
                    </span>
                </div>
                {discardArmed ? <FooterKeyLine k="esc" text="esc again discards your changes" arm /> : null}
            </div>
        </div>
    );
}
