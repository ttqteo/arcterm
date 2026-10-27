// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Overview's Now column: what in the project waits on you (its asking agents and the Cockpit's items for it), what
// runs in it (its agents, terminals and runs, a run's members counted as the Agent tree counts them), and its agents
// that finished a turn you have not read. Rows are projectoverviewmodel.ts's.

import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAge, type AgentVM } from "./agentsviewmodel";
import { selectAgentRow } from "./agenttree";
import type { NeedsYou } from "./needsyou";
import { CompactNeedsYouRows } from "./needsyoustrip";
import {
    askLine,
    doingLine,
    finishedRows,
    isQuiet,
    overviewRows,
    runningCount,
    type RunRow,
} from "./projectoverviewmodel";
import { StatusDot } from "./statusdot";
import { unreadAgentsAtom } from "./unreadagentsstore";

const PANEL = "overflow-hidden rounded-[8px] border border-edge-mid bg-surface-raised";
const ROW = "flex w-full items-center gap-[10px] border-t border-edge-mid px-3 py-[9px] text-left first:border-t-0";

function SectionHead({ label, count }: { label: string; count: number }) {
    return (
        <h2 className="text-[12px] font-semibold text-secondary">
            {label} <span className="font-normal tabular-nums text-muted">{count}</span>
        </h2>
    );
}

// "2 at work · 3/7 tasks": a run's members at work, and its tasks done when its dag is loaded
function runLine({ run, working }: RunRow): string {
    const tasks = run.dag?.tasks;
    const progress = tasks != null ? ` · ${tasks.filter((t) => t.state === "done").length}/${tasks.length} tasks` : "";
    return `${working} at work${progress}`;
}

export function NowColumn({ model, project, ny }: { model: AgentsViewModel; project: string; ny: NeedsYou }) {
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const now = useAtomValue(model.nowAtom);
    const unread = useAtomValue(unreadAgentsAtom);
    const rows = useMemo(
        () => overviewRows(agents, terminals, project, lineage),
        [agents, terminals, project, lineage]
    );
    const finished = useMemo(() => finishedRows(agents, project, unread), [agents, project, unread]);
    const since = (a: AgentVM) => (a.stateSince != null ? formatAge(Math.max(0, now - a.stateSince)) : "");
    const waiting = rows.asking.length + ny.rows.length;
    const running = runningCount(rows) + rows.terminals.length;
    const openRun = ({ run, lead }: RunRow) =>
        lead != null
            ? selectAgentRow(model, lead.id)
            : fireAndForget(() => openTarget(model, { kind: "run", runId: run.runId }));

    return (
        <div data-overview-now className="flex min-w-0 flex-col gap-[18px]">
            <h2 className="text-[11px] font-semibold text-muted">Now</h2>

            {isQuiet(rows, ny.rows.length, finished.length) ? (
                <p data-overview-quiet className="rounded-[8px] bg-surface p-3 text-[13px] text-muted">
                    Nothing needs you and nothing is running in {project}.
                </p>
            ) : null}

            {waiting > 0 ? (
                <section data-overview-needs aria-label="Needs you" className="flex flex-col gap-2">
                    <SectionHead label="Needs you" count={waiting} />
                    <div className={PANEL}>
                        {rows.asking.map((a) => (
                            <div key={a.id} data-overview-asking={a.id} className={ROW}>
                                <StatusDot state="asking" pulse />
                                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                    <div className="flex items-baseline gap-2">
                                        <span className="min-w-0 flex-1 truncate text-[13px] text-primary">
                                            {a.name}
                                        </span>
                                        <span className="flex-none text-[11px] tabular-nums text-ink-faint">
                                            {since(a)}
                                        </span>
                                    </div>
                                    <span className="truncate text-[12px] text-muted">
                                        <span className="text-asking">asking</span> {askLine(a)}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    data-overview-answer={a.id}
                                    onClick={() => selectAgentRow(model, a.id)}
                                    className="h-[26px] flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[12px] text-secondary hover:border-edge-strong"
                                >
                                    Answer
                                </button>
                            </div>
                        ))}
                        {ny.rows.length > 0 ? (
                            // the last row's bottom rule slides under the panel's own border
                            <div
                                className={`-mb-px px-0.5 ${rows.asking.length > 0 ? "border-t border-edge-mid" : ""}`}
                            >
                                <CompactNeedsYouRows ny={ny} />
                            </div>
                        ) : null}
                    </div>
                </section>
            ) : null}

            {running > 0 ? (
                <section data-overview-running aria-label="Running" className="flex flex-col gap-2">
                    <SectionHead label="Running" count={running} />
                    <div className={PANEL}>
                        {[...rows.working, ...rows.terminals].map((a) => (
                            <button
                                key={a.id}
                                type="button"
                                data-overview-running-row={a.id}
                                onClick={() => selectAgentRow(model, a.id)}
                                className={`${ROW} cursor-pointer hover:bg-surface-hover`}
                            >
                                <StatusDot state="working" pulse />
                                <span className="w-[120px] flex-none truncate text-[13px] text-primary">{a.name}</span>
                                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{doingLine(a)}</span>
                                <span className="w-[48px] flex-none text-right text-[11px] tabular-nums text-ink-faint">
                                    {since(a)}
                                </span>
                            </button>
                        ))}
                        {rows.runs.map((r) => (
                            <button
                                key={r.run.runId}
                                type="button"
                                data-overview-running-run={r.run.runId}
                                onClick={() => openRun(r)}
                                className={`${ROW} cursor-pointer hover:bg-surface-hover`}
                            >
                                <StatusDot state="working" pulse />
                                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                    <span className="truncate text-[13px] text-primary">{r.run.title}</span>
                                    <span className="truncate text-[12px] text-muted">{runLine(r)}</span>
                                </div>
                                <span className="w-[48px] flex-none text-right text-[11px] tabular-nums text-ink-faint">
                                    {r.lead != null ? since(r.lead) : ""}
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}

            {finished.length > 0 ? (
                <section data-overview-finished aria-label="Finished, not read yet" className="flex flex-col gap-2">
                    <SectionHead label="Finished, not read yet" count={finished.length} />
                    <div className={PANEL}>
                        {finished.map((a) => (
                            <button
                                key={a.id}
                                type="button"
                                data-overview-finished-row={a.id}
                                onClick={() => selectAgentRow(model, a.id)}
                                className={`${ROW} cursor-pointer hover:bg-surface-hover`}
                            >
                                <span
                                    aria-hidden="true"
                                    className="h-[7px] w-[7px] flex-none rounded-full border-[1.5px] border-muted"
                                />
                                <span className="w-[120px] flex-none truncate text-[13px] text-primary">{a.name}</span>
                                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{doingLine(a)}</span>
                                <span className="w-[48px] flex-none text-right text-[11px] tabular-nums text-ink-faint">
                                    {since(a)}
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    );
}
