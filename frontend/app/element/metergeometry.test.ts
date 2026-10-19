// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { meterPct, meterSegments } from "./metergeometry";

describe("meterSegments", () => {
    it("sizes each segment as a share of the explicit total", () => {
        const out = meterSegments(
            [
                { key: "a", value: 25, fill: "bg-accent" },
                { key: "b", value: 75, fill: "bg-success" },
            ],
            100
        );
        expect(out).toEqual([
            { key: "a", fill: "bg-accent", pct: 25 },
            { key: "b", fill: "bg-success", pct: 75 },
        ]);
    });

    // A 2px gap sits between fills; a gap around a zero-width fill reads as a visible seam, so
    // zero-value segments are dropped rather than rendered at 0%.
    it("drops zero and negative segments entirely", () => {
        const out = meterSegments(
            [
                { key: "a", value: 10, fill: "bg-accent" },
                { key: "b", value: 0, fill: "bg-success" },
                { key: "c", value: -5, fill: "bg-warning" },
            ],
            10
        );
        expect(out.map((s) => s.key)).toEqual(["a"]);
    });

    it("falls back to the segment sum when no total is given", () => {
        const out = meterSegments([
            { key: "a", value: 1, fill: "bg-accent" },
            { key: "b", value: 3, fill: "bg-success" },
        ]);
        expect(out.map((s) => s.pct)).toEqual([25, 75]);
    });

    it("returns nothing when there is no positive magnitude", () => {
        expect(meterSegments([{ key: "a", value: 0, fill: "bg-accent" }], 0)).toEqual([]);
        expect(meterSegments([], 100)).toEqual([]);
    });

    it("ignores a total that is not positive and sizes against the segments instead", () => {
        const segs = [{ key: "a", value: 5, fill: "bg-accent" }];
        expect(meterSegments(segs, 0)).toEqual([{ key: "a", fill: "bg-accent", pct: 100 }]);
        expect(meterSegments(segs, -5)).toEqual([{ key: "a", fill: "bg-accent", pct: 100 }]);
    });

    it("lets segments under-fill the track when they do not sum to the total", () => {
        const out = meterSegments([{ key: "a", value: 20, fill: "bg-accent" }], 100);
        expect(out[0].pct).toBe(20);
    });
});

describe("meterPct", () => {
    it("clamps into 0..100", () => {
        expect(meterPct(50)).toBe(50);
        expect(meterPct(140)).toBe(100);
        expect(meterPct(-3)).toBe(0);
    });

    // A bad computation must never escape as a NaN width (which renders nothing) or overflow the track.
    it("collapses NaN to 0 and saturates Infinity at the full track", () => {
        expect(meterPct(NaN)).toBe(0);
        expect(meterPct(Infinity)).toBe(100);
    });
});
