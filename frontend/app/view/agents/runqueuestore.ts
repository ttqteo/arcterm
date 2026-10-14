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
import { fireAndForget } from "@/util/util";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { runTitle } from "./runlineage";
import { queuedRows, runLanded, type QueuedRow } from "./runqueuemodel";

// Start now creates the run before it returns: a worktree and the plan's Setup, which can take minutes
const START_TIMEOUT_MS = 10 * 60_000;

// wavesrv's queue, in queue order
export const runQueueAtom = atom<RunQueueEntry[]>([]) as PrimitiveAtom<RunQueueEntry[]>;

// what each run a queued entry waits After looks like now: its title by run id (an After that names a queued entry
// reads that entry's own title in queuedRows), and the ids of those that have landed, which leave the entry waiting
// for room only. Reading a run's atom loads it on first use.
type AfterRuns = { titles: Record<string, string>; landed: Set<string> };
const queueAfterRunsAtom: Atom<AfterRuns> = atom((get) => {
    const entries = get(runQueueAtom);
    const queued = new Set(entries.map((e) => e.id));
    const after: AfterRuns = { titles: {}, landed: new Set() };
    for (const e of entries) {
        if (!e.after || queued.has(e.after) || e.after in after.titles) {
            continue;
        }
        const run = get(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", e.after)));
        if (run == null) {
            continue;
        }
        const dag = run.dagoref ? get(WOS.getWaveObjectAtom<TaskGroup>(WOS.makeORef("dag", run.dagoref))) : undefined;
        after.titles[e.after] = runTitle(run, dag);
        if (runLanded(run)) {
            after.landed.add(e.after);
        }
    }
    return after;
});

// the queue as the tree's rows (projectTree's `queue` input)
export const queuedRowsAtom: Atom<QueuedRow[]> = atom((get) => {
    const after = get(queueAfterRunsAtom);
    return queuedRows(get(runQueueAtom), after.titles, after.landed);
});

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
                globalStore.set(runQueueAtom, (e.data as RunQueueChangedData | undefined)?.entries ?? []);
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
