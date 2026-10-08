import { describe, expect, it } from "vitest";
import { INSIGHTS_HELD_PCT, INSIGHTS_STALE_MS, insightsCard, insightsHeld, splitInsights } from "./usageinsights";

const HOUR = 3600_000;
const NOW = 1_800_000_000_000;

const saved = (over: Partial<UsageInsights> = {}): UsageInsights => ({
    markdown: "## Where it goes\nCache reads.",
    analyzedts: NOW - HOUR,
    windowdays: 7,
    model: "sonnet",
    ...over,
});

const card = (over: Partial<Parameters<typeof insightsCard>[0]> = {}) =>
    insightsCard({ sessionCount: 12, running: false, windowDays: 7, now: NOW, ...over });

describe("insightsCard precedence", () => {
    it("is no-sessions when the window has no Claude sessions, whatever else is true", () => {
        expect(card({ sessionCount: 0 })).toEqual({ kind: "no-sessions" });
        expect(card({ sessionCount: 0, running: true })).toEqual({ kind: "no-sessions" });
        expect(card({ sessionCount: 0, error: "boom" })).toEqual({ kind: "no-sessions" });
        expect(card({ sessionCount: 0, saved: saved() })).toEqual({ kind: "no-sessions" });
    });

    it("is running while an analysis runs, ahead of an error and a saved result", () => {
        expect(card({ running: true })).toEqual({ kind: "running" });
        expect(card({ running: true, error: "boom" })).toEqual({ kind: "running" });
        expect(card({ running: true, saved: saved() })).toEqual({ kind: "running" });
        expect(card({ running: true, error: "boom", saved: saved() })).toEqual({ kind: "running" });
    });

    it("is error after a failure, ahead of a saved result, and keeps that result as prev", () => {
        const prev = saved();
        expect(card({ error: "boom", saved: prev })).toEqual({ kind: "error", message: "boom", prev });
    });

    it("is error with no prev when there was no result to keep", () => {
        expect(card({ error: "boom" })).toEqual({ kind: "error", message: "boom", prev: undefined });
        expect(card({ error: "boom", saved: saved({ markdown: "" }) })).toEqual({
            kind: "error",
            message: "boom",
            prev: undefined,
        });
    });

    it("is done with a saved result", () => {
        const ins = saved();
        expect(card({ saved: ins })).toEqual({ kind: "done", ins, stale: false });
    });

    it("is never when nothing is saved or the saved markdown is empty", () => {
        expect(card()).toEqual({ kind: "never" });
        expect(card({ saved: saved({ markdown: "", analyzedts: 0 }) })).toEqual({ kind: "never" });
        expect(card({ saved: saved({ markdown: "" }) })).toEqual({ kind: "never" });
    });
});

describe("insightsCard stale", () => {
    const stale = (over: Partial<UsageInsights>, windowDays = 7) => {
        const c = card({ saved: saved(over), windowDays });
        if (c.kind !== "done") throw new Error(`expected done, got ${c.kind}`);
        return c.stale;
    };

    it("is false within 24 hours and true past them", () => {
        expect(INSIGHTS_STALE_MS).toBe(24 * HOUR);
        expect(stale({ analyzedts: NOW - 23 * HOUR })).toBe(false);
        expect(stale({ analyzedts: NOW - 24 * HOUR })).toBe(false);
        expect(stale({ analyzedts: NOW - 25 * HOUR })).toBe(true);
    });

    it("is true when the result's window differs from the one the surface shows", () => {
        expect(stale({ analyzedts: NOW - 60_000, windowdays: 0 }, 7)).toBe(true);
        expect(stale({ analyzedts: NOW - 60_000, windowdays: 7 }, 0)).toBe(true);
    });

    it("is false for a fresh result on the same all-time window", () => {
        expect(stale({ analyzedts: NOW - 60_000, windowdays: 0 }, 0)).toBe(false);
    });
});

describe("insightsHeld", () => {
    const resetIn = (mins: number) => NOW / 1000 + mins * 60; // epoch seconds, as the donut windows carry them

    it("holds at 95% and names the percentage and when it resets", () => {
        expect(INSIGHTS_HELD_PCT).toBe(95);
        const tip = insightsHeld([{ pct: 95, reset: resetIn(44) }], NOW);
        expect(tip).toContain("95%");
        expect(tip).toContain("44m");
        expect(tip).toMatch(/^Claude quota is at /);
    });

    it("names a weekly reset in days", () => {
        const tip = insightsHeld([{ pct: 96, reset: resetIn(3 * 24 * 60 + 13 * 60) }], NOW);
        expect(tip).toContain("96%");
        expect(tip).toContain("3d 13h");
    });

    it("rounds the percentage it names", () => {
        expect(insightsHeld([{ pct: 96.4, reset: resetIn(10) }], NOW)).toContain("96%");
    });

    it("does not hold below 95% or without a reading", () => {
        expect(insightsHeld([{ pct: 94, reset: resetIn(44) }], NOW)).toBeNull();
        expect(insightsHeld([{ pct: 94.9 }], NOW)).toBeNull();
        expect(insightsHeld([{ reset: resetIn(44) }], NOW)).toBeNull();
        expect(insightsHeld([{}, {}], NOW)).toBeNull();
        expect(insightsHeld([], NOW)).toBeNull();
    });

    it("holds when either window is at 95%", () => {
        expect(
            insightsHeld(
                [
                    { pct: 95, reset: resetIn(5) },
                    { pct: 20, reset: resetIn(9000) },
                ],
                NOW
            )
        ).not.toBeNull();
        expect(
            insightsHeld(
                [
                    { pct: 20, reset: resetIn(5) },
                    { pct: 95, reset: resetIn(9000) },
                ],
                NOW
            )
        ).not.toBeNull();
    });

    it("names the window that clears last when both are held", () => {
        const tip = insightsHeld(
            [
                { pct: 97, reset: resetIn(40) },
                { pct: 95, reset: resetIn(3 * 24 * 60) },
            ],
            NOW
        );
        expect(tip).toContain("95%");
        expect(tip).toContain("3d");
        expect(tip).not.toContain("97%");
    });

    it("still holds when the held window has no reset time", () => {
        expect(insightsHeld([{ pct: 98 }], NOW)).toBe("Claude quota is at 98%");
    });

    it("says it resets now once the reset time has passed", () => {
        expect(insightsHeld([{ pct: 98, reset: resetIn(-5) }], NOW)).toBe("Claude quota is at 98%, resets now");
    });
});

describe("splitInsights", () => {
    const four = "## Where it goes\nA\n\n## Which tabs\nB\n\n## Habits\nC\n\n## What to change\n1. D\n2. E";

    it("sends the last section to the side tile", () => {
        const { main, side } = splitInsights(four);
        expect(main).toBe("## Where it goes\nA\n\n## Which tabs\nB\n\n## Habits\nC");
        expect(side).toBe("## What to change\n1. D\n2. E");
    });

    it("splits two sections too", () => {
        const { main, side } = splitInsights("## One\nA\n\n## Two\nB");
        expect(main).toBe("## One\nA");
        expect(side).toBe("## Two\nB");
    });

    it("keeps everything in main with one section", () => {
        const md = "## Only\nA\n\nB";
        expect(splitInsights(md)).toEqual({ main: md });
    });

    it("keeps everything in main when there is no section heading", () => {
        const md = "Just a paragraph.\n\n### A smaller heading\nmore";
        expect(splitInsights(md)).toEqual({ main: md });
        expect(splitInsights("")).toEqual({ main: "" });
    });

    it("keeps text before the first section with the main part", () => {
        const { main, side } = splitInsights("Intro line.\n\n## One\nA\n\n## Two\nB");
        expect(main).toBe("Intro line.\n\n## One\nA");
        expect(side).toBe("## Two\nB");
    });

    it("does not split on a ## line inside a code fence", () => {
        const md = "## One\n```\n## not a heading\n```\n\n## Two\nB";
        const { main, side } = splitInsights(md);
        expect(main).toBe("## One\n```\n## not a heading\n```");
        expect(side).toBe("## Two\nB");
    });

    it("does not treat a ### heading as a section", () => {
        const { main, side } = splitInsights("## One\nA\n### sub\nx\n\n## Two\nB");
        expect(main).toBe("## One\nA\n### sub\nx");
        expect(side).toBe("## Two\nB");
    });
});
