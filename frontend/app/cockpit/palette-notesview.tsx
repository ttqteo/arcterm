// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Notes scope's results: the note list, closed by its "New note" row, beside the selected note, rendered
// (an empty pane on "New note"). Presentational only:
// command-palette.tsx builds the rows and owns selection, the keys and the scroll refs.

import { MarkdownMessage } from "@/app/view/agents/markdownmessage";
import { cn } from "@/util/util";
import type { RefObject } from "react";
import { NEW_NOTE_KEY } from "./palette-notes";
import { Highlighted, KIND_ICONS, VerbHint, type PaletteItem } from "./palette-rows";

export interface NotesViewProps {
    rows: PaletteItem[];
    selected: number;
    note: UserNote | undefined; // the selected row's note; none on "New note"
    query: string;
    overflow: number; // rows the scope's cap left out
    listRef: RefObject<HTMLDivElement>;
    previewRef: RefObject<HTMLDivElement>;
    onHover: (idx: number) => void;
    onFire: (it: PaletteItem) => void;
}

export function PaletteNotesView(props: NotesViewProps) {
    const { rows, selected, note, query, overflow, listRef, previewRef, onHover, onFire } = props;
    return (
        <div data-palette-notes className="flex min-h-0 flex-1">
            <div
                ref={listRef}
                role="listbox"
                aria-label="Results"
                className="flex w-[370px] shrink-0 flex-col overflow-y-auto border-r border-border px-1.5 pb-2 pt-1"
            >
                {rows.map((it, idx) => {
                    const active = idx === selected;
                    const isNew = it.key === NEW_NOTE_KEY;
                    const Icon = it.icon ?? KIND_ICONS.note;
                    return (
                        <button
                            key={it.key}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-idx={idx}
                            data-note-row={isNew ? undefined : it.key.slice("note:".length)}
                            data-note-new={isNew ? "" : undefined}
                            onMouseMove={() => onHover(idx)}
                            onClick={() => onFire(it)}
                            className={cn(
                                "flex h-[38px] w-full shrink-0 cursor-pointer items-center gap-[11px] rounded-lg px-2 text-left transition-colors duration-[140ms]",
                                active ? "bg-accentbg" : "hover:bg-surface-hover"
                            )}
                        >
                            <span
                                className={cn(
                                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                                    active ? "border-accent-700 text-accent-soft" : "border-edge-mid text-ink-mid"
                                )}
                            >
                                <Icon size={13} strokeWidth={2} />
                            </span>
                            <span
                                className={cn(
                                    "min-w-0 flex-1 truncate text-[13px] font-medium",
                                    active ? "text-primary" : "text-secondary"
                                )}
                            >
                                {isNew ? it.title : <Highlighted text={it.title} query={query} />}
                            </span>
                            {active ? (
                                <VerbHint verb={it.verb} />
                            ) : (
                                <span className="shrink-0 font-mono text-[10.5px] text-muted">{it.meta}</span>
                            )}
                        </button>
                    );
                })}
                {overflow > 0 ? (
                    <div className="shrink-0 px-2 py-0.5 font-mono text-[10.5px] text-muted">
                        +{overflow} more, keep typing
                    </div>
                ) : null}
            </div>
            {/* keyed by note, so the next note starts at its top */}
            <div
                key={note?.id}
                ref={previewRef}
                data-note-preview
                className="min-w-0 flex-1 overflow-y-auto px-[18px] py-3.5 font-markdown text-[13px] leading-[1.55] text-ink-hi"
            >
                {note != null ? <MarkdownMessage text={note.body ?? ""} /> : null}
            </div>
        </div>
    );
}
