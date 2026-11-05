// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The lobby Christmas tree as the cockpit holds it (spec 2026-11-05-christmas-tree-game-design.md, "Positions and
// announcements"): wavesrv's season ledger, kept current by its `xmastree:changed` event, turned into the view every
// tree draws (the hall, the close-up card, the Agent rail's pine). wavesrv owns the count; the arrangement of the
// ornaments is this viewer's own, kept in localStorage per season and advanced from its count to the ledger's.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import {
    advance,
    emptyArrangement,
    milestoneAt,
    moveOrnament,
    parseArrangement,
    spotCount,
    type Arrangement,
    type XmasPhase,
    type XmasTreeView,
} from "./xmastreemodel";

/** localStorage key of the season's arrangement. */
export function xmasTreeKey(season: number): string {
    return `xmas.tree.${season}`;
}

/** localStorage key of the highest milestone announced this season. */
export function xmasAnnouncedKey(season: number): string {
    return `xmas.tree.announced.${season}`;
}

export function asPhase(phase: string | undefined): XmasPhase {
    return phase === "season" || phase === "newyear" ? phase : "off";
}

/** The arrangement for `count` finished tasks, built on the saved one: advanced when it is behind, kept when it is
 *  level, rebuilt from nothing when it is missing, ahead of the ledger, or holds more spots than its own stage has (it
 *  came from somewhere else). A short spots list is padded to the stage's spot count, so every spot can be moved to. */
export function arrangementFor(saved: Arrangement | null, count: number): Arrangement {
    const usable = saved != null && saved.count <= count && saved.spots.length <= spotCount(milestoneAt(saved.count));
    const next = advance(usable ? saved : emptyArrangement(), count);
    const want = spotCount(milestoneAt(count));
    if (next.spots.length >= want) return next;
    const spots = next.spots.slice();
    while (spots.length < want) spots.push(null);
    return { count: next.count, spots };
}

/** The view a tree draws: in phase off nothing has grown (count 0, no ornaments). */
export function treeView(data: XmasTreeData, saved: Arrangement | null): XmasTreeView {
    const phase = asPhase(data.phase);
    const done = phase === "off" ? [] : (data.done ?? []);
    const count = done.length;
    return {
        season: data.season,
        phase,
        count,
        milestone: milestoneAt(count),
        arrangement: phase === "off" ? emptyArrangement() : arrangementFor(saved, count),
        done,
    };
}

/** What the Agent rail's pine draws: the season's stage and ornaments in season and on 1 January, the full tree bare
 *  out of season (the decor it was before the game). */
export function railPine(view: XmasTreeView): { milestone: number; arrangement: Arrangement | null } {
    if (view.phase === "off") return { milestone: 7, arrangement: null };
    return { milestone: view.milestone, arrangement: view.arrangement };
}

/** The highest milestone announced, read from storage: 0 when missing or unreadable. */
export function parseAnnounced(raw: string | null): number {
    const n = raw == null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
}

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.error(`xmastree: reading ${key} failed`, e);
        return null;
    }
}

function writeStorage(key: string, value: string): boolean {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.error(`xmastree: writing ${key} failed`, e);
        return false;
    }
}

function readArrangement(season: number): Arrangement | null {
    const raw = readStorage(xmasTreeKey(season));
    if (raw == null) return null;
    try {
        return parseArrangement(JSON.parse(raw));
    } catch {
        return null;
    }
}

// wavesrv's answer; null until the first one
const xmasTreeLiveAtom = atom<XmasTreeData | null>(null) as PrimitiveAtom<XmasTreeData | null>;

/** A fixture in place of wavesrv's answer (the DEV hook window.__cockpitOfficeTree); it wins over live data. */
export const xmasTreeFixtureAtom = atom<XmasTreeData | null>(null) as PrimitiveAtom<XmasTreeData | null>;

const xmasTreeDataAtom = atom((get) => get(xmasTreeFixtureAtom) ?? get(xmasTreeLiveAtom));

// the season's arrangement as last saved, kept level with the ledger by syncArrangement
const savedAtom = atom<{ season: number; arrangement: Arrangement } | null>(null) as PrimitiveAtom<{
    season: number;
    arrangement: Arrangement;
} | null>;

/** The tree every view draws; null only until wavesrv's first answer. */
export const xmasTreeAtom: Atom<XmasTreeView | null> = atom((get) => {
    const data = get(xmasTreeDataAtom);
    if (data == null) return null;
    const saved = get(savedAtom);
    return treeView(data, saved?.season === data.season ? saved.arrangement : null);
});

/** Bumped by "go to the tree" (the milestone toast); the Office walks the boss to the tree when it changes. */
export const xmasTreeGoAtom = atom(0) as PrimitiveAtom<number>;

function save(season: number, prev: Arrangement | null, next: Arrangement): void {
    if (next !== prev) {
        writeStorage(xmasTreeKey(season), JSON.stringify(next));
    }
    globalStore.set(savedAtom, { season, arrangement: next });
}

// advances the season's saved arrangement to the ledger's count and writes it back when it changed
function syncArrangement(): void {
    const data = globalStore.get(xmasTreeDataAtom);
    if (data == null || asPhase(data.phase) === "off") return;
    const held = globalStore.get(savedAtom);
    const prev = held?.season === data.season ? held.arrangement : readArrangement(data.season);
    const next = arrangementFor(prev, (data.done ?? []).length);
    if (next !== prev || held?.season !== data.season) {
        save(data.season, prev, next);
    }
}

/** Moves the ornament at spot `from` to spot `to` (a free spot, or a swap), and keeps it. */
export function moveXmasOrnament(from: number, to: number): void {
    const view = globalStore.get(xmasTreeAtom);
    if (view == null || view.phase === "off") return;
    const next = moveOrnament(view.arrangement, from, to);
    if (next !== view.arrangement) {
        save(view.season, view.arrangement, next);
    }
}

let feeding = false;

/** Feeds the tree: one read, then every `xmastree:changed` event. Idempotent. The event is subscribed first, and a read
 *  that lands after an event is dropped, so a slow read never puts back a count the event already moved on from. */
export function ensureXmasTreeFeed(): void {
    if (feeding) return;
    feeding = true;
    globalStore.sub(xmasTreeDataAtom, syncArrangement);
    syncArrangement();
    let heard = false;
    waveEventSubscribeSingle({
        eventType: "xmastree:changed",
        handler: (e) => {
            const data = e.data as XmasTreeData | undefined;
            if (data == null) return;
            heard = true;
            globalStore.set(xmasTreeLiveAtom, data);
        },
    });
    RpcApi.XmasTreeCommand(TabRpcClient)
        .then((data) => {
            if (!heard && data != null) {
                globalStore.set(xmasTreeLiveAtom, data);
            }
        })
        .catch((e) => console.error("XmasTreeCommand failed", e));
}

// milestones whose storage write failed, so one still never shows twice in this session
const unsavedAnnounced = new Map<number, number>();

/** The highest milestone announced this season. */
export function readAnnounced(season: number): number {
    return Math.max(unsavedAnnounced.get(season) ?? 0, parseAnnounced(readStorage(xmasAnnouncedKey(season))));
}

export function writeAnnounced(season: number, milestone: number): void {
    if (writeStorage(xmasAnnouncedKey(season), String(milestone))) {
        unsavedAnnounced.delete(season);
    } else {
        unsavedAnnounced.set(season, milestone);
    }
}
