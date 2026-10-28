// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's list parts, shared by its three columns (Start, Project, and the pick's own list: Session or Tool):
// the row tone, the column label and the filter line. No row draws its key: the digits and letters work unseen.

import { cn } from "@/util/util";
import { Search } from "lucide-react";
import { LAUNCHER_LABEL } from "./launcheragentfields";

export function rowTone(selected: boolean, focused: boolean): string {
    return cn(
        "flex cursor-pointer items-center rounded-[7px] px-2",
        selected ? "bg-surface-selected" : "hover:bg-surface-hover",
        // the selected row of the focused column is the keyboard's cursor
        selected && focused && "ring-1 ring-inset ring-accent-700"
    );
}

export function ColumnLabel({
    label,
    hint,
    focused,
    className,
}: {
    label: string;
    hint?: string;
    focused: boolean;
    className?: string;
}) {
    return (
        <div className={cn("flex shrink-0 items-baseline gap-2 px-2 pb-[7px] pt-0.5", className)}>
            <span className={cn(LAUNCHER_LABEL, "flex-1", focused && "text-secondary")}>{label}</span>
            {hint ? <span className="text-[10.5px] tabular-nums text-muted">{hint}</span> : null}
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
        <div
            {...{ [attr]: "" }}
            className="mb-1 flex shrink-0 items-center gap-2 rounded-[7px] border border-accent-700 bg-surface px-2 py-1.5"
        >
            <Search size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{query}</span>
            <span className="text-[10.5px] tabular-nums text-muted">
                {shown} of {total}
            </span>
        </div>
    );
}
