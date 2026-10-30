// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Overview's Branches card: the newest commits of every branch of the project's checkout (git log --all) over the
// commit graph's lanes, the uncommitted row on top. A row opens that commit in the Diff surface's Log, the uncommitted
// row the Diff surface itself. The rows are projectgraph.ts's; the lanes and the gutter are the Log's own (gitgraph.ts,
// gitgraphgeom.ts, graphgutter.tsx).

import { SkeletonLine } from "@/app/element/skeleton";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openDiff, projectDiffScope } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import { showInLog } from "./commitstore";
import { assignLanes } from "./gitgraph";
import { graphGeometry } from "./gitgraphgeom";
import { GraphGutter } from "./graphgutter";
import { authorInitials, refChipClass, rowTitle } from "./historyrows";
import {
    GRAPH_CARD_LIMIT,
    GRAPH_CARD_MAX_LANES,
    GRAPH_CARD_ROW_H,
    graphCardRows,
    graphCardSummary,
    rowChips,
} from "./projectgraph";

type GraphRead =
    | { status: "loading" }
    | { status: "ready"; commits: HistoryCommit[]; head: string }
    | { status: "none" } // not a repository, or one with no commits yet
    | { status: "failed"; error: string };

// the newest commits of every ref, read once per project shown and again on Retry or when its dirty count changes
function useProjectGraph(path: string, dirty: number): { read: GraphRead; retry: () => void } {
    const [read, setRead] = useState<GraphRead>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        setRead((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
        let live = true;
        RpcApi.GitHistoryCommand(TabRpcClient, { cwd: path, limit: GRAPH_CARD_LIMIT })
            .then((r) => {
                if (!live) {
                    return;
                }
                if (r.failure != null) {
                    setRead({ status: "failed", error: r.failure.stderr?.trim() || r.failure.command });
                } else if (!r.isrepo || (r.commits ?? []).length === 0) {
                    setRead({ status: "none" });
                } else {
                    setRead({ status: "ready", commits: r.commits, head: r.head ?? "" });
                }
            })
            .catch((e) => {
                if (live) {
                    setRead({ status: "failed", error: String((e as Error)?.message ?? e) });
                }
            });
        return () => {
            live = false;
        };
    }, [path, dirty, attempt]);
    return { read, retry: () => setAttempt((n) => n + 1) };
}

const SMALL_BTN =
    "flex h-[26px] flex-none cursor-pointer items-center gap-[4px] rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[12px] text-secondary hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SECTION =
    "flex flex-col gap-[10px] rounded-[8px] border border-edge-mid bg-surface-raised px-[18px] pb-3 pt-[14px]";
const HASH_W = 52;

export function GraphCard({
    model,
    project,
    path,
    dirty,
}: {
    model: AgentsViewModel;
    project: string;
    path: string;
    dirty: number; // the checkout's uncommitted file count, 0 when clean or not read yet
}) {
    const { read, retry } = useProjectGraph(path, dirty);
    const now = useAtomValue(model.nowAtom);
    const rows = useMemo(
        () => (read.status === "ready" ? graphCardRows(read.commits, read.head, dirty, now) : []),
        [read, dirty, now]
    );
    if (read.status === "none") {
        return null;
    }
    const scope = projectDiffScope(project, path);
    const open = (hash?: string) => {
        openDiff(model, scope);
        if (hash) {
            showInLog(path, hash);
        }
    };
    const header = (summary: string | null) => (
        <div className="flex items-center gap-3">
            <h2 className="text-[11px] font-semibold text-muted">Branches</h2>
            {summary ? (
                <span data-graph-summary className="text-[12px] tabular-nums text-secondary">
                    {summary}
                </span>
            ) : null}
            <span className="flex-1" />
            <button type="button" data-graph-open-diff onClick={() => open()} className={SMALL_BTN}>
                Open in Diff
                <ArrowUpRight size={12} aria-hidden />
            </button>
        </div>
    );

    if (read.status === "failed") {
        return (
            <section data-graph-card aria-label="Branches" className={SECTION}>
                {header(null)}
                <div data-graph-error className="flex items-center gap-3 text-[12px] text-muted">
                    <span className="min-w-0 truncate">Could not read the commits: {read.error}</span>
                    <button type="button" data-graph-retry onClick={retry} className={SMALL_BTN}>
                        Retry
                    </button>
                </div>
            </section>
        );
    }
    if (read.status === "loading") {
        return (
            <section data-graph-card aria-label="Branches" aria-busy="true" className={SECTION}>
                {header(null)}
                <div aria-hidden className="flex flex-col">
                    {["w-[46%]", "w-[38%]", "w-[52%]", "w-[30%]"].map((w, i) => (
                        <div key={i} style={{ height: GRAPH_CARD_ROW_H }} className="flex items-center gap-[10px]">
                            <SkeletonLine className="h-[9px] w-[9px] rounded-full" />
                            <SkeletonLine className={cn("h-[8px]", w)} />
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    const laned = assignLanes(rows);
    // stubs: a parent older than the read draws a dashed line on down, so a branch does not look like it starts there
    const geom = graphGeometry(laned, { rowH: GRAPH_CARD_ROW_H, maxLanes: GRAPH_CARD_MAX_LANES, stubs: true });
    return (
        <section data-graph-card aria-label="Branches" className={SECTION}>
            {header(graphCardSummary(rows))}
            <div className="relative flex flex-col">
                <GraphGutter geom={geom} />
                {laned.map((row) => {
                    const { chips, more } = rowChips(row);
                    return (
                        <button
                            key={row.hash || "__wt__"}
                            type="button"
                            data-graph-row={row.workingTree ? "worktree" : row.hash}
                            onClick={() => open(row.workingTree ? undefined : row.hash)}
                            title={rowTitle(row)}
                            style={{ height: GRAPH_CARD_ROW_H, paddingLeft: geom.gutter }}
                            className="relative flex w-full cursor-pointer items-center gap-[8px] rounded-[7px] pr-[8px] text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {row.workingTree ? null : (
                                <span style={{ width: HASH_W }} className="flex-none font-mono text-[11px] text-muted">
                                    {row.hash.slice(0, 7)}
                                </span>
                            )}
                            {chips.map((r) => (
                                <span
                                    key={r.label}
                                    className={cn(
                                        "max-w-[160px] flex-none truncate rounded-[5px] border px-[5px] text-[10.5px] font-semibold leading-[17px]",
                                        refChipClass(r.kind)
                                    )}
                                >
                                    {r.label}
                                </span>
                            ))}
                            {more > 0 ? (
                                <span className="flex-none rounded-[5px] border border-edge-mid bg-surface px-[5px] text-[10.5px] font-semibold leading-[17px] tabular-nums text-muted">
                                    +{more}
                                </span>
                            ) : null}
                            <span
                                className={cn(
                                    "min-w-0 flex-1 truncate text-[12.5px]",
                                    row.workingTree ? "font-semibold text-warning" : "text-foreground"
                                )}
                            >
                                {row.subject}
                            </span>
                            {row.workingTree ? (
                                <span className="flex-none text-[11px] tabular-nums text-ink-mid">
                                    {row.fileCount} {row.fileCount === 1 ? "file" : "files"}
                                </span>
                            ) : (
                                <span
                                    aria-hidden
                                    className="flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full border border-edge-mid bg-surface text-xxxs font-semibold leading-none text-ink-mid"
                                >
                                    {authorInitials(row.author)}
                                </span>
                            )}
                            <span className="w-[36px] flex-none text-right text-[11px] tabular-nums text-muted">
                                {row.when}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
