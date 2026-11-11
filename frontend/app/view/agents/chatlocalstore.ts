// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Per agent, session-only (nothing is persisted): the cards Chat drew for a bare /usage, /tasks… (chatlocal.ts). A card
// stays under the conversation until its ×, or until the next message you send, as a panel on Claude Code's own
// screen closes when you go on.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";
import { withCard, type LocalCard, type LocalPanel } from "./chatlocal";

const NONE: LocalCard[] = [];

// agent id -> its cards, oldest first
const cardsAtom = atom<ReadonlyMap<string, LocalCard[]>>(new Map());

let nextId = 0;

function put(agentId: string, list: LocalCard[]): void {
    const m = new Map(globalStore.get(cardsAtom));
    if (list.length === 0) {
        m.delete(agentId);
    } else {
        m.set(agentId, list);
    }
    globalStore.set(cardsAtom, m);
}

export function showLocalCard(agentId: string, panel: LocalPanel, command: string): void {
    const card: LocalCard = { id: `local-${++nextId}`, panel, command, at: Date.now() };
    put(agentId, withCard(globalStore.get(cardsAtom).get(agentId) ?? NONE, card));
}

export function closeLocalCard(agentId: string, id: string): void {
    put(
        agentId,
        (globalStore.get(cardsAtom).get(agentId) ?? NONE).filter((c) => c.id !== id)
    );
}

export function clearLocalCards(agentId: string): void {
    if (globalStore.get(cardsAtom).has(agentId)) {
        put(agentId, NONE);
    }
}

export function useLocalCards(agentId: string): LocalCard[] {
    return useAtomValue(cardsAtom).get(agentId) ?? NONE;
}
