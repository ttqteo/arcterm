import { describe, expect, it } from "vitest";
import { kpiGridClass, soloHarness, statGridClass, visibleClasses } from "./usagelayout";
import type { UsageRailRow } from "./usagerail";
import type { ClassUsage } from "./usagestats";

const row = (harness: string): UsageRailRow => ({
    harness,
    tokens: 1,
    spendUsd: 0,
    fivehour: {},
    week: {},
    state: "none",
});

describe("soloHarness", () => {
    it("names the harness when it is the only one", () => {
        expect(soloHarness([row("claude")])).toBe("claude");
    });
    it("is null with none or with several to choose from", () => {
        expect(soloHarness([])).toBeNull();
        expect(soloHarness([row("claude"), row("codex")])).toBeNull();
    });
});

describe("visibleClasses", () => {
    const cls = (label: string, tokens: number, spendUsd: number): ClassUsage => ({
        cls: "input",
        label,
        tokens,
        spendUsd,
    });
    it("drops a class with neither tokens nor spend, keeping the order", () => {
        const split = [cls("Cache read", 10, 1), cls("Reasoning", 0, 0), cls("Output", 5, 0), cls("Input", 0, 0.1)];
        expect(visibleClasses(split).map((c) => c.label)).toEqual(["Cache read", "Output", "Input"]);
    });
});

describe("grid classes", () => {
    it("fits the stat tiles to the cards shown", () => {
        expect(statGridClass(4)).toBe("grid-cols-2 @2xl:grid-cols-4");
        expect(statGridClass(3)).toBe("grid-cols-3");
        expect(statGridClass(2)).toBe("grid-cols-2");
    });
    it("splits the kpi row in proportion to its tiles: two limits beside the stats", () => {
        expect(kpiGridClass(4)).toBe("grid-cols-1 @6xl:grid-cols-[minmax(0,2fr)_minmax(0,4fr)]");
        expect(kpiGridClass(3)).toBe("grid-cols-1 @6xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");
        expect(kpiGridClass(2)).toBe("grid-cols-1 @6xl:grid-cols-2");
    });
});
