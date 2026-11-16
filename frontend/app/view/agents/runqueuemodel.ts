// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run queue as the Agent tree draws it (spec 2026-10-14-run-handoff-lifecycle-design.md, decision 4): the plans a
// session handed to the engine as queued starts, each a row in its project's folder. Pure placement and wording;
// runqueuestore.ts holds the atom and the actions, agenttree.tsx the row.

import { formatAgo } from "./agentsviewmodel";
import { lastPathSegment } from "./runlineage";

// RunQueueEntry.state of an entry that can never start by waiting (pkg/wshrpc RunQueueState_Blocked)
const BLOCKED = "blocked";

/** One queued entry as a tree row. `place` is its 1-based place among all the waiting entries (the cap is global, so the
 *  count crosses projects), null for a blocked one; `afterTitle` names what it waits on, when that is known: the titles
 *  of every After id, joined by ", " (an id whose title is not known yet reads as its first 8 characters);
 *  `afterMet` is set when every After id is a run that has landed, so only room is left to wait for. */
export type QueuedRow = {
    project: string;
    entry: RunQueueEntry;
    place: number | null;
    afterTitle?: string;
    afterMet?: boolean;
    /** one per After id, in the entry's order: its title when known, and whether it is a run that has landed (a queued
     *  entry never is). Empty for an entry that waits for room only. The Brief nests the entry under the first that
     *  has not. */
    afters: QueuedAfter[];
};

export type QueuedAfter = { id: string; title?: string; landed: boolean };

export function isBlockedEntry(entry: RunQueueEntry): boolean {
    return entry.state === BLOCKED;
}

/** Pure: what an entry waits for, as a list (the wire leaves it out when there is nothing). */
export function entryAfter(entry: RunQueueEntry): readonly string[] {
    return entry.after ?? [];
}

/** Pure: how one After reads: its title, or the first 8 characters of its id while the title is not known. */
export function afterName(after: QueuedAfter): string {
    return after.title ?? after.id.slice(0, 8);
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
 *  because that entry has no run yet, and an entry after several runs has its After met only when every one has. */
export function queuedRows(
    entries: readonly RunQueueEntry[],
    runTitles: Record<string, string>,
    landedRuns: ReadonlySet<string> = new Set()
): QueuedRow[] {
    const titles = new Map(entries.map((e) => [e.id, e.title]));
    let place = 0;
    return entries.map((entry) => {
        const afters = entryAfter(entry).map((id): QueuedAfter => {
            const title = runTitles[id] || titles.get(id);
            return { id, ...(title ? { title } : {}), landed: !titles.has(id) && landedRuns.has(id) };
        });
        const row: QueuedRow = {
            project: queueProject(entry),
            entry,
            place: isBlockedEntry(entry) ? null : ++place,
            afters,
        };
        // no title known for any of them leaves the title out, so the line falls back to the short ids
        if (afters.some((a) => a.title)) {
            row.afterTitle = afters.map(afterName).join(", ");
        }
        if (afters.length > 0 && afters.every((a) => a.landed)) {
            row.afterMet = true;
        }
        return row;
    });
}

/** Pure: the row's second line. `Blocked · <reason>`, `Queued · after <title>` (`after run A, run B` for an entry that
 *  waits on two) while what it waits on has not all landed, else `Queued #<place>` (an After that has landed leaves only
 *  room to wait for). An After whose title is not known yet reads as the first 8 characters of its id. A waiting row
 *  leads with `Queued`, so the word survives the truncation of a long title. */
export function queuedMeta(row: QueuedRow): string {
    const { entry } = row;
    if (isBlockedEntry(entry)) {
        return entry.reason ? `Blocked · ${entry.reason}` : "Blocked";
    }
    if (row.afters.length > 0 && !row.afterMet) {
        return `Queued · after ${row.afterTitle ?? row.afters.map(afterName).join(", ")}`;
    }
    return `Queued #${row.place}`;
}

function routeParts(entry: RunQueueEntry): { lead: string; workers: string } {
    const { data } = entry;
    const lead = [data.runtime, data.model].filter(Boolean).join(" · ");
    const route = data.workerroute;
    const workers = route ? [route.runtime, route.model].filter(Boolean).join(" · ") : "same as lead";
    return { lead, workers };
}

/** Pure: the lead and worker route a queued entry will run with, fixed at queue time: the models the person approved. */
export function queuedRoute(entry: RunQueueEntry): string {
    const { lead, workers } = routeParts(entry);
    return `Lead ${lead} · Workers ${workers}`;
}

/** The row's tooltip as parts, so the card can set the plan's file name apart from its folder. */
export type QueuedTooltip = {
    /** the plan's file name, or the entry's title when it has no plan path */
    name: string;
    /** the folder the plan sits in, with no trailing separator; absent with no plan path or a bare file name */
    dir?: string;
    /** the whole blocked reason, which the row's second line truncates */
    blocked?: string;
    lead: string;
    workers: string;
    /** `Queued 5m ago` */
    age: string;
};

/** Pure: the row's tooltip: the plan, why it is blocked (when it is), the lead and worker route it will run with, and
 *  when it was queued. The route was fixed at queue time, so these are the models the person approved. */
export function queuedTooltip(entry: RunQueueEntry, now: number): QueuedTooltip {
    const path = entry.data.planpath ?? "";
    const name = lastPathSegment(path);
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const tip: QueuedTooltip = {
        name: name || entry.title,
        ...routeParts(entry),
        age: `Queued ${formatAgo(now - entry.queuedts)}`,
    };
    if (name && cut > 0) {
        tip.dir = path.slice(0, cut);
    }
    if (isBlockedEntry(entry)) {
        tip.blocked = entry.reason || "Blocked";
    }
    return tip;
}
