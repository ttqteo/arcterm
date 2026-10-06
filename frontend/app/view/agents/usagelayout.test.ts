import { describe, expect, it } from "vitest";
import { legendGridClass, soloHarness, statGridClass, visibleClasses } from "./usagelayout";
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
    it("fits the legend to the classes shown", () => {
        expect(legendGridClass(4)).toBe("grid-cols-2 xl:grid-cols-4");
        expect(legendGridClass(5)).toBe("grid-cols-2 lg:grid-cols-3 xl:grid-cols-5");
    });
    it("fits the stat row to the cards shown", () => {
        expect(statGridClass(4)).toBe("grid-cols-2 xl:grid-cols-4");
        expect(statGridClass(3)).toBe("grid-cols-1 sm:grid-cols-3");
    });
});
