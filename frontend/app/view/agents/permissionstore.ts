// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The permission prompts Claude Code is showing in each agent's terminal, as wavesrv's queue (pkg/agentperm) holds
// them, head first. One atom per agent block (its ORef, "block:<uuid>") holds the last snapshot; null means no snapshot
// has been read yet, an empty array means nothing is pending. The `agent:permission` event carries the whole queue, so a
// snapshot replaces the last one outright.
//
// Nothing here runs at startup: the first hook that reads a queue subscribes to the event (the agentaskstore.ts
// pattern, set up lazily), then loads the queue once, so a pane that mounts after a reload still sees what is waiting.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import {
    answerFailureMessage,
    headIdOf,
    REFUSAL_MS,
    refusalClears,
    requestsGone,
    type Refusal,
} from "./permissionmodel";

type Snapshot = AgentPermissionRequest[] | null;

const NONE: AgentPermissionRequest[] = [];

const snapshotAtoms = new Map<string, PrimitiveAtom<Snapshot>>();
// per ORef, how many snapshots arrived by event (or from the DEV hook). A read that started before one and ends after it
// is older than what the atom holds and is dropped.
const eventCounts = new Map<string, number>();

// Request ids whose Allow or Deny has been sent and not yet settled: the card's buttons lock on these, so a second click
// cannot answer the next request by mistake. A request leaving the queue releases its id.
export const permissionInFlightAtom = atom<ReadonlySet<string>>(new Set<string>()) as PrimitiveAtom<
    ReadonlySet<string>
>;
// ORef -> the last answer for that agent that did not go through, shown on its card. It is per agent, not per request:
// wavesrv refuses only a request that is no longer the head, so the refused id has left the queue before the line is
// drawn, and a per-request line would die with it. It clears on the next answer for the agent, when a different request
// becomes its head, and after REFUSAL_MS (permissionmodel.ts has the rule).
export const permissionRefusalAtom = atom<ReadonlyMap<string, Refusal>>(new Map<string, Refusal>()) as PrimitiveAtom<
    ReadonlyMap<string, Refusal>
>;

// the atom of a block with no ORef (an agent without a terminal): never loaded, always empty
const noBlockAtom = atom<Snapshot>(NONE) as PrimitiveAtom<Snapshot>;

export function getPermissionAtom(oref: string): PrimitiveAtom<Snapshot> {
    let snapshotAtom = snapshotAtoms.get(oref);
    if (!snapshotAtom) {
        snapshotAtom = atom<Snapshot>(null) as PrimitiveAtom<Snapshot>;
        snapshotAtoms.set(oref, snapshotAtom);
    }
    return snapshotAtom;
}

function forgetRequests(ids: string[]) {
    if (ids.length === 0) {
        return;
    }
    const inFlight = globalStore.get(permissionInFlightAtom);
    if (ids.some((id) => inFlight.has(id))) {
        const next = new Set(inFlight);
        ids.forEach((id) => next.delete(id));
        globalStore.set(permissionInFlightAtom, next);
    }
}

// Removes the agent's refusal line; `only` limits it to that very refusal, so a timer cannot take a newer one down.
function dropRefusal(oref: string, only?: Refusal) {
    const refusals = globalStore.get(permissionRefusalAtom);
    const current = refusals.get(oref);
    if (current == null || (only != null && current !== only)) {
        return;
    }
    const next = new Map(refusals);
    next.delete(oref);
    globalStore.set(permissionRefusalAtom, next);
}

function setRefusal(oref: string, id: string, message: string) {
    const headId = headIdOf(globalStore.get(getPermissionAtom(oref)) ?? NONE);
    const refusal: Refusal = { id, message, ts: Date.now(), headId };
    globalStore.set(permissionRefusalAtom, new Map(globalStore.get(permissionRefusalAtom)).set(oref, refusal));
    setTimeout(() => dropRefusal(oref, refusal), REFUSAL_MS);
}

function applySnapshot(oref: string, requests: AgentPermissionRequest[]) {
    const snapshotAtom = getPermissionAtom(oref);
    const prev = globalStore.get(snapshotAtom) ?? NONE;
    globalStore.set(snapshotAtom, requests);
    forgetRequests(requestsGone(prev, requests));
    const refusal = globalStore.get(permissionRefusalAtom).get(oref);
    if (refusal != null && refusalClears(refusal, headIdOf(requests), Date.now())) {
        dropRefusal(oref, refusal);
    }
}

function applyEvent(data: AgentPermissionData) {
    if (data?.oref == null) {
        return;
    }
    eventCounts.set(data.oref, (eventCounts.get(data.oref) ?? 0) + 1);
    applySnapshot(data.oref, data.requests ?? NONE);
}

// Reads the server's queue and makes it the snapshot, unless an event landed while the read was out: that event is newer.
async function reloadPermission(oref: string): Promise<void> {
    const seen = eventCounts.get(oref) ?? 0;
    let data: AgentPermissionData;
    try {
        data = await RpcApi.AgentPermissionPendingCommand(TabRpcClient, oref);
    } catch (err) {
        console.warn(`reading the pending permissions of ${oref} failed`, err);
        return;
    }
    if ((eventCounts.get(oref) ?? 0) !== seen) {
        return;
    }
    applySnapshot(oref, data?.requests ?? NONE);
}

let subscribed = false;
function setupPermissionSubscription() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    waveEventSubscribeSingle({
        eventType: "agent:permission",
        handler: (event) => applyEvent(event.data as AgentPermissionData),
    });
}

/** The queued permission prompts of the agent block `oref`, head first; empty while none is pending (or no block). The
 *  first read of a block loads its queue from wavesrv. */
export function usePermission(oref: string | undefined): AgentPermissionRequest[] {
    const snapshot = useAtomValue(oref != null ? getPermissionAtom(oref) : noBlockAtom);
    const unread = oref != null && snapshot == null;
    useEffect(() => {
        setupPermissionSubscription();
        if (unread && oref != null) {
            void reloadPermission(oref);
        }
    }, [oref, unread]);
    return snapshot ?? NONE;
}

/** Whether an answer for request `id` (the card's head) is in flight, and the message of the last answer for the agent
 *  `oref` that did not go through. The message outlives the request it refused. */
export function usePermissionRequestState(
    oref: string | undefined,
    id: string | undefined
): { busy: boolean; error?: string } {
    const inFlight = useAtomValue(permissionInFlightAtom);
    const refusals = useAtomValue(permissionRefusalAtom);
    return { busy: id != null && inFlight.has(id), error: oref != null ? refusals.get(oref)?.message : undefined };
}

/** Allow (types `1` into the terminal) or Deny (Esc) for request `id`, which wavesrv answers only while it is the head of
 *  the queue. The request's buttons stay locked until the call and the queue read after it have settled. A refusal ("that
 *  request is no longer waiting") becomes the agent's refusal line, raised once the queue has been read again, so it
 *  records the head the person now sees; the line clears by the rule in `refusalClears`, and on the next answer here. */
export async function answerPermission(oref: string, id: string, allow: boolean): Promise<void> {
    if (globalStore.get(permissionInFlightAtom).has(id)) {
        return;
    }
    globalStore.set(permissionInFlightAtom, new Set(globalStore.get(permissionInFlightAtom)).add(id));
    dropRefusal(oref);
    let failure: string | null = null;
    try {
        await RpcApi.AgentPermissionAnswerCommand(TabRpcClient, { oref, id, allow });
    } catch (err) {
        failure = answerFailureMessage(err);
    }
    try {
        await reloadPermission(oref);
        if (failure != null) {
            setRefusal(oref, id, failure);
        }
    } finally {
        const next = new Set(globalStore.get(permissionInFlightAtom));
        if (next.delete(id)) {
            globalStore.set(permissionInFlightAtom, next);
        }
    }
}

// DEV only: lets a CDP scenario put a fixture queue on an agent's card without a Claude process behind it.
if (import.meta.env.DEV && typeof window !== "undefined") {
    const hook = ((window as any).__arcAgentPermission ??= {});
    Object.assign(hook, {
        set: (oref: string, requests: AgentPermissionRequest[]) => applyEvent({ oref, requests }),
    });
}
