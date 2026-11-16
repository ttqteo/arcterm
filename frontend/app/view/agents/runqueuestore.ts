// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run queue as the cockpit holds it (spec 2026-10-14-run-handoff-lifecycle-design.md): wavesrv's list of plans
// waiting to start, and the three things the tree does to an entry. wavesrv publishes `runqueue:changed` with the
// whole list on every change, so there is no poll; one read at mount covers a queue that was already there.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { sameRepoPath } from "@/util/paths";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { brainstormLine, isQueuedFor, type QueueAfterRuns } from "./brainstormmodel";
import { brainstormsAtom, getBrainstorm, setStartingRun, shownBrainstormFile } from "./brainstormstore";
import { recordKind, sendRecord, type QueueInput } from "./chatbrainstorm";
import { brainstormAnswers, recordBrainstormAnswer } from "./chatbrainstormstore";
import { runTitle } from "./runlineage";
import { queuedRows, runLanded, type QueuedRow } from "./runqueuemodel";

// Start now creates the run before it returns: a worktree and the plan's Setup, which can take minutes
const START_TIMEOUT_MS = 10 * 60_000;

// wavesrv's queue, in queue order
export const runQueueAtom = atom<RunQueueEntry[]>([]) as PrimitiveAtom<RunQueueEntry[]>;

// what each run a queued entry waits After looks like now: its title by run id (an After that names a queued entry
// reads that entry's own title in queuedRows), and the ids of those that have landed, which leave the entry waiting
// for room only. Reading a run's atom loads it on first use. The brainstorm card reads it for "Queued after <titles>".
export const queueAfterRunsAtom: Atom<QueueAfterRuns> = atom((get) => {
    const entries = get(runQueueAtom);
    const queued = new Set(entries.map((e) => e.id));
    const after: { titles: Record<string, string>; landed: Set<string> } = { titles: {}, landed: new Set() };
    for (const e of entries) {
        // every id of the list: an entry after two runs reads both
        for (const id of e.after ?? []) {
            if (queued.has(id) || id in after.titles) {
                continue;
            }
            const run = get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", id)));
            if (run == null) {
                continue;
            }
            const dag = run.dagoref
                ? get(WOS.getWaveObjectAtom<TaskGroup>(WOS.makeORef("dag", run.dagoref)))
                : undefined;
            after.titles[id] = runTitle(run, dag);
            if (runLanded(run)) {
                after.landed.add(id);
            }
        }
    }
    return after;
});

// the queue as the tree's rows (projectTree's `queue` input)
export const queuedRowsAtom: Atom<QueuedRow[]> = atom((get) => {
    const after = get(queueAfterRunsAtom);
    return queuedRows(get(runQueueAtom), after.titles, after.landed);
});

// the run each started entry became, from runqueue:changed's `started`, so a view open on an entry can follow it
export const runQueueStartedAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

const NO_AFTER_RUNS: Atom<QueueAfterRuns> = atom<QueueAfterRuns>({ titles: {}, landed: new Set<string>() });

/** The queue as a brainstorm's Approve reads it (queuedForBrainstorm): the entries, the runs they became and the path
 *  of the brainstorm, with what the entries' After ids look like only while the queue holds an entry of this brainstorm
 *  (reading it loads each After run, and every run's update would redraw the pane for nothing otherwise). Absent for
 *  no brainstorm. */
export function useBrainstormQueue(path: string | null): QueueInput | undefined {
    const entries = useAtomValue(runQueueAtom);
    const started = useAtomValue(runQueueStartedAtom);
    const queued = path != null && entries.some((e) => isQueuedFor(e, path));
    const afterRuns = useAtomValue(queued ? queueAfterRunsAtom : NO_AFTER_RUNS);
    return useMemo(
        () => (path != null ? { entries, started, path, afterRuns } : undefined),
        [entries, started, path, afterRuns]
    );
}

/** A brainstorm a queued entry carried (its agent's tab and brainstorm.json), and the run the entry became. */
export type StartedBrainstorm = { tab: string; path: string; runId: string };

/** Pure: the brainstorms waiting on the entries an event started. `before` is the list held before the event: a started
 *  entry has left the list the event carries, so its `brainstorm` is only found in the one before it. */
export function startedBrainstorms(
    before: readonly RunQueueEntry[],
    started: readonly RunQueueStarted[] | undefined
): StartedBrainstorm[] {
    const out: StartedBrainstorm[] = [];
    for (const s of started ?? []) {
        const b = before.find((e) => e.id === s.entryid)?.brainstorm;
        if (b != null && b.tab !== "") {
            out.push({ tab: b.tab, path: b.path, runId: s.runid });
        }
    }
    return out;
}

/** Pure: the ids of the entries an event removed without starting them (listed before, not in the new list, and no run
 *  made of them), which a brainstorm's start mark may still name. */
export function removedEntryIds(
    before: readonly RunQueueEntry[],
    after: readonly RunQueueEntry[],
    started: Readonly<Record<string, string>>
): Set<string> {
    const listed = new Set(after.map((e) => e.id));
    return new Set(before.filter((e) => !listed.has(e.id) && !(e.id in started)).map((e) => e.id));
}

// Chat pairs the line wavesrv sends with the record Arc keeps of the lines it sent itself: the `run` line of a queued
// entry is wavesrv's, so Arc writes the record here, as sendBrainstorm does for the launcher's own start. A brainstorm
// attached in the approved one's place meanwhile is not the one that was approved. The line holds the run's id, which
// did not exist before, so no earlier message can have the same text (`seen` 0).
function recordStartedBrainstorm(b: StartedBrainstorm, now: number): void {
    const state = getBrainstorm(b.tab);
    if (state == null || !sameRepoPath(state.path, b.path)) {
        return;
    }
    const records = brainstormAnswers(b.tab);
    // every mounted feed hears the event, and each looks the entry up in the list it holds: the first one has it
    if (records.some((r) => r.topic === state.topic && recordKind(r) === "run" && r.runId === b.runId)) {
        return;
    }
    const action = { kind: "run", runId: b.runId } as const;
    const line = brainstormLine(action);
    const record =
        line != null ? sendRecord(action, shownBrainstormFile(state), records, state.topic, line, 0, now) : null;
    if (record != null) {
        recordBrainstormAnswer(b.tab, record);
    }
}

// a brainstorm whose queued entry was removed has nothing to wait for: its start mark goes, so Approve is on again
function clearRemovedMarks(removed: ReadonlySet<string>): void {
    if (removed.size === 0) {
        return;
    }
    for (const [tab, s] of Object.entries(globalStore.get(brainstormsAtom))) {
        if (s.starting?.entryId != null && removed.has(s.starting.entryId)) {
            setStartingRun(tab, s.path, null);
        }
    }
}

/** One `runqueue:changed` event: the started pairs go in first, so a reader of the new list already sees the run an
 *  entry became; then the list; and what the event means for the brainstorms that queued a run (a start is recorded for
 *  Chat, a removal clears the mark). */
export function applyQueueChanged(data: RunQueueChangedData | undefined, now: number = Date.now()): void {
    const before = globalStore.get(runQueueAtom);
    const entries = data?.entries ?? [];
    if (data?.started?.length) {
        globalStore.set(runQueueStartedAtom, (cur) => ({
            ...cur,
            ...Object.fromEntries(data.started!.map((s) => [s.entryid, s.runid])),
        }));
    }
    globalStore.set(runQueueAtom, entries);
    for (const b of startedBrainstorms(before, data?.started)) {
        recordStartedBrainstorm(b, now);
    }
    clearRemovedMarks(removedEntryIds(before, entries, globalStore.get(runQueueStartedAtom)));
}

/** Feeds runQueueAtom: one read, then every `runqueue:changed` event. The event is subscribed first, and a read that
 *  lands after an event is dropped, so a slow read never puts back a queue the event already moved on from. */
export function useRunQueueFeed(): void {
    useEffect(() => {
        let live = true;
        let heard = false;
        const unsub = waveEventSubscribeSingle({
            eventType: "runqueue:changed",
            handler: (e) => {
                heard = true;
                applyQueueChanged(e.data as RunQueueChangedData | undefined);
            },
        });
        RpcApi.RunQueueListCommand(TabRpcClient)
            .then((data) => {
                if (live && !heard) {
                    globalStore.set(runQueueAtom, data.entries ?? []);
                }
            })
            .catch(() => {});
        return () => {
            live = false;
            unsub();
        };
    }, []);
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function failed(title: string, e: unknown): void {
    pushToast({ title, message: errorText(e), level: "error" });
}

/** Start now: the run starts past the cap and past its After. A refusal is the person's to read, never swallowed: the
 *  server says "another queued run is starting; try again in a moment" while it is starting another entry (that is no
 *  failure of this one, which stays as it was), and a start that fails blocks the entry and says why. */
export async function startQueuedNow(entry: RunQueueEntry): Promise<void> {
    try {
        await RpcApi.RunQueueStartNowCommand(TabRpcClient, { id: entry.id }, { timeout: START_TIMEOUT_MS });
    } catch (e) {
        failed(`Couldn't start ${entry.title}`, e);
    }
}

/** Run next: the entry moves to the head of the queue, where it still waits for room and for its After. */
export async function runQueuedNext(entry: RunQueueEntry): Promise<void> {
    try {
        await RpcApi.RunQueueRunNextCommand(TabRpcClient, { id: entry.id });
    } catch (e) {
        failed(`Couldn't move ${entry.title} up`, e);
    }
}

/** Remove, after the app's confirm modal: the plan leaves the queue and never starts. */
export function confirmRemoveQueued(entry: RunQueueEntry): void {
    modalsModel.pushModal("ConfirmModal", {
        title: "Remove from queue",
        message: `Remove "${entry.title}" from the queue? It will not start.`,
        confirmLabel: "Remove",
        destructive: true,
        onConfirm: () =>
            fireAndForget(async () => {
                try {
                    await RpcApi.RunQueueRemoveCommand(TabRpcClient, { id: entry.id });
                } catch (e) {
                    failed(`Couldn't remove ${entry.title}`, e);
                }
            }),
    });
}
