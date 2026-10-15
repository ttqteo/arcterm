// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the session that started a run with `wsh runs start`, as the run's header and run sheet name it, and the
// other way round, the runs a session started, as its header lists them. The run keeps that session's tab and
// transcript; the tab finds it while it lives, the transcript once it has ended. A run started from the cockpit has
// neither. No React, no Wave runtime.

import type { AgentVM } from "./agentsviewmodel";
import { runProgress, runTitle, type RunInfo } from "./runlineage";
import { isTerminal } from "./runmodel";
import { queuedRows } from "./runqueuemodel";
import { sessionSelection } from "./sessionsruns";

export type RunOrigin =
    | { kind: "live"; tabId: string; name: string }
    // where opening it lands, as showSession takes it
    | { kind: "ended"; name: string; sel: string; member?: string }
    // its tab is closed and Conversation History has no session by its transcript
    | { kind: "gone" };

export function runOrigin(
    run: Pick<Run, "origintabid" | "origintranscript"> | undefined,
    roster: readonly Pick<AgentVM, "id" | "name">[],
    archive: readonly SessionActivity[] | null
): RunOrigin | null {
    if (!run?.origintabid) {
        return null;
    }
    const agent = roster.find((a) => a.id === run.origintabid);
    if (agent != null) {
        return { kind: "live", tabId: agent.id, name: agent.name };
    }
    const session = run.origintranscript ? archive?.find((s) => s.transcriptpath === run.origintranscript) : undefined;
    if (session == null) {
        return { kind: "gone" };
    }
    return { kind: "ended", name: session.task || "an untitled session", ...sessionSelection(session) };
}

// runsStartedBy is every run this session started, the ones still going first, then the newest. The tab outlives its
// session, so a run whose origin transcript is another session's was started by an earlier one in the same tab.
export function runsStartedBy(agent: Pick<AgentVM, "id" | "transcriptPath">, runs: readonly Run[]): Run[] {
    return runs
        .filter(
            (r) =>
                r.origintabid === agent.id &&
                (!r.origintranscript || !agent.transcriptPath || r.origintranscript === agent.transcriptPath)
        )
        .sort(
            (a, b) =>
                Number(isTerminal(a.status)) - Number(isTerminal(b.status)) || (b.createdts ?? 0) - (a.createdts ?? 0)
        );
}

// startedRunsText is what the header says for them: one run by its goal, several by how many and how many still go
export function startedRunsText(runs: readonly Pick<Run, "goal" | "status">[]): string {
    if (runs.length === 1) {
        return runs[0].goal?.trim().split("\n")[0] || "an untitled run";
    }
    const active = runs.filter((r) => !isTerminal(r.status)).length;
    return active > 0 ? `${runs.length} runs, ${active} active` : `${runs.length} runs`;
}

// What the tree needs of a run to say where it stands: RunInfo's, which the lineage builds for a run that has an agent
// in the roster, without its project and channel.
export type OriginRun = Pick<
    RunInfo,
    "runId" | "title" | "originId" | "status" | "landPath" | "land" | "dag" | "createdTs"
>;

// originRunInfo is a run the lineage has no agent for (held in planning, queued behind others, or over with its
// sessions closed) as the tree reads it, so a session's run chip still finds it.
export function originRunInfo(run: Run, dag: TaskGroup | undefined): OriginRun {
    return {
        runId: run.oid,
        title: runTitle(run, dag),
        originId: run.origintabid || undefined,
        status: run.status,
        landPath: run.landpath,
        land: run.land,
        createdTs: run.createdts,
        dag,
    };
}

// where a click on a session's run chip goes: a run (its row on the tree, or its sheet), or a queued entry's row
export type OriginLinkTarget = { kind: "run"; runId: string } | { kind: "queued"; entryId: string };
// label is the chip's few words beside the run glyph (empty when the glyph says it all); title names the run in full
export type OriginLink = { label: string; title: string; target: OriginLinkTarget };

// how far a run is, in the chip's words: merged or held once it has landed, else the plan's done tasks out of all of
// them. The run's title is only the tooltip's: the run's own row already says it
function runLink(run: OriginRun): { label: string; title: string } {
    const said = (label: string) => ({ label, title: label ? `${run.title} · ${label}` : run.title });
    if (run.land?.state === "landed") {
        return said("merged");
    }
    if (run.land?.state === "held") {
        return said("held");
    }
    const status = run.dag?.status ?? run.status;
    if (status === "cancelled") {
        return said("cancelled");
    }
    // done with no branch to land: nothing is still on its way in. With one, the land is what remains
    if (status === "done" && !run.land && !run.landPath) {
        return said("done");
    }
    const { done, total } = runProgress(run.dag);
    return said(total > 0 ? `${done}/${total}` : "");
}

/** Pure: the run chip on the session `agentId`'s (its tab id) meta line: where the runs it started with
 *  `wsh runs start` stand, and the plans it queued that have not started. One link reads as itself (`3/5`,
 *  `queued #2`, `merged`, `held`); two or more read `2 runs` and point at the newest. Null when there is none. */
export function originLinks(
    agentId: string,
    runs: Readonly<Record<string, OriginRun>>,
    queue: readonly RunQueueEntry[]
): OriginLink | null {
    const links: (OriginLink & { ts: number })[] = [];
    for (const run of Object.values(runs)) {
        if (run.originId === agentId) {
            links.push({ ...runLink(run), target: { kind: "run", runId: run.runId }, ts: run.createdTs ?? 0 });
        }
    }
    for (const row of queuedRows(queue, {})) {
        if (row.entry.data.origintabid === agentId) {
            const label = row.place == null ? "blocked" : `queued #${row.place}`;
            links.push({
                label,
                title: `${row.entry.title} · ${label}`,
                target: { kind: "queued", entryId: row.entry.id },
                ts: row.entry.queuedts,
            });
        }
    }
    if (links.length === 0) {
        return null;
    }
    if (links.length === 1) {
        const { label, title, target } = links[0];
        return { label, title, target };
    }
    const newest = links.reduce((a, b) => (b.ts > a.ts ? b : a));
    return {
        label: `${links.length} runs`,
        title: `${links.length} runs · newest: ${newest.title}`,
        target: newest.target,
    };
}

/** Pure: the name a run's row says it came `from`: the session that started it, while its tab is in the roster. Null
 *  for a run started from the cockpit, and once that tab is gone. */
export function originName(
    run: Pick<RunInfo, "originId">,
    agents: readonly Pick<AgentVM, "id" | "name">[]
): string | null {
    if (!run.originId) {
        return null;
    }
    return agents.find((a) => a.id === run.originId)?.name ?? null;
}
