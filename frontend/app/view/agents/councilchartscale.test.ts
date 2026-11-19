// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { LOG_TOKEN_TICKS, compactNumber, linearScale, linearTicks, logScale, tokenTick } from "./councilchartscale";

describe("linearScale", () => {
    it("maps the domain's ends to the range's ends", () => {
        const x = linearScale([0, 100], [10, 330]);
        expect(x(0)).toBe(10);
        expect(x(100)).toBe(330);
        expect(x(50)).toBe(170);
    });
    it("runs backwards for a y axis given bottom-first", () => {
        const y = linearScale([0, 1], [240, 0]);
        expect(y(0)).toBe(240);
        expect(y(1)).toBe(0);
        expect(y(0.25)).toBe(180);
    });
    it("puts everything on the start of a zero-width domain", () => {
        expect(linearScale([5, 5], [0, 100])(5)).toBe(0);
    });
});

describe("logScale", () => {
    it("puts a decade a fixed distance apart", () => {
        const x = logScale([100_000, 100_000_000], [0, 300]);
        expect(x(100_000)).toBeCloseTo(0, 9);
        expect(x(1_000_000)).toBeCloseTo(100, 9);
        expect(x(10_000_000)).toBeCloseTo(200, 9);
        expect(x(100_000_000)).toBeCloseTo(300, 9);
    });
    it("places 3M between 1M and 10M, nearer 1M's side of the log gap", () => {
        const x = logScale([100_000, 100_000_000], [0, 300]);
        expect(x(3_000_000)).toBeGreaterThan(x(1_000_000));
        expect(x(3_000_000)).toBeLessThan(x(10_000_000));
        expect(x(3_000_000)).toBeCloseTo(100 + 100 * Math.log10(3), 9);
    });
    it("sends a value at or under zero to the start", () => {
        const x = logScale([1, 100], [20, 220]);
        expect(x(0)).toBe(20);
        expect(x(-5)).toBe(20);
        expect(x(Number.NaN)).toBe(20);
    });
});

describe("linearTicks", () => {
    it("steps a minutes axis on round numbers inside the interval", () => {
        expect(linearTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
        expect(linearTicks(0, 8.3, 4)).toEqual([0, 5]);
        expect(linearTicks(0, 8, 4)).toEqual([0, 2, 4, 6, 8]);
    });
    it("steps a share axis by 0.2 without float noise", () => {
        expect(linearTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    });
    it("starts on the first multiple of the step at or over the low end", () => {
        expect(linearTicks(3, 21, 6)).toEqual([5, 10, 15, 20]);
    });
    it("gives none for an empty or backwards interval", () => {
        expect(linearTicks(4, 4)).toEqual([]);
        expect(linearTicks(5, 1)).toEqual([]);
    });
});

describe("tokenTick", () => {
    it("writes the token ticks the way the plan names them", () => {
        expect(LOG_TOKEN_TICKS.map(tokenTick)).toEqual(["0.3M", "1M", "3M", "10M", "30M"]);
    });
    it("falls back to the short number under 100k", () => {
        expect(tokenTick(40_000)).toBe("40k");
    });
});

describe("compactNumber", () => {
    it("writes millions, thousands and small counts", () => {
        expect(compactNumber(30_000_000)).toBe("30M");
        expect(compactNumber(300_000)).toBe("300k");
        expect(compactNumber(2500)).toBe("2.5k");
        expect(compactNumber(40)).toBe("40");
        expect(compactNumber(0.5)).toBe("0.5");
    });
});
