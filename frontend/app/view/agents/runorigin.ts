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
    // where opening it lands, as showLibrarySession takes it
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

// startedRunsShown is the runs the header counts and its menu lists: a cancelled run counts for none of them, as on the
// tree's run chip (originLinks); when cancelled runs are all there is, the newest stands for them alone
export function startedRunsShown<T extends Pick<Run, "status"> & { createdts?: number }>(runs: readonly T[]): T[] {
    const counted = runs.filter((r) => r.status !== "cancelled");
    if (counted.length > 0 || runs.length === 0) {
        return counted;
    }
    return [runs.reduce((a, b) => ((b.createdts ?? 0) > (a.createdts ?? 0) ? b : a))];
}

// finishedRun reports whether a run a session started is over with nothing left for the person: landed, failed,
// cancelled, or done with no branch to land. A held land, or a done run whose branch has yet to land, still waits on
// them. Only a finished run can be hidden from its session's run chip.
export function finishedRun(run: { status?: string; land?: Pick<RunLand, "state">; landPath?: string }): boolean {
    if (run.land?.state === "landed") {
        return true;
    }
    if (run.land?.state === "held") {
        return false;
    }
    if (run.status === "failed" || run.status === "cancelled") {
        return true;
    }
    return run.status === "done" && !run.land && !run.landPath;
}

// The run ids the person hid from their sessions' run chips (localStorage agents.hiddenRuns), newest last. Bad or
// missing storage reads as none hidden.
export const HIDDEN_RUNS_CAP = 500;
export function parseHiddenRuns(raw: string | null): string[] {
    if (!raw) {
        return [];
    }
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

// withHiddenRuns adds `ids` to the hidden list, each once, dropping the oldest past the cap
export function withHiddenRuns(prev: readonly string[], ids: readonly string[]): string[] {
    const next = prev.filter((id) => !ids.includes(id)).concat([...new Set(ids)]);
    return next.slice(Math.max(0, next.length - HIDDEN_RUNS_CAP));
}

// startedRunsText is what the header says for them (startedRunsShown): one run by its goal, marked when it was
// cancelled, several by how many and how many still go
export function startedRunsText(runs: readonly (Pick<Run, "goal" | "status"> & { createdts?: number })[]): string {
    const shown = startedRunsShown(runs);
    if (shown.length === 1) {
        const goal = shown[0].goal?.trim().split("\n")[0] || "an untitled run";
        return shown[0].status === "cancelled" ? `${goal} · cancelled` : goal;
    }
    const active = shown.filter((r) => !isTerminal(r.status)).length;
    return active > 0 ? `${shown.length} runs, ${active} active` : `${shown.length} runs`;
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
 *  `plan queued #2`, `merged`, `held`); two or more read `2 runs` and point at the newest. A cancelled run counts
 *  for none of them: the chip reads `cancelled` (the newest) only when cancelled runs are all there is. Null when
 *  there is none.
 *  A queued link names the plan, since the chip also sits on a lead's own working run line: a bare `queued #1` there
 *  read as that run waiting in line, when it is the next part the lead queued. */
export function originLinks(
    agentId: string,
    runs: Readonly<Record<string, OriginRun>>,
    queue: readonly RunQueueEntry[],
    hidden: ReadonlySet<string> = new Set()
): OriginLink | null {
    const links: (OriginLink & { ts: number })[] = [];
    // a cancelled run is not counted among them; it stands for itself only while the session has nothing else
    const cancelled: (OriginLink & { ts: number })[] = [];
    for (const run of Object.values(runs)) {
        if (run.originId === agentId && !hidden.has(run.runId)) {
            const link = {
                ...runLink(run),
                target: { kind: "run", runId: run.runId } as const,
                ts: run.createdTs ?? 0,
            };
            (link.label === "cancelled" ? cancelled : links).push(link);
        }
    }
    for (const row of queuedRows(queue, {})) {
        if (row.entry.data.origintabid === agentId) {
            const label = row.place == null ? "plan blocked" : `plan queued #${row.place}`;
            links.push({
                label,
                title: `${row.entry.title} · ${label}`,
                target: { kind: "queued", entryId: row.entry.id },
                ts: row.entry.queuedts,
            });
        }
    }
    const newestOf = (of: typeof links) => of.reduce((a, b) => (b.ts > a.ts ? b : a));
    if (links.length === 0) {
        if (cancelled.length === 0) {
            return null;
        }
        const { label, title, target } = newestOf(cancelled);
        return { label, title, target };
    }
    if (links.length === 1) {
        const { label, title, target } = links[0];
        return { label, title, target };
    }
    const newest = newestOf(links);
    return {
        label: `${links.length} runs`,
        title: `${links.length} runs · newest: ${newest.title}`,
        target: newest.target,
    };
}

/** Pure: whether a brainstorm's run line should give way to the session's run chip: its run was cancelled and the
 *  chip already names something newer (a plan queued to run again, another run), so the row would otherwise read two
 *  states at once, `plan queued #1` beside `cancelled · run b0f9b964`. */
export function brainstormRunSuperseded(
    runId: string | undefined,
    status: string | undefined,
    link: OriginLink | null
): boolean {
    if (runId == null || status !== "cancelled" || link == null) {
        return false;
    }
    return !(link.target.kind === "run" && link.target.runId === runId);
}

/** Pure: the runs the session `agentId`'s chip counts (originLinks, with the same `hidden`) that a Hide would take off
 *  it: the finished ones. Empty when the chip shows only work still going, so it offers no Hide. */
export function hideableOriginRuns(
    agentId: string,
    runs: Readonly<Record<string, OriginRun>>,
    hidden: ReadonlySet<string>
): string[] {
    return Object.values(runs)
        .filter(
            (r) =>
                r.originId === agentId &&
                !hidden.has(r.runId) &&
                finishedRun({ status: r.dag?.status ?? r.status, land: r.land, landPath: r.landPath })
        )
        .map((r) => r.runId);
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
