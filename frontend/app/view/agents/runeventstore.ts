// Copyright 2026, Command Line Inc.
//
// Run-lifecycle event state: per-run atom, initial load via JarvisRunEventsCommand, live append via
// the run:event broadcast (scoped to run:<id>, so only the focused run's card receives it).

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";

const eventsAtoms = new Map<string, PrimitiveAtom<RunEvent[]>>();
const statusAtoms = new Map<string, PrimitiveAtom<RunEventsStatus>>();
const loadedRuns = new Set<string>();

// RunEventsStatus is what the timeline is allowed to claim about itself. "live" only after a load
// actually returned — a rail that prints "● live" over an empty list it never fetched is a lie.
export type RunEventsStatus = "loading" | "live" | "error";

function eventsAtomFor(runId: string) {
    let a = eventsAtoms.get(runId);
    if (!a) {
        a = atom<RunEvent[]>([]) as PrimitiveAtom<RunEvent[]>;
        eventsAtoms.set(runId, a);
    }
    return a;
}

function statusAtomFor(runId: string) {
    let a = statusAtoms.get(runId);
    if (!a) {
        a = atom<RunEventsStatus>("loading") as PrimitiveAtom<RunEventsStatus>;
        statusAtoms.set(runId, a);
    }
    return a;
}

// Pure: a history snapshot (newest-first) over the live events already received. An event broadcast after the
// server read its snapshot can arrive before the response; replacing the list would lose it for good, since a
// loaded run is never re-read.
export function mergeRunEvents(live: RunEvent[], history: RunEvent[]): RunEvent[] {
    const known = new Set(history.map((e) => e.id));
    return [...live.filter((e) => !known.has(e.id)), ...history];
}

async function load(runId: string, channelId: string): Promise<void> {
    if (loadedRuns.has(runId)) {
        return;
    }
    loadedRuns.add(runId);
    // the atom up front, so the live stream keeps what it delivers while the history is out
    eventsAtomFor(runId);
    globalStore.set(statusAtomFor(runId), "loading");
    try {
        const rtn = await RpcApi.JarvisRunEventsCommand(TabRpcClient, {
            channelid: channelId,
            runid: runId,
        });
        globalStore.set(eventsAtomFor(runId), (live) => mergeRunEvents(live, rtn.events ?? []));
        globalStore.set(statusAtomFor(runId), "live");
    } catch {
        loadedRuns.delete(runId); // allow retry on transient failure
        globalStore.set(statusAtomFor(runId), "error");
    }
}

// retryRunEvents re-attempts a failed history load. The rail's explicit retry — a timeline that
// failed to load stays failed until someone asks again, it never silently reappears as empty.
export function retryRunEvents(runId: string, channelId: string): Promise<void> {
    loadedRuns.delete(runId);
    return load(runId, channelId);
}

let subscribed = false;
function ensureSubscription() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    // unscoped singleton: only the focused run card holds an atom, so the runid filter is cheap
    // enough to be the whole subscription story (a run:event for a run nobody is watching has no atom).
    waveEventSubscribeSingle({
        eventType: "run:event",
        handler: (event) => {
            const data = event.data as RunEventData | undefined;
            if (data?.runid == null || data.event == null) {
                return;
            }
            const target = eventsAtoms.get(data.runid);
            if (!target) {
                return; // no card is watching this run
            }
            globalStore.set(target, (prev) => {
                const next = prev.filter((e) => e.id !== data.event.id);
                next.unshift(data.event);
                return next;
            });
        },
    });
}

// Subscribe a run card to its live event stream and load history once.
export function useRunEvents(runId: string, channelId: string): RunEvent[] {
    ensureSubscription();
    useEffect(() => {
        fireAndForget(() => load(runId, channelId));
    }, [runId, channelId]);
    return useAtomValue(eventsAtomFor(runId));
}

// Same subscription, plus whether the history load succeeded — for surfaces that must show a load
// failure instead of an empty timeline.
export function useRunEventsState(runId: string, channelId: string): { events: RunEvent[]; status: RunEventsStatus } {
    const events = useRunEvents(runId, channelId);
    return { events, status: useAtomValue(statusAtomFor(runId)) };
}

// runEventsAtom is one run's event list for readers that are not a single card: the grid's lead cards and the
// Events rail read many runs at once, which a hook per run cannot do.
export function runEventsAtom(runId: string): Atom<RunEvent[]> {
    return eventsAtomFor(runId);
}

// the waits before each automatic re-read of a failed history load, for readers that draw no error to retry from
export const RUN_EVENTS_RETRY_MS = [5_000, 30_000, 120_000];
const retrying = new Set<string>();

// ensureRunEvents is useRunEvents without the hook: subscribe to the live stream and load history once. Its
// readers (the Cockpit's lead cards and Events rail) show no load error, so a failed load retries by itself, a
// few times, rather than leaving lead-down, review findings and step times silently empty until a remount.
export function ensureRunEvents(runId: string, channelId: string, attempt = 0): void {
    ensureSubscription();
    fireAndForget(async () => {
        await load(runId, channelId);
        const failed = globalStore.get(statusAtomFor(runId)) === "error";
        if (!failed || attempt >= RUN_EVENTS_RETRY_MS.length || retrying.has(runId)) {
            return;
        }
        retrying.add(runId);
        setTimeout(() => {
            retrying.delete(runId);
            ensureRunEvents(runId, channelId, attempt + 1);
        }, RUN_EVENTS_RETRY_MS[attempt]);
    });
}
