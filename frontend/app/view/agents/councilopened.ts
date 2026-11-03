// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// When the person last opened each council, kept per browser in localStorage under `council.opened`: the Agent tree reads
// it to tell an ended council the person has not looked at yet (unread), and the Discussion to badge the ideas that came
// since. It needs no list of councils to seed it: the first read stores `seededAt`, and a council never opened counts as
// opened then, so only councils that end (or arrive by a sync) after that read count as unread. councilpane.tsx marks a
// council opened when the person leaves it. Every storage read and write is wrapped: a failure logs and the page goes on
// with the map in memory.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

export const COUNCIL_OPENED_KEY = "council.opened";

export interface CouncilOpenedMap {
    seededAt: number; // ms: the first time the map was read; a council never opened counts as opened then
    opened: Record<string, number>; // council id → ms the person last left it
}

/** The two calls of localStorage this file uses, so a test can hand it a map. */
export type OpenedStore = Pick<Storage, "getItem" | "setItem">;

// the states in which a council has not ended: it runs, waits on the person, or waits its turn
const NOT_ENDED: ReadonlySet<string> = new Set(["running", "awaiting-you", "queued"]);

function isTime(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

// What localStorage hands back: anything. A map whose seededAt reads is kept, each opened time that is a number with it.
function parseOpened(raw: string | null): CouncilOpenedMap | null {
    if (raw == null) {
        return null;
    }
    let v: unknown;
    try {
        v = JSON.parse(raw);
    } catch {
        return null;
    }
    if (v == null || typeof v !== "object" || !isTime((v as CouncilOpenedMap).seededAt)) {
        return null;
    }
    const opened: Record<string, number> = {};
    const src = (v as { opened?: unknown }).opened;
    if (src != null && typeof src === "object") {
        for (const [id, t] of Object.entries(src)) {
            if (isTime(t)) {
                opened[id] = t;
            }
        }
    }
    return { seededAt: (v as CouncilOpenedMap).seededAt, opened };
}

/** Write the map to `store`; a failure logs and is otherwise ignored (the map stays in memory). */
export function saveOpened(store: OpenedStore | undefined, map: CouncilOpenedMap): void {
    if (store == null) {
        return;
    }
    try {
        store.setItem(COUNCIL_OPENED_KEY, JSON.stringify(map));
    } catch (e) {
        console.error("council: cannot save the last-opened map", e);
    }
}

/** Read the map from `store`. With nothing stored (or nothing readable) it starts one seeded at `now` and persists it,
 *  so `seededAt` is set once and kept by every later read. */
export function loadOpened(store: OpenedStore | undefined, now: number): CouncilOpenedMap {
    let raw: string | null = null;
    if (store != null) {
        try {
            raw = store.getItem(COUNCIL_OPENED_KEY);
        } catch (e) {
            console.error("council: cannot read the last-opened map", e);
        }
    }
    const read = parseOpened(raw);
    if (read != null) {
        return read;
    }
    const fresh: CouncilOpenedMap = { seededAt: now, opened: {} };
    saveOpened(store, fresh);
    return fresh;
}

/** Pure: when the person last opened council `id`: its own time, else `seededAt`. */
export function openedAt(map: CouncilOpenedMap, id: string): number {
    return map.opened[id] ?? map.seededAt;
}

/** Pure: when a council ended: its summary's time when it has one, else its last save. */
export function endedAt(c: Pick<Council, "summary" | "updated">): number {
    return c.summary?.at || c.updated;
}

/** Pure: whether a council ended (not running, waiting on the person or queued) after the person last opened it. */
export function isUnreadCouncil(
    c: Pick<Council, "id" | "state" | "summary" | "updated">,
    map: CouncilOpenedMap
): boolean {
    return !NOT_ENDED.has(c.state) && endedAt(c) > openedAt(map, c.id);
}

/** Pure: the map with council `id` opened at `now`. */
export function markOpened(map: CouncilOpenedMap, id: string, now: number): CouncilOpenedMap {
    return { seededAt: map.seededAt, opened: { ...map.opened, [id]: now } };
}

// the browser's store, or none where the page has none (a test, or a hardened profile that throws on the property read)
function browserStore(): OpenedStore | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

/** The last-opened map, read (and seeded) once when this module loads. */
export const councilOpenedAtom = atom<CouncilOpenedMap>(
    loadOpened(browserStore(), Date.now())
) as PrimitiveAtom<CouncilOpenedMap>;

/** Replace the last-opened map, and persist it (a CDP scenario sets one through `__arcCouncil.setOpened`). */
export function saveOpenedMap(map: CouncilOpenedMap): void {
    globalStore.set(councilOpenedAtom, map);
    saveOpened(browserStore(), map);
}

/** Mark council `id` opened now, and persist the map. */
export function markCouncilOpened(id: string, now = Date.now()): void {
    saveOpenedMap(markOpened(globalStore.get(councilOpenedAtom), id, now));
}
