// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the Sidecar bridge (sidecarbridge.tsx; spec 2026-11-13-sidecar-design.md, section 2): which acts the
// page may send, when two snapshots are the same, and when a snapshot goes out. The bridge keeps one FeedState and asks
// these functions what to do at each change, hello and close, so the throttle and the last-sent memory are tested here
// and not through a timer.

import type { SidecarAct, SidecarHeavy, SidecarSnapshot } from "./sidecartypes";

// At most one snapshot per this long (decision 1): a burst of store changes goes out as one trailing emit.
export const SNAPSHOT_THROTTLE_MS = 500;

export type ActCheck = { ok: true; act: SidecarAct } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

// How many rows one older act may ask for (decision 5: the page asks for 10).
const OLDER_MIN = 1;
const OLDER_MAX = 50;

/** The heavy row of the last snapshot's strain band that a stop or a sleep names; the page can only act on a row it was shown. */
function heavyRow(
    kind: "stop" | "sleep",
    raw: Record<string, unknown>,
    last: SidecarSnapshot | null
): { ok: true; heavy: SidecarHeavy } | { ok: false; reason: string } {
    if (typeof raw.id !== "string") {
        return { ok: false, reason: `${kind}: no id` };
    }
    if (last == null) {
        return { ok: false, reason: `${kind}: no snapshot has gone out yet` };
    }
    if (last.strain == null) {
        return { ok: false, reason: `${kind}: the last snapshot has no strain band` };
    }
    const heavy = last.strain.heavy.find((h) => h.id === raw.id);
    if (heavy == null) {
        return { ok: false, reason: `${kind}: no heavy row "${raw.id}" in the last snapshot` };
    }
    return { ok: true, heavy };
}

/**
 * An act from the page, checked against the last snapshot that went out (the page can only act on what it was shown).
 * The reason of a refusal is what the bridge logs. The act it returns carries only the fields of its kind.
 */
export function validateAct(raw: unknown, last: SidecarSnapshot | null): ActCheck {
    if (!isRecord(raw) || typeof raw.kind !== "string") {
        return { ok: false, reason: "not an act" };
    }
    switch (raw.kind) {
        case "hello":
            return { ok: true, act: { kind: "hello" } };
        case "open": {
            if (typeof raw.id !== "string") {
                return { ok: false, reason: "open: no id" };
            }
            if (last == null) {
                return { ok: false, reason: "open: no snapshot has gone out yet" };
            }
            if (!last.tiles.some((t) => t.id === raw.id)) {
                return { ok: false, reason: `open: no tile "${raw.id}" in the last snapshot` };
            }
            return { ok: true, act: { kind: "open", id: raw.id } };
        }
        case "answer": {
            if (typeof raw.id !== "string") {
                return { ok: false, reason: "answer: no id" };
            }
            if (last == null) {
                return { ok: false, reason: "answer: no snapshot has gone out yet" };
            }
            const tile = last.tiles.find((t) => t.id === raw.id);
            if (tile == null) {
                return { ok: false, reason: `answer: no tile "${raw.id}" in the last snapshot` };
            }
            if (tile.ask == null) {
                return { ok: false, reason: `answer: "${tile.id}" has no ask` };
            }
            if (!tile.ask.answerable) {
                return { ok: false, reason: `answer: the ask of "${tile.id}" is not answerable from a tile` };
            }
            const option = raw.option;
            if (
                typeof option !== "number" ||
                !Number.isInteger(option) ||
                option < 0 ||
                option >= tile.ask.options.length
            ) {
                return {
                    ok: false,
                    reason: `answer: option ${String(option)} is not one of the ${tile.ask.options.length} options of "${tile.id}"`,
                };
            }
            return { ok: true, act: { kind: "answer", id: tile.id, option } };
        }
        case "older": {
            const id = raw.id;
            if (typeof id !== "string") {
                return { ok: false, reason: "older: no id" };
            }
            if (last == null) {
                return { ok: false, reason: "older: no snapshot has gone out yet" };
            }
            if (!last.tiles.some((t) => t.id === id)) {
                return { ok: false, reason: `older: no tile "${id}" in the last snapshot` };
            }
            const cursor = raw.before;
            let before: string | null;
            if (cursor === null) {
                before = null;
            } else if (typeof cursor === "string") {
                before = cursor;
            } else {
                return { ok: false, reason: `older: before ${String(cursor)} is neither a cursor nor null` };
            }
            const count = raw.count;
            if (typeof count !== "number" || !Number.isInteger(count) || count < OLDER_MIN || count > OLDER_MAX) {
                return {
                    ok: false,
                    reason: `older: count ${String(count)} is not a whole number from ${OLDER_MIN} to ${OLDER_MAX}`,
                };
            }
            return { ok: true, act: { kind: "older", id, before, count } };
        }
        case "stop": {
            const row = heavyRow("stop", raw, last);
            if (row.ok === false) {
                return row;
            }
            if (row.heavy.process == null) {
                return { ok: false, reason: `stop: "${row.heavy.id}" has no process to stop` };
            }
            if (raw.pid !== row.heavy.process.pid) {
                return {
                    ok: false,
                    reason: `stop: pid ${String(raw.pid)} is not the process of "${row.heavy.id}" in the band`,
                };
            }
            return { ok: true, act: { kind: "stop", id: row.heavy.id, pid: row.heavy.process.pid } };
        }
        case "sleep": {
            const row = heavyRow("sleep", raw, last);
            if (row.ok === false) {
                return row;
            }
            return { ok: true, act: { kind: "sleep", id: row.heavy.id } };
        }
        default:
            return { ok: false, reason: `unknown act kind "${raw.kind}"` };
    }
}

function same(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (Array.isArray(a)) {
        return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
    }
    if (isRecord(a)) {
        if (!isRecord(b)) {
            return false;
        }
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
            // an absent field and an undefined one are the same thing on the wire
            if (!same(a[k], b[k])) {
                return false;
            }
        }
        return true;
    }
    return false;
}

/**
 * Whether two snapshots say the same thing: everything but `now`, which moves on every build. Nothing sent is never the
 * same. The machine figures reach it already rounded (decision 8), so a reading that only jitters does not differ.
 */
export function sameSnapshot(a: SidecarSnapshot | null, b: SidecarSnapshot | null): boolean {
    if (a == null || b == null) {
        return false;
    }
    return same(a.counts, b.counts) && same(a.tiles, b.tiles) && same(a.machine, b.machine) && same(a.strain, b.strain);
}

/** What the bridge remembers of its feed: the snapshot the page last got, and when it went out. */
export interface FeedState {
    lastSent: SidecarSnapshot | null;
    lastEmitAt: number | null;
}

export const EMPTY_FEED: FeedState = { lastSent: null, lastEmitAt: null };

export type FeedStep =
    | { kind: "emit" } // send the snapshot just built, now
    | { kind: "later"; delayMs: number } // schedule the trailing emit; it builds a fresh snapshot when it fires
    | { kind: "none" }; // nothing changed, or a trailing emit is already scheduled and will carry this change

/**
 * What to do with `next` just built after a store change. `timerPending` is whether a trailing emit is already
 * scheduled: it will build its own snapshot, so this change coalesces into it.
 */
export function planChange(feed: FeedState, next: SidecarSnapshot, timerPending: boolean, now: number): FeedStep {
    if (sameSnapshot(feed.lastSent, next)) {
        return { kind: "none" };
    }
    if (timerPending) {
        return { kind: "none" };
    }
    if (feed.lastEmitAt == null) {
        return { kind: "emit" };
    }
    const wait = SNAPSHOT_THROTTLE_MS - (now - feed.lastEmitAt);
    return wait <= 0 ? { kind: "emit" } : { kind: "later", delayMs: wait };
}

/** The memory once `snap` has gone out. */
export function afterEmit(snap: SidecarSnapshot, now: number): FeedState {
    return { lastSent: snap, lastEmitAt: now };
}

/**
 * A hello forgets the snapshot last sent: a page that reloaded or reopened has none of it, so the answer must go out
 * even when the roster has not changed. The bridge emits at once after this, which sets the memory again.
 */
export function afterHello(feed: FeedState): FeedState {
    return { ...feed, lastSent: null };
}

/** sidecar:closed: the page is gone, so the next one starts from nothing. */
export function afterClosed(): FeedState {
    return EMPTY_FEED;
}
