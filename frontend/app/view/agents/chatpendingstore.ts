// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Per agent, session-only (nothing is persisted): the messages sent from the chat box that the transcript does not hold
// yet, and the history ↑ recalls. The rules are chatpending.ts's.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";
import type { AgentEntry } from "./agentsviewmodel";
import { PENDING_QUEUED_MAX_MS, pendingKind, pushSent, userTextCount, type PendingMessage } from "./chatpending";

const NONE: PendingMessage[] = [];
const NO_HISTORY: string[] = [];

// agent id -> its pending messages, oldest first
const pendingAtom = atom<ReadonlyMap<string, PendingMessage[]>>(new Map());

// agent id -> what was sent from its box, newest last; read on a key press, so it needs no atom
const sentByAgent = new Map<string, string[]>();

let nextId = 0;

/** Records `text` as sent to the agent just now, with how many times the `entries` (the transcript as drawn at this
 *  moment) already hold it. */
export function addPending(agentId: string, text: string, entries: AgentEntry[]): void {
    const kind = pendingKind(text);
    const p: PendingMessage = {
        id: `pending-${++nextId}`,
        text,
        sentAt: Date.now(),
        seen: userTextCount(entries, text),
        ...(kind != null ? { kind } : {}),
    };
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

/** The agent's messages sent and not yet confirmed by the transcript, oldest first (filter with `pendingStill`). */
export function usePending(agentId: string): PendingMessage[] {
    return useAtomValue(pendingAtom).get(agentId) ?? NONE;
}

/** What was sent from the agent's box, newest last (at most 20). */
export function sentHistory(agentId: string): string[] {
    return sentByAgent.get(agentId) ?? NO_HISTORY;
}

export function noteSent(agentId: string, text: string): void {
    sentByAgent.set(agentId, pushSent(sentByAgent.get(agentId) ?? [], text));
}
