// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Inline live-worker visibility for the Runs view. A running phase's worker opens into a compact
// sibling of the Agents-tab card (agentrow.tsx): current activity + the shared NarrationTimeline feed
// + task progress, so you can tell "is it working or stuck?" without leaving Runs. RunRollup is the
// one-line "now" strip under the run header. Both read the live transcript atoms (keyed by tab id)
// that runbody.tsx streams for the active run's workers. Adapts Wave-runs.dc.html Turn 3 (3a + C)
// to our @theme tokens — no raw hex; working = accent (StatusDot is the source of truth).

import { Meter } from "@/app/element/meter";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import {
    displayAgeMs,
    formatAge,
    isQuiet,
    latestMessageText,
    taskProgress,
    type AgentEntry,
    type AgentVM,
} from "./agentsviewmodel";
import { jumpToAgent } from "./channelsprimitives";
import { liveEntriesByIdAtom } from "./livetranscript";
import { activityAtomFor, entriesAtomFor, tasksAtomFor } from "./livetranscriptatoms";
import { NarrationTimeline } from "./narrationtimeline";
import { AgentPathLinks } from "./pathlinkcontext";
import { RuntimeMark } from "./runtimemark";
import { runtimeMeta } from "./runtimemeta";
import { StatusDot } from "./statusdot";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";

// The current-activity line: reporter's live line while working, else the latest assistant message.
function currentLine(agent: AgentVM, entries: AgentEntry[]): string | undefined {
    return agent.activity ?? latestMessageText(entries);
}

export function RunWorkerCard({
    model,
    agent,
    now,
    fill,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    now: number;
    fill?: boolean;
}) {
    const [open, setOpen] = useState(true);
    const liveEntries = useAtomValue(entriesAtomFor(agent.id));
    const lastActivityStamp = useAtomValue(activityAtomFor(agent.id));
    const tasks = useAtomValue(tasksAtomFor(agent.id));

    const entries = liveEntries.length > 0 ? liveEntries : (agent.previousInfo ?? []);
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries);
    const prog = tasks && tasks.length > 0 ? taskProgress(tasks) : undefined;
    const working = agent.state === "working";
    const quiet = working && isQuiet(lastActivityStamp, now);
    const rt = runtimeMeta(agent.agent);
    const current = currentLine(agent, entries);
    const quietSecs = quiet ? Math.floor(Math.max(0, now - (lastActivityStamp ?? now)) / 1000) : 0;

    return (
        <div
            className={cn(
                "overflow-hidden rounded-[13px] border border-edge-mid bg-lane",
                fill && "flex min-h-0 flex-1 flex-col"
            )}
        >
            {/* worker header — click to collapse */}
            <div
                onClick={() => setOpen((o) => !o)}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-hover"
            >
                <StatusDot state={agent.state} quiet={quiet} pulse={working && !quiet} className="!h-2 !w-2" />
                <span title={rt.label} className="shrink-0">
                    <RuntimeMark
                        runtime={agent.agent}
                        className={cn("shrink-0 text-[10px] leading-none", rt.text)}
                    />
                </span>
                <b className="shrink-0 text-[13px] font-semibold text-primary">{agent.name}</b>
                {agent.model ? (
                    <span className="shrink-0 rounded-[5px] border border-edge-mid bg-surface-raised px-1.5 py-px text-[9.5px] text-muted">
                        {agent.model}
                    </span>
                ) : null}
                <div className="min-w-[6px] flex-1" />
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted">
                    {formatAge(displayAgeMs(agent, now))}
                </span>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        jumpToAgent(model, agent.id);
                    }}
                    title="Open worker terminal"
                    className="shrink-0 text-[10.5px] text-accent hover:text-accent-soft"
                >
                    open ↗
                </button>
                <span className="shrink-0 text-xxxs text-edge-strong">{open ? "▼" : "▶"}</span>
            </div>

            {/* streaming flow bar — a subtle accent sweep while the worker actively narrates */}
            {working && !quiet ? (
                <div className="h-[2px] overflow-hidden bg-lane">
                    <div className="h-full w-[26%] bg-gradient-to-r from-transparent via-accent to-transparent animate-[flowBar_1.9s_linear_infinite] motion-reduce:animate-none" />
                </div>
            ) : null}

            {open ? (
                <>
                    {/* current activity — quiet reads as "still working", never alarming */}
                    {quiet ? (
                        <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted" />
                            <span className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] tabular-nums text-muted">
                                Still working — no new output for {quietSecs}s
                            </span>
                        </div>
                    ) : current ? (
                        <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                            {working ? (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success pulse-dot" />
                            ) : null}
                            <span
                                title={current}
                                className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-success-soft"
                            >
                                {current}
                            </span>
                        </div>
                    ) : null}

                    {/* live feed — capped in pipeline (many stacked cards); fills in the orchestrator body */}
                    {entries.length > 0 ? (
                        <div className={cn("relative", fill && "min-h-0 flex-1")}>
                            <div
                                ref={scrollRef}
                                onScroll={onScroll}
                                className={cn("sc overflow-y-auto px-3 pb-2", fill ? "h-full" : "max-h-[260px]")}
                            >
                                <AgentPathLinks agent={agent}>
                                    <NarrationTimeline entries={entries} accentLatest active={working} />
                                </AgentPathLinks>
                            </div>
                            {!atBottom ? <JumpToLatestPill onClick={jumpToBottom} /> : null}
                        </div>
                    ) : fill ? (
                        // hold the vertical space so the lead card still fills before its first entries stream in
                        <div className="min-h-0 flex-1" />
                    ) : null}

                    {/* task progress */}
                    {prog ? (
                        <div className="border-t border-edge-mid px-3 py-2">
                            <div className="mb-1 flex items-center gap-2">
                                <span className="text-xxxs font-bold uppercase tracking-[0.08em] text-muted">
                                    Task
                                </span>
                                <div className="flex-1" />
                                <span className="text-[10px] tabular-nums text-secondary">
                                    {prog.done}/{prog.total}
                                </span>
                                <span className="text-[10px] font-bold tabular-nums text-success">{prog.pct}%</span>
                            </div>
                            <Meter pct={prog.pct} fill="bg-success" height={5} radius={3} track="bg-edge-faint" />
                        </div>
                    ) : null}
                </>
            ) : (
                /* collapsed one-liner */
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-0.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{current ?? "…"}</span>
                    {prog ? (
                        <span className="shrink-0 text-[10px] font-bold tabular-nums text-success">{prog.pct}%</span>
                    ) : null}
                </div>
            )}
        </div>
    );
}

// A finished phase's feed, folded into a de-emphasized, expandable history row (Wave-runs.dc.html
// done/ship state study). The worker has usually left the roster, so this reads the entries we cached
// while it streamed (liveEntriesByIdAtom, keyed by the phase's recorded worker tab ids). Renders
// nothing when we never watched the worker (e.g. the phase finished before the run was opened) — no
// fabricated history. Diff stats are omitted deliberately: Runs doesn't track per-worker git.
export function PhaseHistory({ tabIds }: { tabIds: string[] }) {
    const [open, setOpen] = useState(false);
    const liveEntries = useAtomValue(liveEntriesByIdAtom);
    const id = tabIds.find((t) => (liveEntries[t]?.length ?? 0) > 0);
    const entries = id ? liveEntries[id] : undefined;
    if (!entries || entries.length === 0) {
        return null;
    }
    return (
        <div className="mt-2 overflow-hidden rounded-[9px] border border-edge-mid bg-background">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-hover"
            >
                <span className="shrink-0 text-xxxs text-edge-strong">{open ? "▼" : "▶"}</span>
                <span className="text-xxxs font-bold uppercase tracking-[0.08em] text-muted">History</span>
                <span className="text-[11px] tabular-nums text-secondary">
                    {entries.length} step{entries.length === 1 ? "" : "s"}
                </span>
            </button>
            {open ? (
                <div className="sc max-h-[300px] overflow-y-auto border-t border-edge-mid px-3 pb-2 opacity-80">
                    <NarrationTimeline entries={entries} active={false} />
                </div>
            ) : null}
        </div>
    );
}

// The header "now" strip: one live line summarizing the run's primary active worker. Best at-a-glance
// signal that the run is alive; the per-worker cards below carry the detail.
export function RunRollup({ agent, now }: { agent: AgentVM; now: number }) {
    const liveEntries = useAtomValue(entriesAtomFor(agent.id));
    const lastActivityStamp = useAtomValue(activityAtomFor(agent.id));
    const entries = liveEntries.length > 0 ? liveEntries : (agent.previousInfo ?? []);
    const current = currentLine(agent, entries);
    const quiet = agent.state === "working" && isQuiet(lastActivityStamp, now);
    if (!current) {
        return null;
    }
    return (
        <div className="mb-4 flex items-center gap-2.5 rounded-[10px] border border-accent/25 bg-background px-3.5 py-2.5">
            <StatusDot state={agent.state} quiet={quiet} pulse={!quiet} className="!h-[7px] !w-[7px]" />
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-accent-soft">
                now
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">{current}</span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-muted">
                {agent.name} · {formatAge(displayAgeMs(agent, now))}
            </span>
        </div>
    );
}
