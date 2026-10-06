// frontend/app/view/agents/comparecolumn.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pane 1 of the Diff surface in its compare state (diff-polish Compare board): the merge base in the
// header, where it stays visible rather than after 152 rows, then the aggregate as row zero, then two
// labelled commit groups coloured by side. No graph gutter — compare has no lane geometry to draw, so
// rows are flush-padded instead of indented.

import { SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { PanelLeftClose } from "lucide-react";
import { SubLabel } from "./sectionlabel";
import {
    AGGREGATE,
    SIDE_DOT,
    SIDE_TEXT,
    splitLabel,
    type CompareCommitRow,
    type CompareHeaderRow,
    type CompareRow,
} from "./comparerows";

const ROW_H = 32;
const AGGREGATE_ROW_H = 36;
const PAD = 14;

function CompareSkeleton() {
    return (
        <div className="px-[14px]">
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex h-[32px] items-center gap-[9px]">
                    <SkeletonLine className="h-[7px] w-[7px] rounded-full" />
                    <SkeletonLine className="h-[8px] w-[46px]" />
                    <SkeletonLine className="h-[8px] w-[150px]" />
                </div>
            ))}
        </div>
    );
}

function AggregateRowView({
    row,
    selected,
    onSelect,
}: {
    row: Extract<CompareRow, { kind: "aggregate" }>;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            onClick={onSelect}
            style={{ height: AGGREGATE_ROW_H, paddingLeft: PAD }}
            className={cn(
                "relative flex w-full items-center gap-[9px] pr-[12px] text-left transition-colors duration-[140ms] hover:bg-surface",
                selected && "bg-surface-selected"
            )}
        >
            {/* no left accent bar — the fill marks the selection, matching historypane.tsx */}
            <span className="text-[12.5px] font-semibold text-ink-hi">{row.label}</span>
            <div className="flex-1" />
            {row.files == null ? (
                <SkeletonLine className="h-[8px] w-[80px]" />
            ) : (
                <>
                    <span className="text-[10.5px] tabular-nums text-ink-mid">
                        {row.files} {row.files === 1 ? "file" : "files"}
                    </span>
                    <span className="text-[10.5px] font-semibold tabular-nums text-diff-added">+{row.adds}</span>
                    <span className="text-[10.5px] font-semibold tabular-nums text-diff-removed">−{row.dels}</span>
                </>
            )}
        </button>
    );
}

function HeaderRowView({ row }: { row: CompareHeaderRow }) {
    return (
        <div className="flex items-center gap-[8px] pb-[6px] pl-[14px] pr-[12px] pt-[12px]">
            <span className={cn("h-[7px] w-[7px] flex-none rounded-full", SIDE_DOT[row.side])} />
            <span className={cn("truncate text-[11.5px] font-semibold", SIDE_TEXT[row.side])}>{row.ref}</span>
            <span className="flex-none text-[11.5px] text-muted">{row.note}</span>
        </div>
    );
}

function CommitRowView({
    row,
    selected,
    onSelect,
}: {
    row: CompareCommitRow;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            onClick={onSelect}
            style={{ height: ROW_H }}
            className={cn(
                "relative flex w-full items-center gap-[9px] pl-[20px] pr-[12px] text-left transition-colors duration-[140ms] hover:bg-surface",
                selected && "bg-surface-selected"
            )}
        >
            {/* no left accent bar — the fill marks the selection, matching historypane.tsx */}
            <span className={cn("h-[7px] w-[7px] flex-none rounded-full opacity-85", SIDE_DOT[row.side])} />
            <span className="w-[52px] flex-none font-mono text-[11px] text-muted">{row.hash.slice(0, 7)}</span>
            <span
                className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px]",
                    selected ? "font-semibold text-ink-hi" : "text-foreground"
                )}
            >
                {row.subject}
            </span>
            <span className="flex-none text-right text-[10.5px] tabular-nums text-muted">{row.when}</span>
        </button>
    );
}

export function CompareColumn({
    rows,
    selected,
    mergeBase,
    mergeBaseTs = 0,
    error,
    loading,
    onSelect,
    onCollapse,
}: {
    rows: CompareRow[];
    selected: string;
    mergeBase: string;
    mergeBaseTs?: number;
    error: string | null;
    loading: boolean;
    onSelect: (id: string) => void;
    onCollapse?: () => void;
}) {
    const diverges = rows.some((r) => r.kind === "commit");
    return (
        <div data-compare-column className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-[40px] flex-none items-center gap-[9px] border-b border-edge-faint pl-[14px] pr-[8px]">
                <SubLabel>Compare</SubLabel>
                <span className="min-w-0 truncate text-[10.5px] tabular-nums text-muted">
                    {splitLabel(mergeBase, mergeBaseTs, Date.now())}
                </span>
                <div className="flex-1" />
                {onCollapse ? (
                    <button
                        onClick={onCollapse}
                        title="Collapse history"
                        aria-label="Collapse history"
                        className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] text-muted hover:bg-surface hover:text-foreground"
                    >
                        <PanelLeftClose size={15} />
                    </button>
                ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-[24px]">
                {error != null ? (
                    <div className="px-[14px] py-[8px] text-[12px] text-error">{error}</div>
                ) : loading ? (
                    <CompareSkeleton />
                ) : (
                    <>
                        {rows.map((row) =>
                            row.kind === "aggregate" ? (
                                <AggregateRowView
                                    key={row.id}
                                    row={row}
                                    selected={selected === AGGREGATE}
                                    onSelect={() => onSelect(AGGREGATE)}
                                />
                            ) : row.kind === "header" ? (
                                <HeaderRowView key={row.id} row={row} />
                            ) : (
                                <CommitRowView
                                    key={row.id}
                                    row={row}
                                    selected={selected === row.id}
                                    onSelect={() => onSelect(row.id)}
                                />
                            )
                        )}
                        {/* A stated result, not an empty list: two refs that agree is an answer. */}
                        {!diverges ? (
                            <div className="px-[14px] py-[8px] text-[12px] text-ink-mid">These refs do not diverge.</div>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}
