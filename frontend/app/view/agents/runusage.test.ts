// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { estimateText, modelsText, spendText, summarizeUsage, tokensText, usageText } from "./runusage";
import { priceFor } from "./usagepricing";

function row(over: Partial<UsageRow>): UsageRow {
    return { role: "worker", input: 0, output: 0, cacheread: 0, cachewrite: 0, cachewrite1h: 0, msgs: 1, ...over };
}

const ROWS: UsageRow[] = [
    row({
        role: "lead",
        model: "claude-opus-5-5",
        input: 100_000,
        output: 50_000,
        cacheread: 800_000,
        cachewrite: 50_000,
    }),
    row({ taskid: "t-1", model: "claude-sonnet-5-5", input: 200_000, cacheread: 300_000 }),
    row({ role: "reviewer", taskid: "t-1", model: "claude-opus-5-5", output: 100_000, cachewrite1h: 400_000 }),
    row({ taskid: "t-2", missing: true }),
];

describe("summarizeUsage", () => {
    it("counts every token class once and splits by model, largest first", () => {
        const s = summarizeUsage(ROWS)!;
        expect(s.total).toBe(2_000_000);
        expect(s.cachedPct).toBe(55);
        expect(s.byModel).toEqual([
            { model: "opus-5-5", tokens: 1_500_000 },
            { model: "sonnet-5-5", tokens: 500_000 },
        ]);
        expect(s.missing).toBe(1);
    });

    it("totals one task's worker and reviewer", () => {
        const s = summarizeUsage(ROWS, "t-1")!;
        expect(s.total).toBe(1_000_000);
        expect(s.byModel.map((m) => m.model)).toEqual(["sonnet-5-5", "opus-5-5"]);
    });

    it("is null when nothing was spent", () => {
        expect(summarizeUsage(undefined)).toBeNull();
        expect(summarizeUsage(ROWS, "t-2")).toBeNull();
        expect(summarizeUsage(ROWS, "t-9")).toBeNull();
    });
});

describe("summarizeUsage: the api-equivalent estimate", () => {
    const M = 1_000_000;
    const opus = priceFor("claude-opus-5-5")!;
    const sonnet = priceFor("claude-sonnet-5-5")!;

    it("prices each token class at the pricing table's rate, a 1-hour cache write at its own", () => {
        const s = summarizeUsage([
            row({
                model: "claude-opus-5-5",
                input: 100_000,
                output: 50_000,
                cacheread: 800_000,
                cachewrite: 50_000,
                cachewrite1h: 400_000,
            }),
        ])!;
        const want =
            (100_000 * opus.input +
                50_000 * opus.output +
                800_000 * opus.cacheRead +
                50_000 * opus.cacheWrite5m +
                400_000 * opus.cacheWrite1h) /
            M;
        expect(s.estimateUsd).toBeCloseTo(want, 10);
        expect(opus.cacheWrite1h).not.toBe(opus.cacheWrite5m);
    });

    it("sums rows on two models", () => {
        const s = summarizeUsage([
            row({ model: "claude-opus-5-5", output: 100_000 }),
            row({ model: "claude-sonnet-5-5", input: 200_000 }),
        ])!;
        expect(s.estimateUsd).toBeCloseTo((100_000 * opus.output + 200_000 * sonnet.input) / M, 10);
    });

    it("adds nothing for an unpriced model or a missing row", () => {
        const priced = row({ model: "claude-opus-5-5", output: 100_000 });
        const s = summarizeUsage([
            priced,
            row({ model: "mystery-1", input: 900_000 }),
            row({ output: 900_000 }),
            row({ model: "claude-opus-5-5", output: 900_000, missing: true }),
        ])!;
        expect(s.estimateUsd).toBeCloseTo(summarizeUsage([priced])!.estimateUsd!, 10);
    });

    it("is undefined, not zero, when no row is priced", () => {
        const s = summarizeUsage([
            row({ model: "mystery-1", input: 900_000 }),
            row({ model: "claude-opus-5-5", output: 900_000, missing: true }),
        ])!;
        expect(s.total).toBe(900_000);
        expect("estimateUsd" in s).toBe(false);
    });

    it("estimates only one task's rows when scoped to it", () => {
        const want =
            (200_000 * sonnet.input +
                300_000 * sonnet.cacheRead +
                100_000 * opus.output +
                400_000 * opus.cacheWrite1h) /
            M;
        expect(summarizeUsage(ROWS, "t-1")!.estimateUsd).toBeCloseTo(want, 10);
        expect(summarizeUsage(ROWS)!.estimateUsd).toBeGreaterThan(want);
    });
});

describe("usageText", () => {
    const UNPRICED = ROWS.map((r) => ({ ...r, model: "mystery-1" }));
    // 1,455,500 output tokens on opus-5-5 at $20 per million
    const PRICED = [row({ model: "claude-opus-5-5", output: 1_455_500 }), row({ taskid: "t-2", missing: true })];

    it("names unreadable sessions only once the total is sealed", () => {
        const s = summarizeUsage(UNPRICED)!;
        expect(usageText(s, false)).toBe("2.0M tok · 55% cached");
        expect(usageText(s, true)).toBe("2.0M tok · 55% cached · 1 unreadable");
    });

    it("ends with the estimate when a model is priced", () => {
        const s = summarizeUsage(PRICED)!;
        expect(usageText(s, false)).toBe("1.5M tok · 0% cached · ≈ $29.11");
        expect(usageText(s, true)).toBe("1.5M tok · 0% cached · 1 unreadable · ≈ $29.11");
    });

    it("keeps the estimate out of the rail's token row and gives it a row of its own", () => {
        const s = summarizeUsage(PRICED)!;
        expect(tokensText(s, true)).toBe("1.5M tok · 0% cached · 1 unreadable");
        expect(estimateText(s)).toBe("≈ $29.11");
        expect(estimateText(summarizeUsage(UNPRICED)!)).toBeNull();
    });

    it("drops the cached share on a meta line", () => {
        expect(spendText(summarizeUsage(PRICED)!)).toBe("1.5M tok · ≈ $29.11");
        expect(spendText(summarizeUsage(UNPRICED)!)).toBe("2.0M tok");
    });

    it("lists the models with their tokens", () => {
        expect(modelsText(summarizeUsage(ROWS)!)).toBe("opus-5-5 1.5M · sonnet-5-5 500k");
    });
});
