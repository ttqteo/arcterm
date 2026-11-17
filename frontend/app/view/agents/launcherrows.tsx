// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's list parts, shared by its three columns (Start, Project, and the pick's own list: Session or Tool):
// the row tone, the digit keycap, the column label and the filter line; and the empty Task box over them.

import { cn } from "@/util/util";
import { Search, X } from "lucide-react";
import { LAUNCHER_LABEL } from "./launcheragentfields";

export function rowTone(selected: boolean, focused: boolean): string {
    return cn(
        "flex cursor-pointer items-center rounded-[7px] px-2",
        selected ? "bg-surface-selected" : "hover:bg-surface-hover",
        // the selected row of the focused column is the keyboard's cursor
        selected && focused && "ring-1 ring-inset ring-accent-700"
    );
}

// A row's digit. It brightens while its column has focus, which is how the eye finds where a digit will land. A row
// past the ninth keeps the keycap's room, blank, so the names stay aligned.
export function Keycap({ k, lit }: { k: string; lit: boolean }) {
    if (k === "") {
        return <span aria-hidden className="w-[18px] shrink-0" />;
    }
    return (
        <span
            aria-hidden
            className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border font-mono text-[10px]",
                lit ? "border-edge-strong bg-surface text-ink-hi" : "border-border text-muted"
            )}
        >
            {k}
        </span>
    );
}

export function digitOf(i: number): string {
    return i < 9 ? String(i + 1) : "";
}

// A column's search (board A of the session-search canvas): a magnifier at the header's right that, opened, swaps the
// header for a filter box. The column owns what the box holds; ↓ and Escape are the box's own keys.
export interface ColumnSearch {
    column: "project" | "session";
    open: boolean;
    query: string;
    // the count at the box's right ("3 of 14", "1 title · 2 content")
    hint: string;
    // the box's name, for the screen reader and the empty box ("Search projects")
    label: string;
    onOpen: () => void;
    onChange: (query: string) => void;
    // the × or Escape: the column closes the box, clears its filter and takes focus back
    onClose: () => void;
    // ↓: focus goes to the column's first row
    onDown: () => void;
}

export function ColumnLabel({
    label,
    hint,
    focused,
    className,
    search,
}: {
    label: string;
    hint?: string;
    focused: boolean;
    className?: string;
    search?: ColumnSearch;
}) {
    if (search?.open) {
        return <SearchBox search={search} />;
    }
    return (
        <div className={cn("flex shrink-0 items-baseline gap-2 px-2 pb-[7px] pt-0.5", className)}>
            <span className={cn(LAUNCHER_LABEL, "flex-1", focused && "text-secondary")}>{label}</span>
            {/* one line: a narrow column cuts the hint rather than wrapping it under the label */}
            {hint ? <span className="min-w-0 truncate text-[10.5px] tabular-nums text-muted">{hint}</span> : null}
            {search != null ? (
                // no Tab stop (the keyboard has /); negative margins keep the header as tall as its neighbours'
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Search"
                    title={`${search.label} (/)`}
                    data-launcher-search-open={search.column}
                    onClick={search.onOpen}
                    className="-my-1 -mr-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center self-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary"
                >
                    <Search size={13} strokeWidth={2} />
                </button>
            ) : null}
        </div>
    );
}

// the box a typed filter draws (FilterLine) and the search box are one look
const FILTER_BOX =
    "mb-1 flex shrink-0 items-center gap-2 rounded-[7px] border border-accent-700 bg-surface px-2 py-1.5";

// The open search box, in place of the header. It never takes focus by itself: the Session column draws it again, query
// kept, when the resume step opens, and focus belongs on the picked row then. Whoever opens it focuses its input.
function SearchBox({ search }: { search: ColumnSearch }) {
    return (
        <div data-launcher-search={search.column} className={FILTER_BOX}>
            <Search size={13} className="shrink-0 text-muted" />
            <input
                type="text"
                value={search.query}
                placeholder={search.label}
                aria-label={search.label}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => search.onChange(e.target.value)}
                onKeyDown={(e) => {
                    // an IME's Escape cancels its composition; it is not this box's
                    if (e.nativeEvent.isComposing || e.keyCode === 229) {
                        return;
                    }
                    if (e.key === "Escape" || e.key === "ArrowDown") {
                        // the dialog's own keys must not see these: its Escape would close the dialog
                        e.stopPropagation();
                        e.preventDefault();
                        (e.key === "Escape" ? search.onClose : search.onDown)();
                    }
                }}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-muted"
            />
            {search.hint ? <span className="shrink-0 text-[10.5px] tabular-nums text-muted">{search.hint}</span> : null}
            <button
                type="button"
                tabIndex={-1}
                aria-label="Close search"
                title="Close search (Esc)"
                data-launcher-search-close
                onClick={search.onClose}
                className="-mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary"
            >
                <X size={12} strokeWidth={2} />
            </button>
        </div>
    );
}

// The Task box's place at the top for a pick that takes no task (a terminal, a tool, a council): kept, so the dialog
// keeps one shape whatever is picked, and saying why it is empty
export function NoTaskBox({ reason }: { reason: string }) {
    return (
        <div
            data-launcher-no-task
            className="flex min-h-[38px] items-center gap-2 rounded-[10px] border border-dashed border-edge-mid px-3 py-[6px]"
        >
            <span className={cn(LAUNCHER_LABEL, "shrink-0")}>Task</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{reason}</span>
        </div>
    );
}

// what a column's typed filter holds, and how many rows it leaves
export function FilterLine({
    query,
    shown,
    total,
    attr,
}: {
    query: string;
    shown: number;
    total: number;
    attr: string;
}) {
    return (
        <div {...{ [attr]: "" }} className={FILTER_BOX}>
            <Search size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{query}</span>
            <span className="text-[10.5px] tabular-nums text-muted">
                {shown} of {total}
            </span>
        </div>
    );
}
