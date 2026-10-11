// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The live side of the Ctrl+Tab switcher (tabswitcher.ts): the open switcher, the history of tabs in view that orders
// it, and what its keys do. The bindings (bindings.ts switcher:*) open and step it; tabswitcherview.tsx draws it and
// opens the pick when the modifier goes up.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import { floatTabOrder } from "./sproutroster";
import {
    openSwitcher,
    pickOf,
    pushRecent,
    recentOrder,
    stepSwitcher,
    SWITCHER_DELAY_MS,
    type SwitcherMod,
    type SwitcherState,
} from "./tabswitcher";

export const tabSwitcherAtom = atom<SwitcherState | null>(null) as PrimitiveAtom<SwitcherState | null>;

// the agents and terminals most recently in view, newest first (trackRecentTabs)
export const recentTabsAtom = atom<string[]>([]) as PrimitiveAtom<string[]>;

let showTimer: ReturnType<typeof setTimeout> | undefined;

/** Ctrl+Tab (delta 1) or Ctrl+Shift+Tab (-1): open the switcher beside the tab in view, or move its pick. */
export function switcherKey(model: AgentsViewModel, delta: 1 | -1, mod: SwitcherMod): void {
    const open = globalStore.get(tabSwitcherAtom);
    if (open != null) {
        globalStore.set(tabSwitcherAtom, stepSwitcher(open, delta));
        return;
    }
    const focusId = globalStore.get(model.focusIdAtom) ?? null;
    const tabs = floatTabOrder(
        globalStore.get(model.agentsAtom),
        globalStore.get(model.terminalsAtom),
        focusId,
        globalStore.get(model.lineageAtom)
    ).map((a) => a.id);
    const next = openSwitcher(recentOrder(tabs, globalStore.get(recentTabsAtom), focusId), focusId, delta, mod);
    if (next == null) {
        return;
    }
    globalStore.set(tabSwitcherAtom, next);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
        const s = globalStore.get(tabSwitcherAtom);
        if (s != null && !s.shown) {
            globalStore.set(tabSwitcherAtom, { ...s, shown: true });
        }
    }, SWITCHER_DELAY_MS);
}

export function closeSwitcher(): void {
    clearTimeout(showTimer);
    if (globalStore.get(tabSwitcherAtom) != null) {
        globalStore.set(tabSwitcherAtom, null);
    }
}

/** Open a tab from the switcher: the pick when the modifier goes up, or the tile clicked. A tab closed meanwhile is
 *  passed over: the one in view stays. */
export function openFromSwitcher(model: AgentsViewModel, id?: string): void {
    const s = globalStore.get(tabSwitcherAtom);
    closeSwitcher();
    const target = id ?? (s != null ? pickOf(s) : undefined);
    if (target == null || target === globalStore.get(model.focusIdAtom)) {
        return;
    }
    const exists =
        globalStore.get(model.agentsAtom).some((a) => a.id === target) ||
        globalStore.get(model.terminalsAtom).some((a) => a.id === target);
    if (exists) {
        model.focusFromKeys(target);
    }
}

/** Keeps recentTabsAtom: whatever takes focus, by any route, moves to its front. Returns the unsubscribe. */
export function trackRecentTabs(model: AgentsViewModel): () => void {
    const push = () => {
        const id = globalStore.get(model.focusIdAtom);
        if (id != null) {
            globalStore.set(recentTabsAtom, (r) => (r[0] === id ? r : pushRecent(r, id)));
        }
    };
    push();
    return globalStore.sub(model.focusIdAtom, push);
}
