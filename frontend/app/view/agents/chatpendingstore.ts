// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Per agent, session-only (nothing is persisted): the messages sent from the chat box that the transcript does not hold
// yet, and the history ↑ recalls. The rules are chatpending.ts's.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";
import type { AgentEntry } from "./agentsviewmodel";
import { PENDING_QUEUED_MAX_MS, pendingMessage, pushSent, type PendingMessage } from "./chatpending";
import type { SentFrom } from "./chatsentflight";

const NONE: PendingMessage[] = [];
const NO_HISTORY: string[] = [];

// agent id -> its pending messages, oldest first
const pendingAtom = atom<ReadonlyMap<string, PendingMessage[]>>(new Map());

// agent id -> what was sent from its box, newest last; read on a key press, so it needs no atom
const sentByAgent = new Map<string, string[]>();

let nextId = 0;

/** Records `text` as sent to the agent just now, with how many times the `entries` (the transcript as drawn at this
 *  moment) already hold it, and whether the agent was `busy` (not idle), which makes it Queued (chatpending.ts). `from`
 *  is where its text sat in the box, which its bubble flies from (chatsentflight.ts). */
export function addPending(agentId: string, text: string, entries: AgentEntry[], busy: boolean, from?: SentFrom): void {
    const made = pendingMessage(`pending-${++nextId}`, text, entries, Date.now(), busy);
    const p = from != null ? { ...made, from } : made;
    const m = new Map(globalStore.get(pendingAtom));
    // the ones the transcript has long since caught up with go too, so the list never grows over a long session
    m.set(agentId, [...(m.get(agentId) ?? NONE).filter((q) => Date.now() - q.sentAt < PENDING_QUEUED_MAX_MS), p]);
    globalStore.set(pendingAtom, m);
}

/** Drops the newest pending of the agent's with this text: a send that went another way than the one it was drawn for
 *  (a /btw that no mod took, typed into the terminal instead, where no row of it lands). */
export function dropPending(agentId: string, text: string): void {
    const list = globalStore.get(pendingAtom).get(agentId) ?? NONE;
    const at = list.map((p) => p.text).lastIndexOf(text);
    if (at < 0) {
        return;
    }
    const m = new Map(globalStore.get(pendingAtom));
    m.set(agentId, [...list.slice(0, at), ...list.slice(at + 1)]);
    globalStore.set(pendingAtom, m);
}

// the agents whose box holds a message queued behind a permission prompt or a question (chatpending.ts holdLine): kept
// out of the box, which unmounts while the person answers in the terminal
const heldAtom = atom<ReadonlySet<string>>(new Set<string>());

/** Marks (or clears) the agent's box text as queued to send once its prompt is answered. */
export function setHeldSend(agentId: string, held: boolean): void {
    const cur = globalStore.get(heldAtom);
    if (cur.has(agentId) === held) {
        return;
    }
    const next = new Set(cur);
    if (held) {
        next.add(agentId);
    } else {
        next.delete(agentId);
    }
    globalStore.set(heldAtom, next);
}

/** Whether the agent's box text is queued behind its prompt. */
export function useHeldSend(agentId: string): boolean {
    return useAtomValue(heldAtom).has(agentId);
}

/** The agent's messages sent and not yet confirmed by the transcript, oldest first (filter with `pendingStill`). */
export function usePending(agentId: string): PendingMessage[] {
    return useAtomValue(pendingAtom).get(agentId) ?? NONE;
}

/** The agent's pending messages as they stand, for a key handler (`usePending` is the drawing's). */
export function getPending(agentId: string): PendingMessage[] {
    return globalStore.get(pendingAtom).get(agentId) ?? NONE;
}

/** Drops the agent's pending messages with these ids: messages taken back into the box (chattakeback.ts). */
export function dropPendingIds(agentId: string, ids: string[]): void {
    const list = globalStore.get(pendingAtom).get(agentId) ?? NONE;
    if (ids.length === 0 || !list.some((p) => ids.includes(p.id))) {
        return;
    }
    const m = new Map(globalStore.get(pendingAtom));
    m.set(
        agentId,
        list.filter((p) => !ids.includes(p.id))
    );
    globalStore.set(pendingAtom, m);
}

// the pending messages whose bubble is on its flight from the box (chatsentflight.ts), by pending id: pendingStill keeps
// them up until they land, so the transcript's copy never takes one's place mid-air
const NO_FLYING: ReadonlySet<string> = new Set();
const flyingAtom = atom<ReadonlySet<string>>(NO_FLYING);

/** Marks (or clears) the pending message `id` as flying from the box. */
export function setPendingFlying(id: string, flying: boolean): void {
    const cur = globalStore.get(flyingAtom);
    if (cur.has(id) === flying) {
        return;
    }
    const next = new Set(cur);
    if (flying) {
        next.add(id);
    } else {
        next.delete(id);
    }
    globalStore.set(flyingAtom, next);
}

/** The ids of the pending messages flying from the box. */
export function useFlyingPending(): ReadonlySet<string> {
    return useAtomValue(flyingAtom);
}

/** What was sent from the agent's box, newest last (at most 20). */
export function sentHistory(agentId: string): string[] {
    return sentByAgent.get(agentId) ?? NO_HISTORY;
}

export function noteSent(agentId: string, text: string): void {
    sentByAgent.set(agentId, pushSent(sentByAgent.get(agentId) ?? [], text));
}
