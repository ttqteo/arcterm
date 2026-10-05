// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

// Handoff section header: optional caret + colored dot + uppercase label + optional note + count pill +
// gradient divider + an optional right slot. Shared by Idle, Backgrounded and Background (muted, collapsible).
export function SectionHeader({
    label,
    labelClassName,
    count,
    dotClassName,
    countPillClassName,
    dividerClassName,
    note,
    right,
    open,
    onClick,
    className,
}: {
    label: string;
    labelClassName?: string;
    count: number;
    dotClassName: string;
    countPillClassName: string;
    dividerClassName: string;
    note?: string;
    right?: ReactNode;
    // undefined draws no caret
    open?: boolean;
    onClick?: () => void;
    className?: string;
}) {
    return (
        <div className={cn("flex items-center gap-2.5", onClick && "cursor-pointer", className)} onClick={onClick}>
            {open == null ? null : open ? (
                <ChevronDown size={12} aria-hidden className="w-3 shrink-0 text-muted" />
            ) : (
                <ChevronRight size={12} aria-hidden className="w-3 shrink-0 text-muted" />
            )}
            <span className={cn("h-[9px] w-[9px] shrink-0 rounded-full", dotClassName)} />
            <h2 className={cn("text-[12px] font-semibold uppercase tracking-[0.1em]", labelClassName)}>
                {label}
            </h2>
            {note ? <span className="text-[12px] text-muted">{note}</span> : null}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", countPillClassName)}>
                {count}
            </span>
            <div className={cn("h-px flex-1", dividerClassName)} />
            {right}
        </div>
    );
}
