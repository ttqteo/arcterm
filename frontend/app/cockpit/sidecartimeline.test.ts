// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { RailEvent } from "@/app/view/agents/cockpitevents";
import { describe, expect, it } from "vitest";
import {
    failedFrom,
    MAX_SPANS,
    recordTimeline,
    spanStateOf,
    TIMELINE_WINDOW_MS,
    type Timeline,
} from "./sidecartimeline";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe("recordTimeline", () => {
    it("records one open span from `since` on the first sighting", () => {
        const t = recordTimeline({}, [{ id: "a", state: "working", since: NOW - MIN }], NOW);
        expect(t).toEqual({ a: [{ state: "working", from: NOW - MIN }] });
    });

    it("opens the first span at now when the sighting has no `since`", () => {
        const t = recordTimeline({}, [{ id: "a", state: "asking" }], NOW);
        expect(t).toEqual({ a: [{ state: "asking", from: NOW }] });
    });

    it("changes nothing and returns the same object for a sighting in the same state", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: NOW - MIN }], NOW);
        const t1 = recordTimeline(t0, [{ id: "a", state: "working", since: NOW - MIN }], NOW + MIN);
        expect(t1).toBe(t0);
    });

    it("closes the open span at now and opens the next on a change", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: NOW - 5 * MIN }], NOW - 5 * MIN);
        const t1 = recordTimeline(t0, [{ id: "a", state: "review" }], NOW);
        expect(t1).toEqual({
            a: [
                { state: "working", from: NOW - 5 * MIN, to: NOW },
                { state: "finished", from: NOW },
            ],
        });
        expect(t1).not.toBe(t0);
        // the old Timeline is not mutated
        expect(t0).toEqual({ a: [{ state: "working", from: NOW - 5 * MIN }] });
    });

    it("maps review and idle to finished, and failed to failed whatever the state", () => {
        expect(spanStateOf({ state: "review" })).toBe("finished");
        expect(spanStateOf({ state: "idle" })).toBe("finished");
        expect(spanStateOf({ state: "working" })).toBe("working");
        expect(spanStateOf({ state: "asking" })).toBe("asking");
        expect(spanStateOf({ state: "asleep" })).toBeNull();
        for (const state of ["working", "asking", "review", "idle", "asleep"] as const) {
            expect(spanStateOf({ state, failed: true })).toBe("failed");
        }
        // review and idle share a span: a move between them is no change
        const t0 = recordTimeline({}, [{ id: "a", state: "review", since: NOW - MIN }], NOW);
        const t1 = recordTimeline(t0, [{ id: "a", state: "idle" }], NOW + MIN);
        expect(t1).toBe(t0);
    });

    it("closes the open span and opens none when the agent falls asleep", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: NOW - 5 * MIN }], NOW - 5 * MIN);
        const t1 = recordTimeline(t0, [{ id: "a", state: "asleep" }], NOW);
        expect(t1).toEqual({ a: [{ state: "working", from: NOW - 5 * MIN, to: NOW }] });
        // asleep again: nothing to record, the same object
        expect(recordTimeline(t1, [{ id: "a", state: "asleep" }], NOW + MIN)).toBe(t1);
    });

    it("records no span for an agent first seen asleep, then opens one when it wakes", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "asleep" }], NOW);
        expect(t0).toEqual({ a: [] });
        const t1 = recordTimeline(t0, [{ id: "a", state: "working" }], NOW + MIN);
        expect(t1).toEqual({ a: [{ state: "working", from: NOW + MIN }] });
    });

    it("turns a working agent's lane failed when the sighting says failed", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: NOW - 5 * MIN }], NOW - 5 * MIN);
        const t1 = recordTimeline(t0, [{ id: "a", state: "working", failed: true }], NOW);
        expect(t1.a).toEqual([
            { state: "working", from: NOW - 5 * MIN, to: NOW },
            { state: "failed", from: NOW },
        ]);
    });

    it("drops an agent missing from the sightings", () => {
        const t0 = recordTimeline(
            {},
            [
                { id: "a", state: "working", since: NOW - MIN },
                { id: "b", state: "working", since: NOW - MIN },
            ],
            NOW
        );
        const t1 = recordTimeline(t0, [{ id: "a", state: "working" }], NOW + MIN);
        expect(Object.keys(t1)).toEqual(["a"]);
        expect(t1.a).toBe(t0.a);
    });

    it("returns the same object when sightings and Timeline name the same agents in the same states", () => {
        const seen = [
            { id: "a", state: "working" as const, since: NOW - MIN },
            { id: "b", state: "idle" as const, since: NOW - 2 * MIN },
        ];
        const t0 = recordTimeline({}, seen, NOW);
        expect(recordTimeline(t0, seen, NOW + 1000)).toBe(t0);
    });

    it("drops spans that ended more than 2 hours before now", () => {
        const t: Timeline = {
            a: [
                { state: "working", from: NOW - 5 * 60 * MIN, to: NOW - 3 * 60 * MIN },
                { state: "finished", from: NOW - 3 * 60 * MIN, to: NOW - 2 * 60 * MIN - 1 },
                { state: "working", from: NOW - 2 * 60 * MIN - 1 },
            ],
        };
        const next = recordTimeline(t, [{ id: "a", state: "working" }], NOW);
        expect(next).not.toBe(t);
        expect(next.a).toEqual([{ state: "working", from: NOW - 2 * 60 * MIN - 1 }]);
    });

    it("keeps a span that ended exactly at the window's edge", () => {
        const t: Timeline = {
            a: [
                { state: "working", from: NOW - 3 * 60 * MIN, to: NOW - TIMELINE_WINDOW_MS },
                { state: "finished", from: NOW - TIMELINE_WINDOW_MS },
            ],
        };
        expect(recordTimeline(t, [{ id: "a", state: "idle" }], NOW)).toBe(t);
    });

    it("keeps at most 64 spans per agent, the newest", () => {
        let t: Timeline = {};
        let now = NOW;
        // 100 alternations, a minute apart: far more than 64 spans, all inside 2 hours
        for (let i = 0; i < 100; i++) {
            t = recordTimeline(t, [{ id: "a", state: i % 2 === 0 ? "working" : "asking", since: now }], now);
            now += 1000;
        }
        expect(t.a.length).toBe(MAX_SPANS);
        const last = t.a[t.a.length - 1];
        expect(last.to).toBeUndefined();
        expect(last.state).toBe("asking"); // i = 99
        expect(last.from).toBe(NOW + 99 * 1000);
        // the newest are kept: the oldest kept span is the (100 - 64)th opened
        expect(t.a[0].from).toBe(NOW + 36 * 1000);
    });

    it("keeps an open span that began before the window as it is, and returns the same object as the window moves", () => {
        const from = NOW - 3 * 60 * MIN;
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: from }], NOW);
        expect(t0.a).toEqual([{ state: "working", from }]); // unclipped: the page clips it
        const t1 = recordTimeline(t0, [{ id: "a", state: "working" }], NOW + 30 * MIN);
        expect(t1).toBe(t0);
    });

    it("keeps a span that ended inside the window as it is", () => {
        const t: Timeline = {
            a: [
                { state: "working", from: NOW - 3 * 60 * MIN, to: NOW - 90 * MIN },
                { state: "finished", from: NOW - 90 * MIN },
            ],
        };
        expect(recordTimeline(t, [{ id: "a", state: "idle" }], NOW)).toBe(t);
        const moved = recordTimeline(t, [{ id: "a", state: "idle" }], NOW + 10 * MIN);
        expect(moved).toBe(t); // the first span ended 80 minutes before then: still in
    });
});

describe("recordTimeline: `at`, the time of a transition", () => {
    const T = NOW - 30 * MIN;

    it("closes the old span and opens the new one at `at` when it is earlier than now", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: T }], T);
        const t1 = recordTimeline(t0, [{ id: "a", state: "working", failed: true, at: T + 10 * MIN }], NOW);
        expect(t1.a).toEqual([
            { state: "working", from: T, to: T + 10 * MIN },
            { state: "failed", from: T + 10 * MIN },
        ]);
    });

    it("behaves as before with no `at`", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: T }], T);
        const t1 = recordTimeline(t0, [{ id: "a", state: "working", failed: true }], NOW);
        expect(t1.a).toEqual([
            { state: "working", from: T, to: NOW },
            { state: "failed", from: NOW },
        ]);
    });

    it("clamps an `at` earlier than the open span's start to that start", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: T }], T);
        const t1 = recordTimeline(t0, [{ id: "a", state: "asking", at: T - 10 * MIN }], NOW);
        expect(t1.a).toEqual([
            { state: "working", from: T, to: T },
            { state: "asking", from: T },
        ]);
    });

    it("clamps an `at` later than now to now", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: T }], T);
        const t1 = recordTimeline(t0, [{ id: "a", state: "review", at: NOW + 10 * MIN }], NOW);
        expect(t1.a).toEqual([
            { state: "working", from: T, to: NOW },
            { state: "finished", from: NOW },
        ]);
    });

    it("closes the open span at `at` when the agent falls asleep", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: T }], T);
        const t1 = recordTimeline(t0, [{ id: "a", state: "asleep", at: T + 5 * MIN }], NOW);
        expect(t1.a).toEqual([{ state: "working", from: T, to: T + 5 * MIN }]);
    });

    it("opens a span at `at` for an agent waking from sleep, no earlier than the last span's end", () => {
        const t: Timeline = { a: [{ state: "working", from: T - 20 * MIN, to: T }] };
        const at = recordTimeline(t, [{ id: "a", state: "working", at: T + 5 * MIN }], NOW);
        expect(at.a).toEqual([
            { state: "working", from: T - 20 * MIN, to: T },
            { state: "working", from: T + 5 * MIN },
        ]);
        const early = recordTimeline(t, [{ id: "a", state: "working", at: T - 10 * MIN }], NOW);
        expect(early.a[1]).toEqual({ state: "working", from: T });
    });

    it("ignores `at` when the state has not changed", () => {
        const t0 = recordTimeline({}, [{ id: "a", state: "working", since: T }], T);
        expect(recordTimeline(t0, [{ id: "a", state: "working", at: T + 5 * MIN }], NOW)).toBe(t0);
    });

    it("ignores `at` on the first sighting, which starts at `since` or now", () => {
        expect(recordTimeline({}, [{ id: "a", state: "working", since: T, at: T + 5 * MIN }], NOW).a).toEqual([
            { state: "working", from: T },
        ]);
        expect(recordTimeline({}, [{ id: "a", state: "working", at: T + 5 * MIN }], NOW).a).toEqual([
            { state: "working", from: NOW },
        ]);
    });
});

describe("failedFrom", () => {
    const ev = (kind: RailEvent["kind"], ts: number): RailEvent => ({
        key: `${kind}-${ts}`,
        who: "lead",
        kind,
        text: "",
        ts,
    });

    it("returns the ts of the first failed rail event", () => {
        expect(failedFrom([ev("asked", 5), ev("failed", 30), ev("finished", 40), ev("failed", 20)])).toBe(20);
    });

    it("returns null when no event failed, or there are none", () => {
        expect(failedFrom([ev("asked", 5), ev("landed", 9)])).toBeNull();
        expect(failedFrom([])).toBeNull();
    });
});
