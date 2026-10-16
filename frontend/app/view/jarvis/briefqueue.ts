// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run queue in Jarvis's Brief (spec 2026-10-16-brief-run-queue-design.md): a queued plan drawn among the Runs,
// under the run or the queued plan it waits on (one level per link of a chain), a room-only one after every run; and
// the lines of the sheet a queued row opens. Pure: the rows come from runqueuemodel.ts's queuedRows, which already
// resolves each entry's place and its After's title.

import { formatAge, formatAgo } from "@/app/view/agents/agentsviewmodel";
import { isBlockedEntry, queuedRoute, type QueuedRow } from "@/app/view/agents/runqueuemodel";
import { filterLines, keepsRunKind, type BriefLine, type RunKindFilter } from "./briefrows";

// a queued line is never stale: the Runs region's fold of old runs leaves it drawn
export type QueuedLine = BriefLine & { stale: false };

// what an entry waits on: a run or a queued entry that has not landed, or nothing but room
function waitsOn(row: QueuedRow): string | null {
    const after = row.entry.after;
    return after && !row.afterMet ? after : null;
}

function afterName(row: QueuedRow): string {
    return row.afterTitle ?? (row.entry.after ?? "").slice(0, 8);
}

function queuedLine(row: QueuedRow, depth: number, now: number): QueuedLine {
    const { entry } = row;
    const blocked = isBlockedEntry(entry);
    const waits = waitsOn(row) != null;
    return {
        id: "sessions:queued:" + entry.id,
        kind: depth > 0 ? "↳ queued" : "⏸ queued",
        kindTone: "muted",
        title: entry.title,
        note: "",
        meta: !waits ? "waiting for room" : depth > 0 ? "after it lands" : `after ${afterName(row)}`,
        state: blocked ? "blocked" : `#${row.place}`,
        stateTone: "muted",
        progress: null,
        target: { runQueue: entry.id },
        why: "",
        age: formatAge(now - entry.queuedts),
        detail: "",
        depth,
        queued: { entryId: entry.id, blocked, reason: entry.reason ?? "" },
        stale: false,
    };
}

/** Pure: the Runs lines with the queue placed among them. An entry follows the drawn run it waits on, or the queued
 *  entry it waits on, one level deeper per link; an entry whose parent is not drawn (filtered out, folded, gone)
 *  stands at the top naming it; room-only entries follow every run, in queue order. The run-kind toggle and the
 *  search apply to queued lines as to runs. */
export function withQueuedLines<T extends BriefLine>(
    runLines: T[],
    rows: readonly QueuedRow[],
    runKind: RunKindFilter,
    query: string,
    now: number
): (T | QueuedLine)[] {
    if (rows.length === 0) {
        return runLines;
    }
    const kinded = rows.filter((r) => keepsRunKind(runKind, r.entry.data.mode ?? ""));
    // the search reads a line as it would stand at the top; nesting only changes its meta
    const matching = new Set(
        filterLines(
            kinded.map((r) => queuedLine(r, 0, now)),
            query
        ).map((l) => l.queued!.entryId)
    );
    const kept = kinded.filter((r) => matching.has(r.entry.id));
    const keptIds = new Set(kept.map((r) => r.entry.id));
    const drawnRuns = new Set(runLines.flatMap((l) => (l.runOid ? [l.runOid] : [])));
    const children = new Map<string, QueuedRow[]>();
    const top: QueuedRow[] = [];
    for (const r of kept) {
        const parent = waitsOn(r);
        if (parent != null && (drawnRuns.has(parent) || keptIds.has(parent))) {
            children.set(parent, [...(children.get(parent) ?? []), r]);
        } else {
            top.push(r);
        }
    }
    const out: (T | QueuedLine)[] = [];
    const placed = new Set<string>();
    const place = (r: QueuedRow, depth: number) => {
        if (placed.has(r.entry.id)) {
            return;
        }
        placed.add(r.entry.id);
        out.push(queuedLine(r, depth, now));
        for (const child of children.get(r.entry.id) ?? []) {
            place(child, depth + 1);
        }
    };
    for (const l of runLines) {
        out.push(l);
        for (const child of (l.runOid ? children.get(l.runOid) : undefined) ?? []) {
            place(child, 1);
        }
    }
    for (const r of top) {
        place(r, 0);
    }
    // an entry chained into a loop never reaches a placed parent: it still shows, at the top
    for (const r of kept) {
        place(r, 0);
    }
    return out;
}

/** Pure: the Runs region's "N live": running work only, so neither a run folded as stale nor a queued plan counts. */
export function liveRunCount(lines: readonly (BriefLine & { stale?: boolean })[]): number {
    return lines.filter((l) => !l.stale && l.queued == null).length;
}

export type QueueSheetModel = {
    chip: string;
    blocked: boolean;
    reason: string | null;
    // what it waits on; runId or entryId when that is something to open
    waits: { text: string; runId?: string; entryId?: string };
    plan: string | null;
    goal: string | null;
    route: string;
    queued: string;
    // the session that queued it, when its tab is in the roster
    queuedBy: { tabId: string; name: string } | null;
    runNext: boolean;
};

/** Pure: the queue sheet's lines. `afterStage` is the stage of the run it waits on, when it waits on a run that is
 *  loaded; maxActive and active are runs:maxactive (0 is no cap) and the active runs, from RunQueueList; originName is
 *  the roster's name for the entry's origintabid (useOriginName), null when that tab is not known. */
export function queueSheetModel(
    row: QueuedRow,
    i: { maxActive: number; active: number; afterStage?: string; originName?: string | null; now: number }
): QueueSheetModel {
    const { entry } = row;
    const blocked = isBlockedEntry(entry);
    const parent = waitsOn(row);
    const onEntry = parent != null && parent.startsWith("q-");
    const waits =
        parent == null
            ? { text: i.maxActive > 0 ? `a free slot (${i.active} of ${i.maxActive} running)` : "a free slot" }
            : onEntry
              ? { text: afterName(row), entryId: parent }
              : { text: i.afterStage ? `${afterName(row)} · ${i.afterStage}` : afterName(row), runId: parent };
    return {
        chip: blocked ? "Blocked" : parent != null ? "Waiting on a run" : `Queued #${row.place}`,
        blocked,
        reason: blocked ? entry.reason || null : null,
        waits,
        plan: entry.data.planpath || null,
        goal: entry.data.planpath ? null : entry.data.goal || null,
        route: queuedRoute(entry),
        queued: `queued ${formatAgo(i.now - entry.queuedts)}`,
        queuedBy: entry.data.origintabid && i.originName ? { tabId: entry.data.origintabid, name: i.originName } : null,
        runNext: row.place != null && row.place > 1,
    };
}
