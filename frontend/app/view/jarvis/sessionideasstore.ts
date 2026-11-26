// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Session ideas as the cockpit holds them (docs/superpowers/specs/2026-11-26-session-ideas-design.md): wavesrv's ideas store, the
// marks of the sessions a scan has read, the list of sessions with its counts, and the scan that runs or ran last. wavesrv owns
// all of it. The `sessionideas:changed` event carries no data (the counts and the list are computed by the Get handler, never
// stored), so each event is a read: one read at a time, and one more behind it at most.
//
// The pet is always mounted and mounts the feed (petview.tsx), so a scan's end toasts on any surface. The Brief's region and
// Sprout's popup read sessionIdeasAtom and call the actions below.

import { pushToast, TOAST_TTL_MS } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { atom, type PrimitiveAtom } from "jotai";
import { SESSION_IDEAS_REF } from "./address";
import { sessionIdeasFocusAtom } from "./jarvisstore";
import { openAddress, type OpenResult } from "./openref";
import { scanEndToast } from "./sessionideasmodel";

/** Set to ask the Brief to scroll to the From your sessions region (the region clears it once it has). It lives in
 *  jarvisstore.ts, which openref.ts reads without a cycle; this is the name the region and the popup import it by. */
export { sessionIdeasFocusAtom };

// null until the first read
export const sessionIdeasAtom = atom<SessionIdeasData | null>(null) as PrimitiveAtom<SessionIdeasData | null>;

// the model a toast's Review opens the Brief with: the pet hands it over when it mounts the feed
let feedModel: AgentsViewModel | null = null;
let feeding = false;
let reading = false;
let readQueued = false;

function apply(data: SessionIdeasData): void {
    const prev = globalStore.get(sessionIdeasAtom);
    globalStore.set(sessionIdeasAtom, data);
    const title = scanEndToast(prev, data);
    const model = feedModel;
    if (title != null && model != null) {
        pushToast({
            level: "info",
            title,
            message: "",
            // an idea waiting on the person is given longer to be read than a plain toast
            ttlMs: TOAST_TTL_MS * 2,
            action: { label: "Review", run: () => void openSessionIdeas(model) },
        });
    }
}

// One read in flight, and at most one more queued behind it however many events arrive meanwhile. A read with another queued
// behind it is dropped: that one will be newer, and this reply could only put back what the person has just decided (a row that
// left on Keep, back for the length of a read). A failed read logs what it lost and the list keeps what it had.
async function read(): Promise<void> {
    if (reading) {
        readQueued = true;
        return;
    }
    reading = true;
    try {
        const data = await RpcApi.SessionIdeasGetCommand(TabRpcClient);
        if (!readQueued && data != null) {
            apply(data);
        }
    } catch (e) {
        console.warn("session ideas: reading the ideas failed; the list keeps what it had", e);
    } finally {
        reading = false;
        if (readQueued) {
            readQueued = false;
            void read();
        }
    }
}

/** Feeds sessionIdeasAtom: the event is subscribed first, then one read, and every `sessionideas:changed` after it is a read.
 *  Idempotent, and never unmounted. `model` is what the toast's Review opens the Brief with. */
export function ensureSessionIdeasFeed(model: AgentsViewModel): void {
    feedModel = model;
    if (feeding) {
        return;
    }
    feeding = true;
    waveEventSubscribeSingle({ eventType: "sessionideas:changed", handler: () => void read() });
    void read();
}

/** Opens the Brief on its From your sessions region: the `sessionideas` address, through the router like every cross-surface open. */
export function openSessionIdeas(model: AgentsViewModel): Promise<OpenResult> {
    return openAddress(model, SESSION_IDEAS_REF);
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// An action's failure is told where the person is looking: a toast (the row they pressed would otherwise just not move). A
// `quiet` one is a bookkeeping call the person did not ask for, so it only logs. True when the call went through; the list
// itself updates from the event the write publishes, not from here.
async function act(what: string, call: () => Promise<void>, quiet = false): Promise<boolean> {
    try {
        await call();
        return true;
    } catch (e) {
        if (quiet) {
            console.warn(`session ideas: couldn't ${what}`, e);
        } else {
            pushToast({ level: "error", title: `Couldn't ${what}`, message: errText(e) });
        }
        return false;
    }
}

/** Keep: a pending chunk on the idea's initiative, or a new idea in the Ideas column. `label` names the chunk (else its gist). */
export function keepIdea(id: string, label?: string): Promise<boolean> {
    return act("keep the idea", () =>
        RpcApi.SessionIdeasResolveCommand(TabRpcClient, label ? { id, op: "keep", label } : { id, op: "keep" })
    );
}

/** Drop: the idea is removed and the scan does not propose it again. */
export function dropIdea(id: string): Promise<boolean> {
    return act("drop the idea", () => RpcApi.SessionIdeasResolveCommand(TabRpcClient, { id, op: "drop" }));
}

/** The person looked at the ideas: the 7-day Waiting line starts its clock again. Quiet: a failure only logs. */
export function markSeen(): Promise<boolean> {
    return act("mark the ideas seen", () => RpcApi.SessionIdeasMarkCommand(TabRpcClient, { op: "seen" }), true);
}

/** Next week: the Waiting line stays away for 7 days. */
export function snooze(): Promise<boolean> {
    return act("put the ideas off for a week", () => RpcApi.SessionIdeasMarkCommand(TabRpcClient, { op: "snooze" }));
}

/** Starts a scan: of `paths` when given (Retry, Scan them first), else of every quiet session not yet scanned. */
export function scanNow(paths?: string[]): Promise<boolean> {
    return act("start the scan", () =>
        RpcApi.SessionIdeasScanCommand(TabRpcClient, paths != null && paths.length > 0 ? { paths } : {})
    );
}

/** Stops the scan that runs; what it found stays. */
export function stopScan(): Promise<boolean> {
    return act("stop the scan", () => RpcApi.SessionIdeasScanCommand(TabRpcClient, { stop: true }));
}
