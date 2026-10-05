// frontend/app/view/agents/historyfilterrow.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The filter row, inside the history column under its header: free text over commit subjects, plus
// an author and a path chip. The match count, Clear filters and the Graph toggle live in the header
// (historypane.tsx), which is the row the diff-polish boards put them on.
// Three plain inputs, deliberately not a prefix query language: a parser buys one fewer field and
// costs an error state plus a discoverability problem.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { useState } from "react";
import { historyFiltersAtom, setHistoryFilter } from "./githistorystore";

// A chip is a button until you click it, then a one-line input. Which chip is open is transient, so
// it is the one piece of state here that is allowed to be component-local.
function FilterChip({
    label,
    value,
    placeholder,
    mono,
    onChange,
}: {
    label: string;
    value: string;
    placeholder: string;
    // the value is a path, not a name: set it in mono
    mono?: boolean;
    onChange: (v: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const on = value.trim() !== "";
    if (editing) {
        return (
            <span className="flex items-center gap-[7px] rounded-[7px] border border-accent/30 bg-accentbg px-[9px] py-[4px]">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</span>
                <input
                    autoFocus
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") {
                            setEditing(false);
                        }
                    }}
                    className={cn(
                        "w-[150px] bg-transparent text-[11.5px] text-ink-hi outline-none placeholder:text-muted",
                        mono && "font-mono"
                    )}
                />
            </span>
        );
    }
    return (
        <span
            className={cn(
                "flex items-center gap-[7px] rounded-[7px] border px-[9px] py-[4px] text-[11.5px] font-semibold",
                on ? "border-accent/30 bg-accentbg text-ink-hi" : "border-edge-mid bg-surface text-muted"
            )}
        >
            <button onClick={() => setEditing(true)} className="flex items-center gap-[7px]">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</span>
                <span className={cn("max-w-[170px] truncate text-[11.5px]", on && mono && "font-mono")}>
                    {on ? value : placeholder}
                </span>
            </button>
            {on ? (
                <button
                    onClick={() => onChange("")}
                    aria-label={`Clear ${label}`}
                    className="flex-none opacity-70 hover:opacity-100"
                >
                    <X size={12} />
                </button>
            ) : null}
        </span>
    );
}

export function HistoryFilterRow() {
    const filters = useAtomValue(historyFiltersAtom);
    return (
        <div className="flex flex-none items-center gap-[8px] px-[12px] pb-[10px]">
            <div className="flex min-w-0 flex-1 items-center gap-[8px] rounded-[8px] border border-edge-mid bg-surface px-[10px] py-[5px] focus-within:border-accent/30">
                <span className="flex-none text-[11px] font-semibold text-muted">/</span>
                <input
                    data-history-filter
                    value={filters.text}
                    placeholder="Filter by message"
                    onChange={(e) => setHistoryFilter({ text: e.target.value })}
                    onKeyDown={(e) => {
                        // Escape here means "leave the field", not "clear the filters" — the key's
                        // surface-level meaning is claimed by a binding that only fires outside a field.
                        if (e.key === "Escape") {
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-hi outline-none placeholder:text-muted"
                />
            </div>
            <FilterChip
                label="author"
                value={filters.author}
                placeholder="anyone"
                onChange={(v) => setHistoryFilter({ author: v })}
            />
            <FilterChip
                label="path"
                value={filters.path}
                placeholder="any"
                mono
                onChange={(v) => setHistoryFilter({ path: v })}
            />
        </div>
    );
}
