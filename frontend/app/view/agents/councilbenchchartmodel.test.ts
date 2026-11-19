// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    benchRowCells,
    benchRowLines,
    benchTables,
    formatTokens,
    labelWidth,
    percent,
    placeLabels,
    recallDomain,
    steppedPath,
} from "./councilbenchchartmodel";

function row(over: Partial<CouncilBenchRow> = {}): CouncilBenchRow {
    return {
        harness: "2026-11-12.1",
        mode: "review",
        variant: "council",
        runs: 5,
        scored: 5,
        recall: 7,
        keys: 33,
        wrong: 4,
        tokens: 7_500_000,
        recallperm: 0.9333,
        recall3: 0,
        judged: 30,
        recall5: 5,
        allscored: 5,
        ...over,
    };
}

describe("recallDomain", () => {
    it("runs from 0 to the next 25% step above the highest recall, ticking every 25%", () => {
        expect(recallDomain([0.31, 0.12])).toEqual({ top: 0.5, ticks: [0, 0.25, 0.5] });
        expect(recallDomain([0.4])).toEqual({ top: 0.5, ticks: [0, 0.25, 0.5] });
        expect(recallDomain([0.6])).toEqual({ top: 0.75, ticks: [0, 0.25, 0.5, 0.75] });
    });
    it("steps above a recall that sits on a step, and stops at 100%", () => {
        expect(recallDomain([0.5]).top).toBe(0.75);
        expect(recallDomain([0.9]).top).toBe(1);
        expect(recallDomain([1]).top).toBe(1);
        expect(recallDomain([1]).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
    });
    it("spans the first step for a chart with no point or only zeros", () => {
        expect(recallDomain([])).toEqual({ top: 0.25, ticks: [0, 0.25] });
        expect(recallDomain([0, 0])).toEqual({ top: 0.25, ticks: [0, 0.25] });
    });
});

describe("percent", () => {
    it("writes a share as a whole percent", () => {
        expect(percent(0)).toBe("0%");
        expect(percent(0.25)).toBe("25%");
        expect(percent(0.3131)).toBe("31%");
        expect(percent(1)).toBe("100%");
    });
});

describe("formatTokens", () => {
    it("writes tokens the way council.FormatTokens does", () => {
        expect(formatTokens(950)).toBe("950");
        expect(formatTokens(38_400)).toBe("38k");
        expect(formatTokens(99_400)).toBe("99k");
        expect(formatTokens(300_000)).toBe("0.3M"); // from 100k up it reads in tenths of a million
        expect(formatTokens(1_500_000)).toBe("1.5M");
        expect(formatTokens(2_000_000)).toBe("2M");
        expect(formatTokens(5_730_000)).toBe("5.7M");
        expect(formatTokens(0)).toBe("0");
    });
});

describe("benchRowCells", () => {
    it("prints a Review row with recall@5 beside recall@all, and wrong against the items judged", () => {
        expect(benchRowCells(row(), "review")).toEqual([
            "2026-11-12.1",
            "council",
            "5/5",
            "5/33",
            "7/33",
            "4/30",
            "7.5M",
            "0.9",
        ]);
    });
    it("prints a dash for recall@all, and wrong alone, when a scored run was not judged whole", () => {
        const cells = benchRowCells(row({ allscored: 3 }), "review");
        expect(cells[4]).toBe("-");
        expect(cells[5]).toBe("4");
        expect(cells[3]).toBe("5/33");
    });
    it("prints a dash per million for a row with no score or no tokens, and 'unknown' for no harness", () => {
        expect(benchRowCells(row({ scored: 0, allscored: 0 }), "review")[7]).toBe("-");
        expect(benchRowCells(row({ tokens: 0 }), "review")[7]).toBe("-");
        expect(benchRowCells(row({ harness: "" }), "review")[0]).toBe("unknown");
    });
    it("prints a Brainstorm row with recall@3, the skill, recall@done, decisions and questions", () => {
        const b = row({
            mode: "brainstorm",
            variant: "brainstorm",
            skill: "superpowers:brainstorming",
            recall: 10,
            recall3: 6,
            recall_done: 8,
            decisions: 12,
            questions: 4,
            judged: 20,
            wrong: 2,
            tokens: 5_700_000,
            recallperm: 1.8,
        });
        expect(benchRowCells(b, "brainstorm")).toEqual([
            "2026-11-12.1",
            "brainstorm",
            "superpowers:brainstorming",
            "5/5",
            "6/33",
            "10/33",
            "8/33",
            "2/20",
            "12",
            "4",
            "5.7M",
            "1.8",
        ]);
    });
    it("prints dashes for what only the brainstorm variant has, and for recall@3 of an older harness", () => {
        const council = benchRowCells(row({ mode: "brainstorm", judged: 0, recall3: 0 }), "brainstorm");
        expect(council[2]).toBe("-");
        expect(council[4]).toBe("-");
        expect(council[6]).toBe("-");
        expect(council[8]).toBe("-");
        expect(council[9]).toBe("-");
        expect(council[7]).toBe("4");
    });
});

describe("benchRowLines", () => {
    it("pairs each column with its cell", () => {
        const lines = benchRowLines(row(), "review");
        expect(lines[0]).toEqual({ label: "harness", value: "2026-11-12.1" });
        expect(lines.find((l) => l.label === "recall@5")?.value).toBe("5/33");
        expect(lines.find((l) => l.label === "tokens")?.value).toBe("7.5M");
        expect(lines).toHaveLength(8);
        expect(benchRowLines(row({ mode: "brainstorm" }), "brainstorm")).toHaveLength(12);
    });
});

describe("benchTables", () => {
    it("gives Review then Brainstorm, each with its own rows in the order given, and a mode with none left out", () => {
        const rows = [
            row({ variant: "solo" }),
            row({ mode: "brainstorm", variant: "council" }),
            row({ variant: "team" }),
        ];
        const tables = benchTables(rows);
        expect(tables.map((t) => t.heading)).toEqual(["Review", "Brainstorm"]);
        expect(tables[0].rows.map((r) => r[1])).toEqual(["solo", "team"]);
        expect(tables[1].rows.map((r) => r[1])).toEqual(["council"]);
        expect(tables[0].columns).toHaveLength(tables[0].rows[0].length);
        expect(tables[1].columns).toHaveLength(tables[1].rows[0].length);
        expect(benchTables([row()]).map((t) => t.mode)).toEqual(["review"]);
        expect(benchTables([])).toEqual([]);
    });
    it("leaves a row of an unknown mode out, and right-aligns the counts", () => {
        expect(benchTables([row({ mode: "" })])).toEqual([]);
        const t = benchTables([row()])[0];
        expect(t.numeric).toEqual([2, 3, 4, 5, 6, 7]);
        expect(t.note).toContain("recall@5 only");
        const b = benchTables([row({ mode: "brainstorm" })])[0];
        expect(b.numeric[0]).toBe(3);
        expect(b.note).toContain("2026-11-12.1");
    });
});

describe("placeLabels", () => {
    it("puts a label to the right of its point, level with it", () => {
        const [l] = placeLabels([{ id: "a", x: 100, y: 50, text: "council · 11-12" }], 400);
        expect(l).toEqual({ id: "a", x: 110, y: 53.5, anchor: "start" });
    });
    it("flips a label that would run past the plot to the left of its point", () => {
        const text = "brainstorm · 11-12";
        const [l] = placeLabels([{ id: "a", x: 380, y: 50, text }], 400);
        expect(l.anchor).toBe("end");
        expect(l.x).toBe(370);
        expect(labelWidth(text)).toBeGreaterThan(20);
    });
    it("moves a label that would sit on another one down under it", () => {
        const out = placeLabels(
            [
                { id: "a", x: 100, y: 50, text: "council · 11-12" },
                { id: "b", x: 110, y: 54, text: "team · 11-12" },
            ],
            400
        );
        const a = out.find((l) => l.id === "a")!;
        const b = out.find((l) => l.id === "b")!;
        expect(b.y - a.y).toBeGreaterThanOrEqual(12);
    });
    it("leaves two labels that do not meet where they are, and keeps the order it was given", () => {
        const out = placeLabels(
            [
                { id: "far", x: 300, y: 150, text: "solo · 11-12" },
                { id: "near", x: 100, y: 50, text: "team · 11-12" },
            ],
            600
        );
        expect(out.map((l) => l.id)).toEqual(["far", "near"]);
        expect(out[0].y).toBe(153.5);
        expect(out[1].y).toBe(53.5);
    });
});

describe("steppedPath", () => {
    it("steps along to the next point's x at the current height, then to its height", () => {
        expect(
            steppedPath([
                { x: 10, y: 100 },
                { x: 50, y: 60 },
                { x: 90, y: 20 },
            ])
        ).toBe("M10 100H50V60H90V20");
    });
    it("orders the points cheapest first, and draws nothing for fewer than two", () => {
        expect(
            steppedPath([
                { x: 50, y: 60 },
                { x: 10, y: 100 },
            ])
        ).toBe("M10 100H50V60");
        expect(steppedPath([{ x: 1, y: 1 }])).toBe("");
        expect(steppedPath([])).toBe("");
    });
});
