// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run queue in Jarvis's Brief (spec 2026-10-16-brief-run-queue-design.md): a queued plan drawn among the Runs,
// under the run or the queued plan it waits on (one level per link of a chain), a room-only one after every run; and
// the lines of the sheet a queued row opens. Pure: the rows come from runqueuemodel.ts's queuedRows, which already
// resolves each entry's place and its After's title.

import { formatAge, formatAgo } from "@/app/view/agents/agentsviewmodel";
import {
    afterName,
    isBlockedEntry,
    queuedRoute,
    type QueuedAfter,
    type QueuedRow,
} from "@/app/view/agents/runqueuemodel";
import { filterLines, keepsRunKind, type BriefLine, type RunKindFilter } from "./briefrows";

// a queued line is never stale: the Runs region's fold of old runs leaves it drawn
export type QueuedLine = BriefLine & { stale: false };

// what an entry waits on: the first run or queued entry in its After that has not landed, or nothing but room. An
// entry after several runs is drawn under the first one still going.
function waitsOn(row: QueuedRow): string | null {
    return row.afters.find((a) => !a.landed)?.id ?? null;
}

// every After, named, as one line reads them: "run A, run B"
function afterNames(row: QueuedRow): string {
    return row.afterTitle ?? row.afters.map(afterName).join(", ");
}

// the Afters that have not landed: a nested line says "after it lands" only when that is all it waits on
function pendingCount(row: QueuedRow): number {
    return row.afters.filter((a) => !a.landed).length;
}

function queuedLine(row: QueuedRow, depth: number, now: number): QueuedLine {
    const { entry } = row;
    const blocked = isBlockedEntry(entry);
    const waits = waitsOn(row) != null;
    const nestedMeta = pendingCount(row) > 1 ? `after it and ${pendingCount(row) - 1} more land` : "after it lands";
    return {
        id: "sessions:queued:" + entry.id,
        kind: depth > 0 ? "↳ queued" : "⏸ queued",
        kindTone: "muted",
        title: entry.title,
        note: "",
        meta: !waits ? "waiting for room" : depth > 0 ? nestedMeta : `after ${afterNames(row)}`,
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

/** One thing an entry waits on, as the sheet's waits line draws it: a link when it is a run or a queued entry. */
export type SheetWait = { text: string; runId?: string; entryId?: string };

export type QueueSheetModel = {
    chip: string;
    blocked: boolean;
    // why a blocked entry is blocked, or why a waiting one waits on (the re-check's "Waiting for run X too: …")
    reason: string | null;
    // what it waits on; runId or entryId is the first After that has not landed, when that is something to open.
    // `list` is every After, in the entry's order, drawn as one link each; present only for an entry after several
    waits: SheetWait & { list?: SheetWait[] };
    plan: string | null;
    goal: string | null;
    route: string;
    queued: string;
    // the session that queued it, when its tab is in the roster
    queuedBy: { tabId: string; name: string } | null;
    runNext: boolean;
};

// an After as a link: a queued entry (its id is "q-" + hex, RunQueueEntry.Id) opens its sheet, a run opens its own
function waitFor(id: string, text: string): SheetWait {
    return id.startsWith("q-") ? { text, entryId: id } : { text, runId: id };
}

/** Pure: the queue sheet's lines. `afterStage` is the stage of the first run it waits on that has not landed, when that
 *  run is loaded; maxActive and active are runs:maxactive (0 is no cap) and the active runs, from RunQueueList;
 *  originName is the roster's name for the entry's origintabid (useOriginName), null when that tab is not known. The
 *  reason is the entry's own, whether it is blocked or waits on: a waiting entry has one only when the re-check added a
 *  run to its After. */
export function queueSheetModel(
    row: QueuedRow,
    i: { maxActive: number; active: number; afterStage?: string; originName?: string | null; now: number }
): QueueSheetModel {
    const { entry } = row;
    const blocked = isBlockedEntry(entry);
    const parent = waitsOn(row);
    // the stage belongs to the run named at the first pending After, the one the model hands to useAfterStage
    const named = (a: QueuedAfter) =>
        a.id === parent && i.afterStage && !a.id.startsWith("q-") ? `${afterName(a)} · ${i.afterStage}` : afterName(a);
    const list = row.afters.length > 1 ? row.afters.map((a) => waitFor(a.id, named(a))) : undefined;
    let waits: QueueSheetModel["waits"];
    if (parent == null) {
        waits = { text: i.maxActive > 0 ? `a free slot (${i.active} of ${i.maxActive} running)` : "a free slot" };
    } else if (list != null) {
        waits = { ...waitFor(parent, list.map((w) => w.text).join(", ")), list };
    } else {
        waits = waitFor(parent, named(row.afters[0]));
    }
    return {
        chip: blocked ? "Blocked" : parent != null ? "Waiting on a run" : `Queued #${row.place}`,
        blocked,
        reason: entry.reason || null,
        waits,
        plan: entry.data.planpath || null,
        goal: entry.data.planpath ? null : entry.data.goal || null,
        route: queuedRoute(entry),
        queued: `queued ${formatAgo(i.now - entry.queuedts)}`,
        queuedBy: entry.data.origintabid && i.originName ? { tabId: entry.data.origintabid, name: i.originName } : null,
        runNext: row.place != null && row.place > 1,
    };
}
