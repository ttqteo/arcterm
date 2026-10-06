import { describe, expect, it } from "vitest";
import { aggregateSessionUsage, spendHeadline, type SessionUsage } from "./sessionusage";

function bkt(over: Partial<UsageBucket>): UsageBucket {
    return {
        harness: "claude",
        provider: "anthropic",
        model: "claude-opus-4-8",
        day: "2026-07-14",
        input: 0,
        output: 0,
        reasoning: 0,
        cacheread: 0,
        cachecreate: 0,
        cachecreate1h: 0,
        msgs: 1,
        ...over,
    };
}

describe("aggregateSessionUsage", () => {
    it("returns a zeroed shape with null insight for no buckets", () => {
        const s = aggregateSessionUsage([]);
        expect(s.totalTokens).toBe(0);
        expect(s.totalSpendUsd).toBe(0);
        expect(s.models).toEqual([]);
        expect(s.insight).toBeNull();
        expect(s.classes.map((c) => c.cls)).toEqual(["cacheRead", "reasoning", "output", "cacheWrite", "input"]);
    });

    it("reportedTotalUsd is undefined when no bucket reports cost", () => {
        const s = aggregateSessionUsage([
            bkt({ input: 1_000_000, output: 1_000_000, cacheread: 1_000_000, cachecreate: 1_000_000 }),
        ]);
        expect(s.reportedTotalUsd).toBeUndefined();
        // headline falls back to the estimate
        expect(s.totalSpendUsd).toBeCloseTo(5 + 25 + 0.5 + 6.25, 5);
    });

    it("sums reported cost across buckets (pi/opencode records) and keeps the estimate separate", () => {
        const s = aggregateSessionUsage([
            bkt({ harness: "pi", provider: "anthropic", model: "claude-opus-4-8", input: 1_000_000, output: 1_000_000, reportedcostusd: 8.4 }),
            bkt({ harness: "pi", provider: "anthropic", model: "claude-sonnet-4-5", input: 1_000_000, reportedcostusd: 1.6 }),
        ]);
        expect(s.reportedTotalUsd).toBeCloseTo(10, 5);
        expect(s.totalSpendUsd).toBeGreaterThan(0); // estimate still computed for bars/insight
    });

    it("keeps a reported zero distinct from absent (pi priced the model at 0)", () => {
        const s = aggregateSessionUsage([bkt({ input: 1_000_000, reportedcostusd: 0 })]);
        expect(s.reportedTotalUsd).toBe(0);
    });

    it("folds one model: per-class tokens + opus-priced spend + derived insight", () => {
        // opus prices ($/MTok): input 5, output 25, cacheRead 0.5, cacheWrite5m 6.25
        const s = aggregateSessionUsage([
            bkt({ input: 1_000_000, output: 1_000_000, cacheread: 1_000_000, cachecreate: 1_000_000 }),
        ]);
        expect(s.totalTokens).toBe(4_000_000);
        const output = s.classes.find((c) => c.cls === "output")!;
        expect(output.tokens).toBe(1_000_000);
        expect(output.spendUsd).toBeCloseTo(25, 5);
        expect(s.totalSpendUsd).toBeCloseTo(5 + 25 + 0.5 + 6.25, 5);
        expect(s.models).toHaveLength(1);
        expect(s.models[0].model).toBe("claude-opus-4-8");
        expect(s.insight).not.toBeNull();
        expect(s.insight!.topCostClass).toBe("output"); // largest spend share
        expect(s.insight!.readTokPct).toBeCloseTo(25, 5); // 1M / 4M
    });

    it("sorts models by tokens desc and keeps per-model class splits", () => {
        const s = aggregateSessionUsage([
            bkt({ model: "claude-haiku-4-5", input: 1_000_000 }),
            bkt({ model: "claude-opus-4-8", input: 2_000_000, output: 2_000_000 }),
        ]);
        expect(s.models.map((m) => m.model)).toEqual(["claude-opus-4-8", "claude-haiku-4-5"]);
        expect(s.models[0].classes.output).toBe(2_000_000);
        expect(s.models[1].classes.input).toBe(1_000_000);
    });

    it("handles a codex session with no cache-write class", () => {
        const s = aggregateSessionUsage([
            bkt({ harness: "codex", provider: "openai", model: "gpt-5-codex", input: 1_000_000, output: 100_000, cacheread: 500_000 }),
        ]);
        const write = s.classes.find((c) => c.cls === "cacheWrite")!;
        expect(write.tokens).toBe(0);
        expect(write.spendUsd).toBe(0);
        expect(s.totalTokens).toBe(1_600_000);
    });
});

describe("spendHeadline", () => {
    const usage = (over: Partial<SessionUsage>): SessionUsage => ({
        totalTokens: 1000,
        totalSpendUsd: 21.04,
        classes: [],
        models: [],
        insight: null,
        ...over,
    });

    it("marks the bundled-table estimate as approximate, API-equivalent", () => {
        expect(spendHeadline(usage({}))).toEqual({ text: "≈ $21.04", caption: "API-equivalent" });
    });

    it("shows a reported cost as is", () => {
        expect(spendHeadline(usage({ reportedTotalUsd: 3.5 }))).toEqual({ text: "$3.50", caption: "reported" });
    });
});
