// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the Sidecar bridge (sidecarbridge.tsx; spec 2026-11-13-sidecar-design.md, section 2): which acts the
// page may send, when two snapshots are the same, and when a snapshot goes out. The bridge keeps one FeedState and asks
// these functions what to do at each change, hello and close, so the throttle and the last-sent memory are tested here
// and not through a timer.

import type { SidecarAct, SidecarSnapshot } from "./sidecartypes";

// At most one snapshot per this long (decision 1): a burst of store changes goes out as one trailing emit.
export const SNAPSHOT_THROTTLE_MS = 500;

export type ActCheck = { ok: true; act: SidecarAct } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
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

/** Whether two snapshots say the same thing: everything but `now`, which moves on every build. Nothing sent is never the same. */
export function sameSnapshot(a: SidecarSnapshot | null, b: SidecarSnapshot | null): boolean {
    if (a == null || b == null) {
        return false;
    }
    return same(a.counts, b.counts) && same(a.tiles, b.tiles);
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
