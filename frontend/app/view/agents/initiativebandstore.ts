// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative band's two stores (docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md): which agents'
// bands are open (`chat.initiative.band` in localStorage, so a reload keeps them), and the chunk switch, whose ops
// initiativeband.ts plans and which this file only sends. Module-level atoms, as every surface but Agent unmounts on a
// switch.

import { globalStore } from "@/app/store/jotaiStore";
import { effortDetailAtom, loadEffortDetail, mutateEffortOps } from "@/app/view/jarvis/effortstore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { queueSwitchLine } from "./chatinitiativestore";
import { switchPlan } from "./initiativeband";

export const BAND_STORAGE_KEY = "chat.initiative.band";

// the agents whose band is open, kept to the newest this many
const MAX_OPEN = 200;

declare global {
    interface Window {
        // DEV: a string makes a chunk switch's second write fail with it before it is sent, so a CDP scenario can
        // see the rollback; the rollback itself runs for real
        __initiativeSwitchFail?: string;
    }
}

// a storage that throws (a private window, a restricted webview) degrades to a band that forgets; said once
let warned = false;
function warnOnce(what: string, e: unknown): void {
    if (!warned) {
        warned = true;
        console.warn(`[chat] initiative band state not ${what}:`, e instanceof Error ? e.message : String(e));
    }
}

/** Pure: the open agents out of what localStorage held: a JSON list of ids, kept in order without repeats or empty ids and
 *  cut to the newest 200; anything else is none. */
export function coerceBandOpen(raw: unknown): string[] {
    if (typeof raw !== "string") {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    const ids = parsed.filter((id, i): id is string => typeof id === "string" && id !== "" && parsed.indexOf(id) === i);
    return ids.slice(-MAX_OPEN);
}

/** Pure: `ids` with `agentId` open (as the newest, the oldest dropped past 200) or closed. The same list when it already
 *  is as asked. */
export function withBandOpen(ids: readonly string[], agentId: string, open: boolean): readonly string[] {
    if (!open) {
        return ids.includes(agentId) ? ids.filter((id) => id !== agentId) : ids;
    }
    if (ids[ids.length - 1] === agentId) {
        return ids;
    }
    return [...ids.filter((id) => id !== agentId), agentId].slice(-MAX_OPEN);
}

function readOpen(): string[] {
    try {
        return coerceBandOpen(globalThis.localStorage?.getItem(BAND_STORAGE_KEY));
    } catch (e) {
        warnOnce("read", e);
        return [];
    }
}

/** The ids of the agents whose band is open, oldest first. Seeded from localStorage at module load. */
export const bandOpenAtom = atom<readonly string[]>(readOpen()) as PrimitiveAtom<readonly string[]>;

const openOf = atomFamily((agentId: string) => atom((get) => get(bandOpenAtom).includes(agentId)));

/** Whether the agent's band is open (it starts collapsed). */
export function useBandOpen(agentId: string): boolean {
    return useAtomValue(openOf(agentId));
}

/** Opens or collapses one agent's band; the others are untouched. A storage that cannot be written leaves it in memory. */
export function setBandOpen(agentId: string, open: boolean): void {
    const prev = globalStore.get(bandOpenAtom);
    const next = withBandOpen(prev, agentId, open);
    if (next === prev) {
        return;
    }
    globalStore.set(bandOpenAtom, next);
    try {
        globalThis.localStorage?.setItem(BAND_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
        warnOnce("saved", e);
    }
}

export function toggleBand(agentId: string): void {
    setBandOpen(agentId, !globalStore.get(bandOpenAtom).includes(agentId));
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Moves the agent in tab `tabId` to the chunk `toLabel` of the initiative `oref` (decisions 5 and 11 of the plan). Two
 *  writes, since a batch validates against the state before any of its ops: the detach from the old chunk, then the attach
 *  to the chosen one. When the attach fails the old chunk is put back (the rollback) and this rejects with the attach's
 *  error, with the rollback's too when it failed as well; no line is queued. On success the switched line waits for the
 *  agent's next message. The initiative is read first when it is not loaded. A refusal rejects with wavesrv's message, for
 *  the band to show; nothing is swallowed. */
export async function switchAgentChunk(oref: string, tabId: string, toLabel: string): Promise<void> {
    if (globalStore.get(effortDetailAtom).get(oref) == null) {
        await loadEffortDetail(oref);
    }
    const effort = globalStore.get(effortDetailAtom).get(oref);
    if (effort == null) {
        throw new Error("This initiative could not be read");
    }
    const plan = switchPlan(effort, tabId, toLabel);
    if (plan.attach.length === 0) {
        return; // the agent is on it already
    }
    if (plan.detach != null) {
        await mutateEffortOps(oref, plan.detach);
    }
    try {
        const fail = import.meta.env.DEV && typeof window !== "undefined" ? window.__initiativeSwitchFail : undefined;
        if (fail != null) {
            throw new Error(fail);
        }
        await mutateEffortOps(oref, plan.attach);
    } catch (e) {
        const message = messageOf(e);
        if (plan.rollback != null) {
            try {
                await mutateEffortOps(oref, plan.rollback);
            } catch (r) {
                throw new Error(`${message}; and the old chunk could not be restored: ${messageOf(r)}`);
            }
        }
        throw new Error(message);
    }
    queueSwitchLine(tabId, plan.line);
}
