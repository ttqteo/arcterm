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

export const attentionAtom = atom<AttentionItem[]>([]) as PrimitiveAtom<AttentionItem[]>;

// false until the first poll lands: the list it brings is what was already waiting, not news (notifyevents.ts)
export const attentionLoadedAtom = atom(false) as PrimitiveAtom<boolean>;

// loadAttention is now fired by events (ask cleared, block closed) as well as the poll, so two loads
// can be in flight at once. Only the newest one may write: an in-flight poll that started before the
// ask was answered would otherwise land after it and restore the count that was just cleared.
let latestAttentionLoad = 0;

// splitAttention keeps the nav-rail badges disjoint by construction rather than by derivations agreeing.
// Radar triage is routed by kind before the channel test: it names no channel either, and falling through
// would count it on Cockpit, a surface with nothing that can clear it.
export function splitAttention(items: AttentionItem[]): {
    channel: AttentionItem[];
    standalone: AttentionItem[];
    radar: AttentionItem[];
} {
    const channel: AttentionItem[] = [];
    const standalone: AttentionItem[] = [];
    const radar: AttentionItem[] = [];
    for (const i of items ?? []) {
        if (i.kind === "radar-triage") {
            radar.push(i);
        } else {
            (i.channelid ? channel : standalone).push(i);
        }
    }
    return { channel, standalone, radar };
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
