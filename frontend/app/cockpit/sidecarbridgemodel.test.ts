// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    EMPTY_FEED,
    SNAPSHOT_THROTTLE_MS,
    afterClosed,
    afterEmit,
    afterHello,
    planChange,
    sameSnapshot,
    validateAct,
} from "./sidecarbridgemodel";
import type { SidecarSnapshot, SidecarTile } from "./sidecartypes";

function tile(id: string, over: Partial<SidecarTile> = {}): SidecarTile {
    return { id, name: id, runtime: "Claude · opus", state: "working", messages: [], ...over };
}

function snap(tiles: SidecarTile[], now = 1000): SidecarSnapshot {
    return { now, counts: { asking: 0, working: tiles.length, idle: 0 }, tiles };
}

const asking = tile("a1", {
    state: "asking",
    ask: { question: "Pick one", options: ["x", "y", "z"], answerable: true },
});
const elsewhere = tile("a2", {
    state: "asking",
    ask: { question: "Pick several", options: ["x", "y"], answerable: false },
});
const roster = snap([asking, elsewhere, tile("w1")]);

describe("validateAct", () => {
    it("takes hello with no snapshot sent yet", () => {
        expect(validateAct({ kind: "hello" }, null)).toEqual({ ok: true, act: { kind: "hello" } });
    });

    it("refuses what is not an act, and an unknown kind", () => {
        for (const raw of [null, undefined, 3, "open", [], {}, { kind: 4 }, { kind: "close" }]) {
            const r = validateAct(raw, roster);
            expect(r.ok).toBe(false);
            if (r.ok === false) {
                expect(r.reason.length).toBeGreaterThan(0);
            }
        }
        const r = validateAct({ kind: "older", id: "a1" }, roster);
        expect(r).toEqual({ ok: false, reason: 'unknown act kind "older"' });
    });

    it("takes an open of a tile in the last snapshot", () => {
        expect(validateAct({ kind: "open", id: "w1" }, roster)).toEqual({ ok: true, act: { kind: "open", id: "w1" } });
    });

    it("refuses an open of an unknown id, a missing id, or before any snapshot", () => {
        expect(validateAct({ kind: "open", id: "ghost" }, roster)).toEqual({
            ok: false,
            reason: 'open: no tile "ghost" in the last snapshot',
        });
        expect(validateAct({ kind: "open" }, roster).ok).toBe(false);
        expect(validateAct({ kind: "open", id: 7 }, roster).ok).toBe(false);
        expect(validateAct({ kind: "open", id: "w1" }, null)).toEqual({
            ok: false,
            reason: "open: no snapshot has gone out yet",
        });
    });

    it("takes an answer to an answerable ask, option 0 up to the last one", () => {
        for (const option of [0, 1, 2]) {
            expect(validateAct({ kind: "answer", id: "a1", option }, roster)).toEqual({
                ok: true,
                act: { kind: "answer", id: "a1", option },
            });
        }
    });

    it("refuses an answer to an unknown id", () => {
        const r = validateAct({ kind: "answer", id: "ghost", option: 0 }, roster);
        expect(r).toEqual({ ok: false, reason: 'answer: no tile "ghost" in the last snapshot' });
    });

    it("refuses an answer to a tile with no ask, or an ask the main window answers", () => {
        expect(validateAct({ kind: "answer", id: "w1", option: 0 }, roster)).toEqual({
            ok: false,
            reason: 'answer: "w1" has no ask',
        });
        expect(validateAct({ kind: "answer", id: "a2", option: 0 }, roster)).toEqual({
            ok: false,
            reason: 'answer: the ask of "a2" is not answerable from a tile',
        });
    });

    it("refuses an option out of range or not a whole number", () => {
        for (const option of [-1, 3, 9, 0.5, NaN, Infinity, "1", null, undefined]) {
            const r = validateAct({ kind: "answer", id: "a1", option }, roster);
            expect(r.ok).toBe(false);
            if (r.ok === false) {
                expect(r.reason).toMatch(/^answer: option /);
            }
        }
    });

    it("keeps only the fields of the act it returns", () => {
        const r = validateAct({ kind: "open", id: "w1", extra: "x" }, roster);
        expect(r).toEqual({ ok: true, act: { kind: "open", id: "w1" } });
    });
});

describe("sameSnapshot", () => {
    it("ignores now", () => {
        expect(sameSnapshot(snap([asking], 1), snap([asking], 99999))).toBe(true);
    });

    it("sees a changed tile, a changed message, a changed order and a changed count", () => {
        const base = snap([tile("a"), tile("b")]);
        expect(sameSnapshot(base, snap([tile("a"), tile("b", { state: "idle" })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a"), tile("b", { messages: [{ say: "hi" }] })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("b"), tile("a")]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a")]))).toBe(false);
        expect(sameSnapshot(base, { ...base, counts: { asking: 1, working: 1, idle: 0 } })).toBe(false);
    });

    it("sees a changed since, ctxPct and sent flag", () => {
        const base = snap([tile("a", { since: 5, ctxPct: 10 })]);
        expect(sameSnapshot(base, snap([tile("a", { since: 6, ctxPct: 10 })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a", { since: 5, ctxPct: 11 })]))).toBe(false);
        expect(sameSnapshot(base, snap([tile("a", { since: 5, ctxPct: 10, sent: true })]))).toBe(false);
    });

    it("treats nothing sent as different from any snapshot", () => {
        expect(sameSnapshot(null, snap([]))).toBe(false);
        expect(sameSnapshot(snap([]), null)).toBe(false);
    });
});

describe("planChange", () => {
    const next = snap([tile("a")]);

    it("emits at once the first time", () => {
        expect(planChange(EMPTY_FEED, next, false, 10_000)).toEqual({ kind: "emit" });
    });

    it("says nothing for a snapshot equal to the last one sent, ignoring now", () => {
        const feed = afterEmit(snap([tile("a")], 1), 10_000);
        expect(planChange(feed, snap([tile("a")], 99), false, 20_000)).toEqual({ kind: "none" });
    });

    it("emits at once when the last emit is a throttle window or more ago", () => {
        const feed = afterEmit(snap([]), 10_000);
        expect(planChange(feed, next, false, 10_000 + SNAPSHOT_THROTTLE_MS)).toEqual({ kind: "emit" });
        expect(planChange(feed, next, false, 10_000 + SNAPSHOT_THROTTLE_MS + 700)).toEqual({ kind: "emit" });
    });

    it("schedules the trailing emit for what is left of the window", () => {
        const feed = afterEmit(snap([]), 10_000);
        expect(planChange(feed, next, false, 10_100)).toEqual({ kind: "later", delayMs: SNAPSHOT_THROTTLE_MS - 100 });
        expect(planChange(feed, next, false, 10_000)).toEqual({ kind: "later", delayMs: SNAPSHOT_THROTTLE_MS });
    });

    it("coalesces into a trailing emit already scheduled", () => {
        const feed = afterEmit(snap([]), 10_000);
        expect(planChange(feed, next, true, 10_200)).toEqual({ kind: "none" });
    });

    it("a trailing emit that fires after the window asks again with no timer pending, and emits", () => {
        const feed = afterEmit(snap([]), 10_000);
        const first = planChange(feed, next, false, 10_100);
        expect(first).toEqual({ kind: "later", delayMs: SNAPSHOT_THROTTLE_MS - 100 });
        // the timer fires at 10_500 and clears its own flag
        expect(planChange(feed, next, false, 10_500)).toEqual({ kind: "emit" });
    });

    it("still emits a change right after one whose snapshot differs, once the window is up", () => {
        expect(planChange(afterEmit(snap([tile("a")]), 10_000), snap([tile("a"), tile("b")]), false, 10_900)).toEqual({
            kind: "emit",
        });
    });

    it("a trailing emit whose change was undone by the time it fires says nothing", () => {
        const feed = afterEmit(snap([tile("a")]), 10_000);
        expect(planChange(feed, snap([tile("a")]), false, 10_500)).toEqual({ kind: "none" });
    });
});

describe("the last-sent memory", () => {
    it("starts with nothing sent and no emit time", () => {
        expect(EMPTY_FEED).toEqual({ lastSent: null, lastEmitAt: null });
    });

    it("afterEmit keeps the snapshot and when it went out", () => {
        const s = snap([tile("a")]);
        expect(afterEmit(s, 5)).toEqual({ lastSent: s, lastEmitAt: 5 });
    });

    it("a hello forgets the last snapshot sent, so an unchanged roster still goes out again", () => {
        const s = snap([tile("a")]);
        const feed = afterEmit(s, 10_000);
        expect(planChange(feed, snap([tile("a")]), false, 20_000)).toEqual({ kind: "none" });
        const reset = afterHello(feed);
        expect(reset.lastSent).toBeNull();
        expect(planChange(reset, snap([tile("a")]), false, 20_000)).toEqual({ kind: "emit" });
    });

    it("a hello leaves the act check with nothing to validate against until the answering emit", () => {
        const s = snap([tile("a")]);
        const reset = afterHello(afterEmit(s, 10_000));
        expect(validateAct({ kind: "open", id: "a" }, reset.lastSent).ok).toBe(false);
        const sent = afterEmit(s, 10_001);
        expect(validateAct({ kind: "open", id: "a" }, sent.lastSent).ok).toBe(true);
    });

    it("sidecar:closed forgets everything, so the next page's first snapshot goes out at once", () => {
        const feed = afterEmit(snap([tile("a")]), 10_000);
        const closed = afterClosed();
        expect(closed).toEqual(EMPTY_FEED);
        expect(planChange(closed, snap([tile("a")]), false, 10_001)).toEqual({ kind: "emit" });
        expect(feed.lastSent).not.toBeNull(); // the old memory is not mutated
    });
});
