// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    barPath,
    harnessChartColor,
    harnessChartLabel,
    legendSeries,
    modelKey,
    modelLegend,
    modelRows,
    modelShade,
    yDomainMax,
    type ModelDay,
    type ModelSeries,
} from "./usagedaily";

function series(harness: string, provider: string, model: string, tokens: number, spendUsd = 0): ModelSeries {
    return { key: modelKey(harness, provider, model), harness, provider, model, tokens, spendUsd };
}

function opacity(fill: string): number {
    const m = /(\d+(?:\.\d+)?)%, transparent\)$/.exec(fill);
    return m ? Number(m[1]) : 100;
}

describe("harness chart metadata", () => {
    it("maps known harnesses to their provider tokens and labels, others to muted and the raw id", () => {
        expect(["claude", "codex", "opencode", "pi", "jarvis"].map(harnessChartColor)).toEqual([
            "var(--color-provider-claude)",
            "var(--color-provider-codex)",
            "var(--color-provider-opencode)",
            "var(--color-provider-pi)",
            "var(--color-muted)",
        ]);
        expect(["claude", "codex", "opencode", "pi", "jarvis"].map(harnessChartLabel)).toEqual([
            "Claude",
            "Codex",
            "OpenCode",
            "Pi",
            "jarvis",
        ]);
    });
});

describe("modelShade", () => {
    const color = "var(--color-provider-pi)";

    it("uses the bare color for a lone model", () => {
        expect(modelShade(color, 0, 1)).toBe(color);
    });

    it("steps six models strictly down from 100% to 25%", () => {
        const fills = [0, 1, 2, 3, 4, 5].map((r) => modelShade(color, r, 6));
        expect(fills[0]).toBe(color);
        const pcts = fills.map(opacity);
        expect(pcts[0]).toBe(100);
        expect(pcts[5]).toBe(25);
        for (let i = 1; i < pcts.length; i++) {
            expect(pcts[i]).toBeLessThan(pcts[i - 1]);
            expect(pcts[i]).toBeGreaterThanOrEqual(25);
        }
        for (const f of fills.slice(1)) {
            expect(f).toContain(color);
            expect(f.startsWith("color-mix(in srgb, ")).toBe(true);
        }
    });
});

describe("modelLegend", () => {
    const pi = series("pi", "openai-codex", "gpt-5.5", 300, 3);
    const codex = series("codex", "openai", "gpt-5.5", 100, 1);

    it("keeps the same model id under two harnesses as two rows in two groups", () => {
        const groups = modelLegend([pi, codex], ["claude", "codex", "pi"], "tokens");
        expect(groups.map((g) => g.harness)).toEqual(["codex", "pi"]);
        expect(groups.map((g) => g.models.map((m) => m.model))).toEqual([["gpt-5.5"], ["gpt-5.5"]]);
        expect(groups[0].models[0].key).not.toBe(groups[1].models[0].key);
        expect(groups[1].models[0].title).toBe("openai-codex/gpt-5.5");
        expect(groups[0].label).toBe("Codex");
        expect(groups.map((g) => g.pct)).toEqual([25, 75]);
        expect(groups.every((g) => g.showHead)).toBe(true);
    });

    it("labels a model by provider/model only when its name repeats in the group", () => {
        const groups = modelLegend(
            [
                series("pi", "openai-codex", "gpt-5.5", 300),
                series("pi", "openrouter", "gpt-5.5", 200),
                series("pi", "anthropic", "claude-opus-5-5", 100),
                series("codex", "openai", "gpt-5.5", 100),
            ],
            ["codex", "pi"],
            "tokens"
        );
        expect(groups.map((g) => g.models.map((m) => m.label))).toEqual([
            ["gpt-5.5"],
            ["openai-codex/gpt-5.5", "openrouter/gpt-5.5", "claude-opus-5-5"],
        ]);
    });

    it("orders groups by harnessOrder with unlisted harnesses last, alphabetically", () => {
        const groups = modelLegend(
            [series("zeta", "x", "m", 9), series("alpha", "x", "m", 8), series("claude", "anthropic", "opus", 1), pi],
            ["pi", "claude"],
            "tokens"
        );
        expect(groups.map((g) => g.harness)).toEqual(["pi", "claude", "alpha", "zeta"]);
    });

    it("orders models by tokens for both metrics", () => {
        // the cheaper-per-token model has more tokens but less spend
        const models = [series("claude", "anthropic", "haiku", 900, 1), series("claude", "anthropic", "opus", 100, 50)];
        const byTokens = modelLegend(models, ["claude"], "tokens")[0].models.map((m) => m.model);
        const bySpend = modelLegend(models, ["claude"], "spend")[0].models.map((m) => m.model);
        expect(byTokens).toEqual(["haiku", "opus"]);
        expect(bySpend).toEqual(byTokens);
    });

    it("selects the metric's value and shares it across the whole legend", () => {
        const [codexG, piG] = modelLegend([pi, codex], ["codex", "pi"], "spend");
        expect(codexG.models[0]).toMatchObject({ value: 1, pct: 25, tokens: 100, spendUsd: 1 });
        expect(piG.value).toBe(3);
        expect(piG.pct).toBe(75);
    });

    it("reads 0, never NaN, for the spend metric over unpriced models only", () => {
        const groups = modelLegend(
            [series("pi", "x", "unpriced", 500), series("pi", "x", "other", 100)],
            ["pi"],
            "spend"
        );
        const rows = legendSeries(groups);
        expect(rows.map((m) => [m.value, m.pct])).toEqual([
            [0, 0],
            [0, 0],
        ]);
        expect([groups[0].value, groups[0].pct]).toEqual([0, 0]);
    });

    it("shows group heads only with more than one group", () => {
        expect(modelLegend([pi], ["pi"], "tokens")[0].showHead).toBe(false);
        expect(modelLegend([], ["pi"], "tokens")).toEqual([]);
    });

    it("shades models within a harness by rank", () => {
        const [g] = modelLegend([series("pi", "x", "b", 10), series("pi", "x", "a", 20)], ["pi"], "tokens");
        expect(g.models.map((m) => m.fill)).toEqual([
            "var(--color-provider-pi)",
            "color-mix(in srgb, var(--color-provider-pi) 25%, transparent)",
        ]);
    });
});

describe("legendSeries", () => {
    it("flattens groups in legend order", () => {
        const groups = modelLegend(
            [series("pi", "x", "p2", 5), series("claude", "anthropic", "c1", 9), series("pi", "x", "p1", 7)],
            ["claude", "pi"],
            "tokens"
        );
        expect(legendSeries(groups).map((m) => m.model)).toEqual(["c1", "p1", "p2"]);
    });
});

describe("modelRows", () => {
    const a = modelKey("claude", "anthropic", "opus");
    const b = modelKey("pi", "x", "m");
    const daily: ModelDay[] = [
        {
            day: "2026-08-10",
            byModel: {
                [a]: { tokens: 10, spendUsd: 1, pricedTokens: 10 },
                [b]: { tokens: 20, spendUsd: 2, pricedTokens: 20 },
            },
        },
        { day: "2026-08-11", byModel: {} },
    ];

    it("keys rows by model with MM-DD days and totals the given keys", () => {
        expect(modelRows(daily, [a, b], "tokens")).toEqual([
            { day: "08-10", values: { [a]: 10, [b]: 20 }, total: 30 },
            { day: "08-11", values: { [a]: 0, [b]: 0 }, total: 0 },
        ]);
    });

    it("selects the spend metric and totals only the given keys", () => {
        expect(modelRows(daily, [b], "spend")[0]).toEqual({ day: "08-10", values: { [b]: 2 }, total: 2 });
    });

    it("zero-fills a key with no entry", () => {
        const c = modelKey("codex", "openai", "gpt-5.5");
        expect(modelRows(daily, [a, c], "tokens")[0]).toEqual({ day: "08-10", values: { [a]: 10, [c]: 0 }, total: 10 });
    });
});

describe("yDomainMax", () => {
    it("lets the tallest cent-sized Spend day fill the plot", () => {
        expect(yDomainMax("spend", [0.03, 0.05])).toBe(0.05);
    });

    it("floors all-zero Spend at one cent", () => {
        expect(yDomainMax("spend", [0, 0])).toBe(0.01);
        expect(yDomainMax("spend", [])).toBe(0.01);
    });

    it("floors all-zero Tokens at 1", () => {
        expect(yDomainMax("tokens", [0, 0])).toBe(1);
    });

    it("tops Tokens at the tallest day", () => {
        expect(yDomainMax("tokens", [500, 78000])).toBe(78000);
    });
});

describe("barPath", () => {
    // motion tweens a path's d only between strings with the same commands and number count
    const shape = (d: string) => d.replace(/-?[\d.]+/g, "#");

    it("draws every segment with the same commands, whatever its radius or height", () => {
        const capped = shape(barPath(10, 20, 30, 100, 4));
        expect(shape(barPath(10, 20, 30, 100, 0))).toBe(capped);
        expect(shape(barPath(10, 120, 30, 0, 4))).toBe(capped);
        expect(shape(barPath(10, 20, 30, 2, 4))).toBe(capped);
    });

    it("rounds only the top corners, by at most half the width or the full height", () => {
        expect(barPath(10, 20, 30, 100, 4)).toBe("M10,120V24Q10,20 14,20H36Q40,20 40,24V120Z");
        expect(barPath(10, 20, 30, 2, 4)).toBe("M10,22V22Q10,20 12,20H38Q40,20 40,22V22Z");
    });

    it("draws a square bar at radius 0", () => {
        expect(barPath(10, 20, 30, 100, 0)).toBe("M10,120V20Q10,20 10,20H40Q40,20 40,20V120Z");
    });

    it("never writes a coordinate in exponent notation", () => {
        expect(barPath(1e-9, 1e-7, 30, 100, 0)).not.toMatch(/e/);
    });
});
