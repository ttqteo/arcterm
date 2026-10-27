// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agents a wake is relaunching right now, whichever place started it (the sleeping card, the composer, a row's
// menu, the Consumers panel, a cockpit action). While an agent wakes, what would cut the wake short (Close, Interrupt,
// a second Wake or message) is off everywhere, not only on the control that was pressed. Its own module, so
// agentactions can read it without pulling in agentsleep's imports.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";

// tab id -> wakes in flight for it (two places can wake the same agent at once)
export const wakingAtom = atom<ReadonlyMap<string, number>>(new Map());

/** Pure: the count map with one more (delta 1) or one fewer (delta -1) wake for id; an id at zero is dropped. */
export function bumpWaking(m: ReadonlyMap<string, number>, id: string, delta: 1 | -1): ReadonlyMap<string, number> {
    const next = new Map(m);
    const n = (next.get(id) ?? 0) + delta;
    if (n > 0) {
        next.set(id, n);
    } else {
        next.delete(id);
    }
    return next;
}

/** Marks id as waking for as long as the call runs, and returns what it returns. */
export async function whileWaking<T>(id: string, call: () => Promise<T>): Promise<T> {
    globalStore.set(wakingAtom, bumpWaking(globalStore.get(wakingAtom), id, 1));
    try {
        return await call();
    } finally {
        globalStore.set(wakingAtom, bumpWaking(globalStore.get(wakingAtom), id, -1));
    }
}

export function isWaking(id: string | undefined): boolean {
    return id != null && globalStore.get(wakingAtom).has(id);
}

export function useWaking(id: string | undefined): boolean {
    const m = useAtomValue(wakingAtom);
    return id != null && m.has(id);
}
