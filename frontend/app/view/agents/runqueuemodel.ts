// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run queue as the Agent tree draws it (spec 2026-10-14-run-handoff-lifecycle-design.md, decision 4): the plans a
// session handed to the engine as queued starts, each a row in its project's folder. Pure placement and wording;
// runqueuestore.ts holds the atom and the actions, agenttree.tsx the row.

import { formatAgo } from "./agentsviewmodel";
import { lastPathSegment } from "./runlineagestore";

// RunQueueEntry.state of an entry that can never start by waiting (pkg/wshrpc RunQueueState_Blocked)
const BLOCKED = "blocked";

/** One queued entry as a tree row. `place` is its 1-based place among all the waiting entries (the cap is global, so the
 *  count crosses projects), null for a blocked one; `afterTitle` names what it waits on, when that is known;
 *  `afterMet` is set when that is a run that has landed, so only room is left to wait for. */
export type QueuedRow = {
    project: string;
    entry: RunQueueEntry;
    place: number | null;
    afterTitle?: string;
    afterMet?: boolean;
};

export function isBlockedEntry(entry: RunQueueEntry): boolean {
    return entry.state === BLOCKED;
}

/** Pure: the project folder an entry sits in, named as a run's project is (the last segment of its project path). */
export function queueProject(entry: RunQueueEntry): string {
    return lastPathSegment(entry.projectpath);
}

/** Pure: whether a run's work has landed, so an entry waiting After it needs only room. The same rule as
 *  pkg/runqueue Outcome (rules.go): a landed land, or a done run with no branch to merge. A held land (dirty or not), a
 *  land still pending and a cancelled run are not. */
export function runLanded(run: Run): boolean {
    if (run.land) {
        return run.land.state === "landed";
    }
    return run.status === "done" && !run.landpath;
}

/** Pure: every entry as a row, in queue order (so a project's rows are in queue order too). A blocked entry has no place
 *  and takes none from the waiting ones; an entry waiting on another keeps its place, because the entries behind it
 *  still count it. `runTitles` maps a run id to its title; an After that names a queued entry reads that entry's title.
 *  `landedRuns` holds the ids of the runs that have landed (runLanded); an After that names a queued entry is never met,
 *  because that entry has no run yet. */
export function queuedRows(
    entries: readonly RunQueueEntry[],
    runTitles: Record<string, string>,
    landedRuns: ReadonlySet<string> = new Set()
): QueuedRow[] {
    const titles = new Map(entries.map((e) => [e.id, e.title]));
    let place = 0;
    return entries.map((entry) => {
        const row: QueuedRow = {
            project: queueProject(entry),
            entry,
            place: isBlockedEntry(entry) ? null : ++place,
        };
        const afterTitle = entry.after ? runTitles[entry.after] || titles.get(entry.after) : undefined;
        if (afterTitle) {
            row.afterTitle = afterTitle;
        }
        if (entry.after && !titles.has(entry.after) && landedRuns.has(entry.after)) {
            row.afterMet = true;
        }
        return row;
    });
}

/** Pure: the row's second line. `Blocked · <reason>`, `Queued · after <title>` while what it waits on has not landed,
 *  else `Queued #<place>` (an After that has landed leaves only room to wait for). An After whose title is not known yet
 *  reads as the first 8 characters of its id. A waiting row leads with `Queued`, so the word survives the truncation of a
 *  long title. */
export function queuedMeta(row: QueuedRow): string {
    const { entry } = row;
    if (isBlockedEntry(entry)) {
        return entry.reason ? `Blocked · ${entry.reason}` : "Blocked";
    }
    if (entry.after && !row.afterMet) {
        return `Queued · after ${row.afterTitle ?? entry.after.slice(0, 8)}`;
    }
    return `Queued #${row.place}`;
}

/** Pure: the lead and worker route a queued entry will run with, fixed at queue time: the models the person approved. */
export function queuedRoute(entry: RunQueueEntry): string {
    const { data } = entry;
    const lead = [data.runtime, data.model].filter(Boolean).join(" · ");
    const route = data.workerroute;
    const workers = route ? [route.runtime, route.model].filter(Boolean).join(" · ") : "same as lead";
    return `Lead ${lead} · Workers ${workers}`;
}

/** Pure: the row's tooltip, three lines: the plan, the lead and the worker route it will run with, and when it was
 *  queued. The route was fixed at queue time, so these are the models the person approved. */
export function queuedTooltip(entry: RunQueueEntry, now: number): string {
    return [entry.data.planpath || entry.title, queuedRoute(entry), `Queued ${formatAgo(now - entry.queuedts)}`].join(
        "\n"
    );
}
