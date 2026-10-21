// frontend/app/view/agents/railcommitssection.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Changes tab's Commits section: the commits of the files list's range over the graph's lanes, the uncommitted row on
// top, the range's root at the foot. A view over railcommits.ts and railcommitsstore.ts.

import { SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { ArrowUpRight, ChevronRight, CircleAlert, GitCommitHorizontal } from "lucide-react";
import { assignLanes } from "./gitgraph";
import { graphGeometry } from "./gitgraphgeom";
import { GraphGutter } from "./graphgutter";
import { refChipClass } from "./historyrows";
import { RAIL_MAX_LANES, RAIL_ROW_H, railCommitTitle, type RailCommitRows } from "./railcommits";

export function RailCommitsSection({
    view,
    status,
    failure,
    open,
    summary,
    committing,
    onToggle,
    onOpenCommit,
    onUncommitted,
    onMore,
    onRetry,
}: {
    view: RailCommitRows;
    status: "loading" | "ready" | "failed";
    failure: GitFailure | null;
    open: boolean;
    summary: string;
    committing: boolean; // commit mode is open: the uncommitted row is what it commits
    onToggle: () => void;
    onOpenCommit: (hash: string) => void;
    onUncommitted: () => void;
    onMore: () => void;
    onRetry: () => void;
}) {
    const laned = assignLanes(view.rows);
    // stubs: an edge into the commits before the range, and past the cap the line running on into the More row
    const geom = graphGeometry(laned, { rowH: RAIL_ROW_H, maxLanes: RAIL_MAX_LANES, stubs: true });
    const pad = { height: RAIL_ROW_H, paddingLeft: geom.gutter };
    const selectedIndex = committing ? view.rows.findIndex((r) => r.workingTree) : -1;
    return (
        <section data-rail-commits className="mb-[6px]">
            <h3 className="text-[12px] font-medium">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={onToggle}
                    className="group flex w-full cursor-pointer items-center gap-[8px] rounded-[6px] py-[5px] text-left text-secondary hover:text-primary"
                >
                    <GitCommitHorizontal size={13} aria-hidden className="flex-none" />
                    Commits
                    {view.count > 0 ? (
                        <span className="text-[11px] tabular-nums text-muted">
                            {view.count}
                            {view.more ? "+" : ""}
                        </span>
                    ) : null}
                    {!open && summary ? (
                        <span className="min-w-0 truncate text-[11px] font-normal text-ink-faint">{summary}</span>
                    ) : null}
                    <ChevronRight
                        size={12}
                        aria-hidden
                        className={cn("flex-none text-muted transition-transform", open && "rotate-90")}
                    />
                </button>
            </h3>
            {!open ? null : status === "loading" && view.count === 0 ? (
                <div aria-hidden data-rail-commits-skeleton className="flex flex-col pt-[4px]">
                    {["w-[70%]", "w-[55%]", "w-[62%]"].map((w, i) => (
                        <div key={i} style={{ height: RAIL_ROW_H }} className="flex items-center gap-[10px] pl-[6px]">
                            <SkeletonLine className="h-[9px] w-[9px] rounded-full" />
                            <SkeletonLine className={cn("h-[8px]", w)} />
                        </div>
                    ))}
                </div>
            ) : status === "failed" && failure ? (
                <div
                    role="alert"
                    data-rail-commits-failure
                    className="mt-[4px] flex items-start gap-[8px] rounded-[8px] border border-edge-mid bg-surface px-[10px] py-[8px]"
                >
                    <CircleAlert size={13} aria-hidden className="mt-[1px] flex-none text-error" />
                    <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] font-semibold text-ink-hi">Couldn't read the commits</div>
                        <div className="mt-[2px] break-words text-[10.5px] text-muted">
                            <span className="font-mono">{failure.command}</span>
                            {failure.stderr ? `: ${failure.stderr.trim()}` : ""}
                        </div>
                    </div>
                    <button
                        type="button"
                        data-rail-commits-retry
                        onClick={onRetry}
                        className="flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[8px] py-[3px] text-[11px] font-semibold text-ink-hi hover:border-edge-strong"
                    >
                        Retry
                    </button>
                </div>
            ) : (
                <div className="relative flex flex-col pt-[4px]">
                    <div className="absolute left-0 top-[4px]">
                        <GraphGutter geom={geom} selectedIndex={selectedIndex} />
                    </div>
                    {view.rows.map((row, i) =>
                        row.workingTree ? (
                            <button
                                key="uncommitted"
                                type="button"
                                data-rail-commit-uncommitted
                                onClick={onUncommitted}
                                title="Tick the files and commit them here"
                                style={pad}
                                className={cn(
                                    "flex w-full cursor-pointer items-center gap-[7px] rounded-[7px] pr-[6px] text-left hover:bg-surface-hover",
                                    i === selectedIndex && "bg-surface-selected"
                                )}
                            >
                                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-warning">
                                    {row.subject}
                                </span>
                                <span className="flex-none text-[10.5px] tabular-nums text-ink-mid">
                                    {row.fileCount} {row.fileCount === 1 ? "file" : "files"}
                                </span>
                            </button>
                        ) : row.boundary ? (
                            <div
                                key="root"
                                data-rail-commit-root
                                style={pad}
                                className="flex items-center gap-[7px] pr-[6px]"
                            >
                                <span className="flex-none font-mono text-[10.5px] text-ink-faint">
                                    {row.hash.slice(0, 7)}
                                </span>
                                {row.refs.map((r) => (
                                    <span
                                        key={r.label}
                                        className={cn(
                                            "max-w-[90px] flex-none truncate rounded-[5px] border px-[5px] text-[10px] font-semibold leading-[16px]",
                                            refChipClass(r.kind)
                                        )}
                                    >
                                        {r.label}
                                    </span>
                                ))}
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{row.subject}</span>
                            </div>
                        ) : (
                            <button
                                key={row.hash}
                                type="button"
                                data-rail-commit={row.hash}
                                onClick={() => onOpenCommit(row.hash)}
                                title={railCommitTitle(row)}
                                style={pad}
                                className="flex w-full cursor-pointer items-center gap-[7px] rounded-[7px] pr-[6px] text-left hover:bg-surface-hover"
                            >
                                <span className="flex-none font-mono text-[10.5px] text-muted">
                                    {row.hash.slice(0, 7)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                                    {row.subject}
                                </span>
                                <span className="flex-none text-[10.5px] tabular-nums text-muted">{row.when}</span>
                            </button>
                        )
                    )}
                    {view.more ? (
                        <div style={pad} className="flex items-center">
                            <button
                                type="button"
                                data-rail-commits-more
                                onClick={onMore}
                                className="inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                            >
                                More in Diff
                                <ArrowUpRight size={11} aria-hidden />
                            </button>
                        </div>
                    ) : null}
                </div>
            )}
        </section>
    );
}
