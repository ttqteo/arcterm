// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit-wide "needs you" list, computed server-side (pkg/jarvis/attention.go) and polled. This
// replaced a frontend derivation over channelsAtom, which is a snapshot refetched only on channel
// create/delete/rename/archive — so a run parked at a review gate in any non-active channel was
// invisible to every badge.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";
import { asksUser, brainstormAttention } from "./brainstormmodel";
import { shownBrainstormFile, type BrainstormState } from "./brainstormstore";
import { needsHuman } from "./jarvisderive";

export const attentionAtom = atom<AttentionItem[]>([]) as PrimitiveAtom<AttentionItem[]>;

// false until the first poll lands: the list it brings is what was already waiting, not news (notifyevents.ts)
export const attentionLoadedAtom = atom(false) as PrimitiveAtom<boolean>;

// DEV only (the office-needs-you-board scenario): Needs you rows to show in place of the live list. null is live.
// The poll never writes it, so a scenario's rows survive the next loadAttention.
export const attentionFixtureAtom = atom<AttentionItem[] | null>(null) as PrimitiveAtom<AttentionItem[] | null>;

// loadAttention is now fired by events (ask cleared, block closed) as well as the poll, so two loads
// can be in flight at once. Only the newest one may write: an in-flight poll that started before the
// ask was answered would otherwise land after it and restore the count that was just cleared.
let latestAttentionLoad = 0;

// splitAttention keeps the nav-rail badges disjoint by construction rather than by derivations agreeing.
// Each item goes to the surface that clears it: an ask to the Cockpit, where the asking agent is a card;
// radar triage to Radar; everything else (gates, blocked tasks, runs to acknowledge or land, escalations,
// due chunks, learn proposals) to Jarvis, whose Brief lists it under "waiting on you" and whose sheets hold
// its actions. The Cockpit's Needs-you strip still shows those, but its badge no longer counts them, so it
// agrees with the "need you" tab above them.
export function splitAttention(items: AttentionItem[]): {
    cockpit: AttentionItem[];
    jarvis: AttentionItem[];
    radar: AttentionItem[];
} {
    const cockpit: AttentionItem[] = [];
    const jarvis: AttentionItem[] = [];
    const radar: AttentionItem[] = [];
    for (const i of items ?? []) {
        (i.kind === "ask" ? cockpit : i.kind === "radar-triage" ? radar : jarvis).push(i);
    }
    return { cockpit, jarvis, radar };
}

// cockpitWaitingCount is what the Cockpit's nav badge counts: every agent that needs you, as the Cockpit's
// "need you" tab counts them, plus the server list's asks (the Cockpit's share). That list knows only the asks
// raised through `wsh ask`; a permission prompt or a question that fell back to the terminal is in the
// roster alone, so a badge read off the list said 0 under a tab that said 3. An ask both know counts once.
export function cockpitWaitingCount(cockpit: AttentionItem[], agents: AgentVM[], answered: Set<string>): number {
    const asking = agents.filter((a) => needsHuman(a, answered));
    const askKeys = new Set(asking.filter((a) => a.blockId).map((a) => `ask:block:${a.blockId}`));
    return asking.length + cockpit.filter((i) => !(i.kind === "ask" && askKeys.has(i.key))).length;
}

// brainstormAttentionItems are the questions asked in brainstorms, for the list the taskbar reads. The server list has
// no such item: a brainstorm's question lives in the agent's file, which the frontend reads. An agent asks when its file
// shows a question (a line Arc sent and the agent has not taken counts as it writing) and its turn ended. `roster` is the
// un-overlaid one: the overlay (withBrainstorm) already reads an asking brainstorm as state "asking", which asksUser
// would refuse. Roster order, one item per question: a new question number is a new key.
export function brainstormAttentionItems(
    roster: readonly AgentVM[],
    brainstorms: Readonly<Record<string, BrainstormState>>
): AttentionItem[] {
    const items: AttentionItem[] = [];
    for (const agent of roster) {
        const b = brainstorms[agent.id];
        const f = shownBrainstormFile(b);
        if (f != null && asksUser(f, agent)) {
            items.push(brainstormAttention({ agentId: agent.id, agentName: agent.name, topic: b.topic }, f));
        }
    }
    return items;
}

// taskbarSignal decides what a new attention list does to the taskbar button. Only an item that was not
// there before flashes it, so an unanswered ask does not flash again every poll; an emptied list
// clears it, because a button still flashing after the last item was answered elsewhere would lie.
export function taskbarSignal(
    prev: AttentionItem[],
    next: AttentionItem[],
    focused: boolean
): "flash" | "clear" | null {
    if (next.length === 0) {
        return prev.length > 0 ? "clear" : null;
    }
    if (focused) {
        return null;
    }
    const known = new Set(prev.map((i) => i.key));
    return next.some((i) => !known.has(i.key)) ? "flash" : null;
}

// A failed poll leaves the last good list in place. Blanking the badge on one dropped request would
// read as "nothing needs you", which is the exact lie this whole change exists to remove.
export async function loadAttention(): Promise<void> {
    const loadId = ++latestAttentionLoad;
    try {
        const rtn = await RpcApi.GetAttentionCommand(TabRpcClient);
        if (loadId === latestAttentionLoad) {
            globalStore.set(attentionAtom, rtn.items ?? []);
            globalStore.set(attentionLoadedAtom, true);
        }
    } catch {
        // keep the previous value
    }
}
