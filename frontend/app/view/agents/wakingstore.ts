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

// tab id -> the last wake of it that failed, from whichever place started it (the card, the Chat box's Wake, a row's
// menu): the sleeping card shows its reason with Start fresh and Close. `at` ties it to the sleep it came from, so it
// does not show on the next sleep of the same agent. A wake that succeeds drops it.
export interface WakeFailure {
    at: number;
    reason: string;
}
export const wakeFailuresAtom = atom<ReadonlyMap<string, WakeFailure>>(new Map());

export function setWakeFailure(id: string, reason: string | null): void {
    const cur = globalStore.get(wakeFailuresAtom);
    if (reason == null && !cur.has(id)) {
        return;
    }
    const next = new Map(cur);
    if (reason == null) {
        next.delete(id);
    } else {
        next.set(id, { at: Date.now(), reason });
    }
    globalStore.set(wakeFailuresAtom, next);
}

/** Pure: the reason of a failed wake that belongs to the sleep since `since`, or undefined. */
export function failureOfSleep(f: WakeFailure | undefined, since: number): string | undefined {
    return f != null && f.at >= since ? f.reason : undefined;
}

export function useWakeFailure(id: string | undefined): WakeFailure | undefined {
    const m = useAtomValue(wakeFailuresAtom);
    return id != null ? m.get(id) : undefined;
}

// tab id -> what is typed in a sleeping agent's message box. Here, not in the box's state: the box unmounts when the
// person picks another agent, which mid-wake dropped the message being sent (it still arrived, but read as lost), and a
// failed wake's message is kept to send again. Cleared once the wake delivers it.
export const wakeDraftsAtom = atom<ReadonlyMap<string, string>>(new Map());

/** Pure: the drafts with id's set to text; an empty text drops it. */
export function withWakeDraft(m: ReadonlyMap<string, string>, id: string, text: string): ReadonlyMap<string, string> {
    const next = new Map(m);
    if (text !== "") {
        next.set(id, text);
    } else {
        next.delete(id);
    }
    return next;
}

export function setWakeDraft(id: string, text: string): void {
    globalStore.set(wakeDraftsAtom, withWakeDraft(globalStore.get(wakeDraftsAtom), id, text));
}

export function useWakeDraft(id: string | undefined): string {
    const m = useAtomValue(wakeDraftsAtom);
    return (id != null ? m.get(id) : undefined) ?? "";
}
