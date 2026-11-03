// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Agent → Councils (agentcenter.ts' `councils` mode): every council of every project, the ones the person closed too,
// as a list grouped Today / Yesterday / Earlier, the way the Canvas gallery shows its canvases. The tree lists only the
// councils still open, so this is where a closed one is found again; a row opens the council (showCouncil), whose
// header's Reopen puts it back in the tree. Thin: the rows, the search and the groups come from councilhistory.ts.

import { SkeletonLine } from "@/app/element/skeleton";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { Search, Users } from "lucide-react";
import { useMemo, type KeyboardEvent } from "react";
import { showCouncil } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { formatAgeShort } from "./agentsviewmodel";
import { COUNCIL_TONE, CouncilSeatPair } from "./agenttree";
import {
    councilHistoryCount,
    councilHistoryRows,
    groupCouncilHistory,
    searchCouncilHistory,
    type CouncilHistoryRow,
} from "./councilhistory";
import { councilUnreadAtom, useCouncils } from "./councilstore";
import { projectsAtom } from "./projectsstore";

// the search survives the centre leaving Councils (a row opens a council, which unmounts this view)
const councilHistoryQueryAtom = atom("") as PrimitiveAtom<string>;

export function CouncilHistory({ model }: { model: AgentsViewModel }) {
    const councils = useCouncils("");
    const unread = useAtomValue(councilUnreadAtom);
    const registered = useAtomValue(projectsAtom);
    const now = useAtomValue(model.nowAtom);
    const [query, setQuery] = useAtom(councilHistoryQueryAtom);
    // project name -> root path, as the tree builds it, so a council reads its folder's name
    const roots = useMemo(() => {
        const out = new Map<string, string>();
        for (const [name, project] of Object.entries(registered ?? {})) {
            if (project?.path) {
                out.set(name, project.path);
            }
        }
        return out;
    }, [registered]);
    const rows = useMemo(() => councilHistoryRows(councils, roots, unread), [councils, roots, unread]);
    const groups = groupCouncilHistory(searchCouncilHistory(rows, query), now);
    const has = rows.length > 0;
    const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Escape") {
            return;
        }
        // a first Escape empties the box, the next leaves it, so a third (agent:leave-center) goes back to the terminal
        e.preventDefault();
        if (query !== "") {
            setQuery("");
        } else {
            e.currentTarget.blur();
        }
    };

    return (
        <div data-council-history className="flex min-h-0 flex-1 flex-col bg-background">
            <div className="flex flex-none items-center gap-[10px] border-b border-border px-[24px] pb-[14px] pt-[18px]">
                <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-primary">Councils</h1>
                {councils != null ? (
                    <span
                        data-council-history-count
                        className="inline-flex flex-none items-center rounded-full bg-pill px-[9px] py-[3px] text-[10.5px] tabular-nums text-secondary"
                    >
                        {councilHistoryCount(rows)}
                    </span>
                ) : null}
                <div className="flex-1" />
                {has ? (
                    <label className="flex h-[28px] w-[240px] flex-none items-center gap-2 rounded-[6px] border border-edge-mid bg-surface-raised pl-[10px] pr-2 focus-within:border-edge-strong">
                        <Search size={13} strokeWidth={1.8} className="flex-none text-muted" aria-hidden />
                        <input
                            data-council-history-search
                            aria-label="Search councils"
                            placeholder="Search features, questions, projects"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={onSearchKey}
                            className="min-w-0 flex-1 bg-transparent text-[12px] text-primary outline-none placeholder:text-muted"
                        />
                    </label>
                ) : null}
            </div>
            {councils == null ? (
                <div aria-hidden="true" className="flex flex-col gap-[14px] px-[24px] pt-[28px]">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="flex flex-col gap-[6px]">
                            <SkeletonLine className="h-[13px] w-1/2" />
                            <SkeletonLine className="h-[11px] w-1/4" />
                        </div>
                    ))}
                </div>
            ) : !has ? (
                <div
                    data-council-history-empty="none"
                    className="flex flex-1 flex-col items-center justify-center gap-2 px-12 text-center"
                >
                    <Users size={28} strokeWidth={1.6} className="text-ink-faint" aria-hidden />
                    <span className="text-[13.5px] font-semibold text-primary">No councils yet</span>
                    <span className="max-w-[380px] text-[12.5px] leading-[1.5] text-muted">
                        Start one from New → Council, or ask an agent for one. Every council shows up here, closed ones
                        too, and stays until you remove it.
                    </span>
                </div>
            ) : groups.length === 0 ? (
                <div
                    data-council-history-empty="search"
                    className="flex flex-1 flex-col items-center justify-center gap-2 px-12 text-center"
                >
                    <span className="text-[13.5px] font-semibold text-primary">
                        No council matches “{query.trim()}”
                    </span>
                    <span className="text-[12.5px] text-muted">
                        The search reads features, questions and project names.{" "}
                        <button
                            type="button"
                            onClick={() => setQuery("")}
                            className="cursor-pointer text-accent hover:text-accenthover"
                        >
                            Clear the search
                        </button>
                    </span>
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[40px] pt-[6px]">
                    <div className="mx-auto max-w-[860px]">
                        {groups.map((grp) => (
                            <div key={grp.key} data-council-history-group={grp.key}>
                                <div className="flex items-center gap-[10px] px-[2px] pb-[6px] pt-[18px]">
                                    <span className={cn(REGION_LABEL, "text-muted")}>{grp.label}</span>
                                    <div className="h-px flex-1 bg-edge-faint" />
                                    <span className="text-[10.5px] tabular-nums text-muted">{grp.rows.length}</span>
                                </div>
                                {grp.rows.map((r) => (
                                    <CouncilHistoryRowView key={r.id} row={r} now={now} />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// One council: its seats' picture, its feature, then its project, its state in a word in its tone, and Pinned when the
// person pinned it; the time since its newest message at the right. A click opens it.
function CouncilHistoryRowView({ row, now }: { row: CouncilHistoryRow; now: number }) {
    const tone = COUNCIL_TONE[row.tone];
    return (
        <button
            type="button"
            data-council-history-row={row.id}
            data-council-history-pinned={row.pinned ? "" : undefined}
            title={row.question !== "" ? `${row.feature}\n${row.question}` : row.feature}
            onClick={() => showCouncil(row.id)}
            className="group/council flex w-full cursor-pointer items-center gap-[12px] rounded-[8px] px-[10px] py-[8px] text-left transition-colors duration-[140ms] hover:bg-surface-hover"
        >
            <CouncilSeatPair seats={row.seats} dot={row.dot} selected={false} onPage />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-[6px]">
                    <span className="min-w-0 truncate text-[13px] leading-[17px] text-primary">{row.feature}</span>
                    {row.unread ? (
                        <span
                            role="img"
                            aria-label="Not opened since it ended"
                            className="h-[6px] w-[6px] flex-none rounded-full bg-primary"
                        />
                    ) : null}
                </div>
                <div className="mt-[2px] flex min-w-0 items-center text-[11.5px] leading-[15px]">
                    <span className="flex-none text-secondary">{row.projectName}</span>
                    <span className="min-w-0 truncate">
                        <span className="text-muted">&nbsp;·&nbsp;</span>
                        <span className={tone.text}>{row.meta}</span>
                    </span>
                </div>
            </div>
            {row.pinned ? (
                <span className="flex-none rounded-full bg-pill px-[8px] py-[2px] text-[10.5px] text-muted">
                    Pinned
                </span>
            ) : null}
            <span className="w-[44px] flex-none text-right text-[11.5px] tabular-nums text-muted">
                {formatAgeShort(now - row.lastAt)}
            </span>
        </button>
    );
}
