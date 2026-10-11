// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Subagent cost card (Claude tab), under By session: one row per subagent type, and the every-type
// row last, with its samples, average and p25–p90 range. Thin: the rows come from subagentcosts.ts. A row the Token burn
// card does not price from (too few samples) is muted.

import { SkeletonLine } from "@/app/element/skeleton";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { costRows } from "./subagentcosts";

// type | samples | avg | range
const GRID = "grid grid-cols-[minmax(0,1fr)_72px_78px_120px] items-center gap-3.5 px-[18px]";
const NUM = "text-right text-[11.5px] tabular-nums text-secondary";

function SkeletonRows() {
    return (
        <div aria-hidden="true" data-subagent-costs-skeleton="">
            {[0, 1, 2].map((i) => (
                <div key={i} className={cn(GRID, "border-b border-edge-faint py-3.5 last:border-b-0")}>
                    <SkeletonLine className="h-[11px] w-[45%]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[20px]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[36px]" />
                    <SkeletonLine className="ml-auto h-[10px] w-[72px]" />
                </div>
            ))}
        </div>
    );
}

export function SubagentCostCard({ costs, loaded }: { costs: SubagentCostData[]; loaded: boolean }) {
    const rows = costRows(costs);
    return (
        <section data-subagent-costs="" className="mb-[22px] min-w-0">
            <div className="mb-3 flex items-center gap-2.5">
                <h3 className={cn(REGION_LABEL, "text-muted")}>Subagent cost</h3>
                <div className="h-px flex-1 bg-edge-faint" />
                <span className="text-[10.5px] tabular-nums text-muted">
                    finished, last 30 days · prices the Token burn card
                </span>
            </div>
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface-raised">
                {!loaded ? (
                    <SkeletonRows />
                ) : rows.length === 0 ? (
                    <div className="px-[18px] py-4 text-[12px] text-muted">
                        No finished subagents in the last 30 days
                    </div>
                ) : (
                    <>
                        <div
                            className={cn(
                                GRID,
                                "border-b border-edge-faint py-2.5 text-[10.5px] whitespace-nowrap text-muted"
                            )}
                        >
                            <span>Type</span>
                            <span className="text-right">Samples</span>
                            <span className="text-right">Avg</span>
                            <span className="text-right">Range p25–p90</span>
                        </div>
                        {rows.map((r) => (
                            <div
                                key={r.type}
                                data-subagent-cost={r.type}
                                className={cn(
                                    GRID,
                                    "border-b border-edge-faint py-2.5 last:border-b-0",
                                    r.all && "bg-surface-hover"
                                )}
                            >
                                <span
                                    className={cn(
                                        "truncate text-[12.5px] font-semibold",
                                        r.prices ? "text-primary" : "text-muted"
                                    )}
                                >
                                    {r.label}
                                </span>
                                <span className={NUM}>{r.samples}</span>
                                <span className={NUM}>{r.avg}</span>
                                <span className={NUM}>{r.range}</span>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </section>
    );
}
