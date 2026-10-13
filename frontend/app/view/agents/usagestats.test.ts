import { describe, expect, it } from "vitest";
import {
    aggregateBuckets,
    bucketSpend,
    bucketTokens,
    foldModels,
    modelGridClass,
    pctStr,
    type ModelUsage,
} from "./usagestats";

describe("modelGridClass", () => {
    it("fills the full width when there is a single provider (or none)", () => {
        expect(modelGridClass(1)).toBe("grid grid-cols-1 gap-[14px]");
        expect(modelGridClass(0)).toBe("grid grid-cols-1 gap-[14px]");
    });
    it("splits into two columns on lg for multiple providers", () => {
        expect(modelGridClass(2)).toBe("grid grid-cols-1 gap-[14px] lg:grid-cols-2");
    });
});

describe("bucket helpers", () => {
    it("counts every token class and prices a bucket the way the aggregate does", () => {
        const b = bkt({ input: 1_000_000, output: 1_000_000, reasoning: 10, cacheread: 20, cachecreate: 30 });
        expect(bucketTokens(b)).toBe(2_000_060);
        expect(bucketSpend(b)).toBeCloseTo(
            aggregateBuckets([b], Date.parse("2026-06-26T12:00:00.000Z")).totals.spendWindowUsd,
            9
        );
        expect(bucketSpend(bkt({ model: "no-such-model", input: 500 }))).toBe(0);
    });

    it("formats a share as the cards and legends print it", () => {
        expect([pctStr(0), pctStr(0.04), pctStr(1), pctStr(4.26), pctStr(41.6)]).toEqual([
            "0%",
            "<0.1%",
            "1%",
            "4.3%",
            "42%",
        ]);
    });
});

function bkt(over: Partial<UsageBucket>): UsageBucket {
    return {
        harness: "claude",
        provider: "anthropic",
        model: "claude-opus-4-8",
        day: "2026-06-26",
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

describe("aggregateBuckets", () => {
    const now = Date.parse("2026-06-26T12:00:00.000Z");
    const today = "2026-06-26";

    it("splits today vs rolling week (totals stay date-filtered even with older buckets)", () => {
        const stats = aggregateBuckets(
            [
                bkt({ day: today, input: 100 }),
                bkt({ day: "2026-06-22", input: 50 }), // within rolling 7
                bkt({ day: "2026-06-01", input: 999 }), // older — excluded from totals
            ],
            now
        );
        expect(stats.totals.tokensToday).toBe(100);
        expect(stats.totals.tokensWeek).toBe(150);
    });

    it("computes whole-window totals and active days across all loaded buckets", () => {
        const stats = aggregateBuckets(
            [
                bkt({ day: today, input: 100 }),
                bkt({ day: "2026-05-01", input: 300 }), // older than a week
                bkt({ harness: "codex", provider: "openai", model: "gpt-5.5", day: "2026-05-01", input: 50 }),
            ],
            now
        );
        expect(stats.totals.tokensWindow).toBe(450); // includes >7d buckets, unlike tokensWeek
        expect(stats.totals.tokensWindowByHarness.claude).toBe(400);
        expect(stats.totals.tokensWindowByHarness.codex).toBe(50);
        expect(stats.totals.activeDays).toBe(2);
        expect(stats.totals.spendWindowUsd).toBeGreaterThan(0);
    });

    it("leaves a model, and a provider, with no tokens out of the by-model breakdown", () => {
        const stats = aggregateBuckets(
            [
                bkt({ day: today, input: 100 }),
                bkt({ harness: "pi", provider: "openrouter", model: "deepseek-v4.1-flash", day: today }),
                bkt({ model: "claude-sonnet-4-6", day: today }),
            ],
            now
        );
        expect(stats.providers.map((p) => p.provider)).toEqual(["anthropic"]);
        expect(stats.providers[0].models.map((m) => m.model)).toEqual(["claude-opus-4-8"]);
    });

    it("by-model pct is over the whole loaded window (includes >7d buckets), desc by tokens", () => {
        const stats = aggregateBuckets(
            [
                bkt({ model: "claude-opus-4-8", day: "2026-05-01", input: 75 }), // older than a week
                bkt({ model: "claude-sonnet-4-6", day: today, input: 25 }),
            ],
            now
        );
        const p = stats.providers[0];
        expect(p.tokens).toBe(100);
        expect(p.models[0].model).toBe("claude-opus-4-8");
        expect(p.models[0].pct).toBeCloseTo(75, 5);
        expect(p.models[1].pct).toBeCloseTo(25, 5);
    });

    it("builds an all-provider token-class split in fixed order with priced spend", () => {
        const stats = aggregateBuckets(
            [bkt({ model: "claude-opus-4-8", input: 1e6, output: 1e6, cacheread: 1e6, cachecreate: 1e6 })],
            now
        );
        expect(stats.split.map((s) => s.cls)).toEqual(["cacheRead", "reasoning", "output", "cacheWrite", "input"]);
        const byCls = Object.fromEntries(stats.split.map((s) => [s.cls, s]));
        expect(byCls.cacheRead.tokens).toBe(1e6);
        expect(byCls.output.spendUsd).toBeCloseTo(25, 5);
        expect(byCls.input.spendUsd).toBeCloseTo(5, 5);
        expect(byCls.reasoning.tokens).toBe(0);
    });

    it("daily zero-fills idle days in range and keys by harness", () => {
        const stats = aggregateBuckets(
            [
                bkt({ day: "2026-06-24", input: 10 }),
                bkt({ harness: "codex", provider: "openai", model: "gpt-5.5", day: "2026-06-26", input: 20 }),
            ],
            now
        );
        // range 06-24..06-26 inclusive -> 3 days, the middle one idle
        expect(stats.daily.map((d) => d.day)).toEqual(["2026-06-24", "2026-06-25", "2026-06-26"]);
        expect(stats.daily[0].byHarness.claude.tokens).toBe(10);
        expect(stats.daily[1].byHarness).toEqual({}); // idle day
        expect(stats.daily[2].byHarness.codex.tokens).toBe(20);
    });

    // The 30-day cap used to truncate the all-time series silently; the brush replaces it, so the
    // aggregation must now return every day in range.
    it("returns every day in range without a 30-day cap", () => {
        const day = (n: number) => {
            const d = new Date(2026, 0, 1);
            d.setDate(d.getDate() + n);
            const m = String(d.getMonth() + 1).padStart(2, "0");
            return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
        };
        const buckets = [0, 44].map((n) => bkt({ day: day(n), input: 10, output: 5 }));
        const stats = aggregateBuckets(buckets, new Date(2026, 1, 14).getTime());
        expect(stats.daily.length).toBe(45);
        expect(stats.daily[0].day).toBe(day(0));
        expect(stats.daily[44].day).toBe(day(44));
        expect("dailyTruncated" in stats).toBe(false);
    });

    it("returns empty shapes for no buckets", () => {
        expect(aggregateBuckets([], now)).toEqual({
            availableHarnesses: [],
            totals: {
                tokensToday: 0,
                tokensWeek: 0,
                spendTodayUsd: 0,
                spendWeekUsd: 0,
                tokensWindow: 0,
                spendWindowUsd: 0,
                activeDays: 0,
                reportedCostWeekUsd: 0,
                reportedCostWeekPresent: false,
                reportedCostWeekHarnesses: [],
                reportedCostWindowUsd: 0,
                reportedCostWindowPresent: false,
                reportedCostWindowHarnesses: [],
                pricedTokensWeek: 0,
                pricedTokensWindow: 0,
                pricingCoverageWeekPct: null,
                pricingCoverageWindowPct: null,
                tokensTodayByHarness: {},
                tokensWindowByHarness: {},
            },
            split: [
                { cls: "cacheRead", label: "Cache read", tokens: 0, spendUsd: 0 },
                { cls: "reasoning", label: "Reasoning", tokens: 0, spendUsd: 0 },
                { cls: "output", label: "Output", tokens: 0, spendUsd: 0 },
                { cls: "cacheWrite", label: "Cache write", tokens: 0, spendUsd: 0 },
                { cls: "input", label: "Input", tokens: 0, spendUsd: 0 },
            ],
            daily: [],
            providers: [],
        });
    });

    it("derives harnesses, reported cost, coverage, and upstream providers", () => {
        const buckets = [
            bkt({ harness: "claude", provider: "anthropic", input: 100 }),
            bkt({
                harness: "opencode",
                provider: "openai",
                model: "gpt-5.5",
                input: 200,
                reasoning: 50,
                reportedcostusd: 0,
            }),
            bkt({
                harness: "opencode",
                provider: "opencode-go",
                model: "gemini-2.5-pro",
                input: 700,
                reportedcostusd: 1.25,
            }),
        ];

        const all = aggregateBuckets(buckets, now, "all");
        expect(all.availableHarnesses).toEqual(["claude", "opencode"]);
        expect(all.totals.tokensWindow).toBe(1050);
        expect(all.totals.reportedCostWindowUsd).toBe(1.25);
        expect(all.totals.reportedCostWindowPresent).toBe(true);
        expect(all.totals.reportedCostWindowHarnesses).toEqual(["opencode"]);
        expect(all.totals.pricingCoverageWindowPct).toBeCloseTo((350 / 1050) * 100);
        expect(all.providers.map((p) => p.provider)).toEqual(["anthropic", "openai", "opencode-go"]);

        const openCode = aggregateBuckets(buckets, now, "opencode");
        expect(openCode.totals.tokensWindow).toBe(950);
        expect(openCode.split.find((s) => s.cls === "reasoning")?.tokens).toBe(50);
        expect(openCode.daily[0].byHarness.opencode.tokens).toBe(950);
    });

    it("reports no coverage for an empty scope and keeps a reported zero present", () => {
        const empty = aggregateBuckets([], now, "all");
        expect(empty.totals.pricingCoverageWindowPct).toBeNull();
        expect(empty.totals.reportedCostWindowPresent).toBe(false);
        expect(empty.totals.reportedCostWindowUsd).toBe(0);

        const zeroed = aggregateBuckets(
            [bkt({ harness: "opencode", provider: "openai", model: "gpt-5.5", reportedcostusd: 0 })],
            now,
            "all"
        );
        expect(zeroed.totals.reportedCostWindowPresent).toBe(true);
        expect(zeroed.totals.reportedCostWindowUsd).toBe(0);
        expect(zeroed.totals.reportedCostWindowHarnesses).toEqual(["opencode"]);
    });

    it("keeps Pi a separate harness from its provider/model dimensions", () => {
        const buckets = [
            bkt({ harness: "pi", provider: "openai-codex", model: "gpt-5.5", day: today, input: 300, output: 100 }),
            bkt({ harness: "claude", provider: "anthropic", model: "claude-opus-4-8", day: today, input: 200 }),
        ];
        const all = aggregateBuckets(buckets, now, "all");
        expect(all.availableHarnesses).toEqual(["pi", "claude"]);
        expect(all.totals.tokensWindowByHarness.pi).toBe(400);
        expect(all.totals.tokensWindowByHarness.claude).toBe(200);
        // pi's provider/model dimensions aggregate independently of the claude bucket's
        expect(all.providers.map((p) => p.provider)).toEqual(["anthropic", "openai-codex"]);
        const piProvider = all.providers.find((p) => p.provider === "openai-codex");
        expect(piProvider?.models.map((m) => m.model)).toEqual(["gpt-5.5"]);
        // the harness filter isolates pi buckets (chips still come from the unfiltered set)
        const piOnly = aggregateBuckets(buckets, now, "pi");
        expect(piOnly.totals.tokensWindow).toBe(400);
        expect(piOnly.availableHarnesses).toEqual(["pi", "claude"]);
        expect(piOnly.totals.tokensWindowByHarness.claude).toBeUndefined();
    });
});

describe("foldModels", () => {
    const m = (model: string, tokens: number, pct: number): ModelUsage => ({ model, tokens, pct, spendUsd: 0 });

    it("passes through when at or under the cap", () => {
        const out = foldModels([m("a", 3, 60), m("b", 2, 40)], 4);
        expect(out.map((x) => x.model)).toEqual(["a", "b"]);
    });

    // The ordinal ramp has a fixed number of steps; a 5th hue is never generated.
    it("folds the tail into a single Other row", () => {
        const out = foldModels([m("a", 5, 50), m("b", 2, 20), m("c", 1, 10), m("d", 1, 10), m("e", 1, 10)], 4);
        expect(out.map((x) => x.model)).toEqual(["a", "b", "c", "Other"]);
        expect(out[3].tokens).toBe(2);
        expect(out[3].pct).toBe(20);
    });

    it("returns an empty list unchanged", () => {
        expect(foldModels([], 4)).toEqual([]);
    });
});
