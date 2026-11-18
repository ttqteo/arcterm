// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    atEnd,
    fencedText,
    FOCUS_READ_KEEP,
    lineOffset,
    litAt,
    nearestAt,
    parseFocusReadIds,
    scrollTopFor,
    SETTLE_MAX,
    settleTo,
    stepFrom,
    tableText,
    TOP_ABOVE,
    withFocusRead,
} from "./chatfocusread";

// three blocks with 20px gaps: 0-100, 120-160, 180-600
const SPANS = [
    { top: 0, bottom: 100 },
    { top: 120, bottom: 160 },
    { top: 180, bottom: 600 },
];

describe("litAt", () => {
    it("lights the block the line crosses", () => {
        expect(litAt(SPANS, 50)).toBe(0);
        expect(litAt(SPANS, 140)).toBe(1);
        expect(litAt(SPANS, 300)).toBe(2);
    });
    it("lights the next block below when the line is in a gap", () => {
        expect(litAt(SPANS, 105)).toBe(1);
        expect(litAt(SPANS, 175)).toBe(2);
    });
    it("lights the first block when the line is above it, the last below the last", () => {
        expect(litAt([{ top: 40, bottom: 80 }], 10)).toBe(0);
        expect(litAt(SPANS, 900)).toBe(2);
    });
    it("is -1 with no blocks", () => {
        expect(litAt([], 10)).toBe(-1);
    });
});

describe("nearestAt", () => {
    it("is the crossed block, else the closer side of the gap", () => {
        expect(nearestAt(SPANS, 140)).toBe(1);
        expect(nearestAt(SPANS, 104)).toBe(0);
        expect(nearestAt(SPANS, 116)).toBe(1);
        // a tie goes to the block below
        expect(nearestAt(SPANS, 110)).toBe(1);
        expect(nearestAt(SPANS, 900)).toBe(2);
        expect(nearestAt([], 10)).toBe(-1);
    });
});

describe("scrollTopFor", () => {
    it("puts a block's top TOP_ABOVE px above the line", () => {
        // a line 200px down: the block's top (900) lands at 188 in the view
        expect(scrollTopFor({ top: 900, bottom: 1000 }, 200, 10_000)).toBe(900 - 200 + TOP_ABOVE);
    });
    it("centres a short block on the line", () => {
        expect(scrollTopFor({ top: 500, bottom: 510 }, 200, 10_000)).toBe(500 - 200 + 5);
    });
    it("shows a tall block from its top: its top never goes further up than TOP_ABOVE", () => {
        expect(scrollTopFor({ top: 1000, bottom: 3000 }, 200, 10_000)).toBe(1000 - 200 + TOP_ABOVE);
    });
    it("stays inside the scroller's range", () => {
        expect(scrollTopFor(SPANS[0], 200, 10_000)).toBe(0);
        expect(scrollTopFor(SPANS[2], 50, 100)).toBe(100);
    });
});

describe("stepFrom", () => {
    it("steps to the next or previous block, and stops at either end", () => {
        expect(stepFrom(1, 1, 3)).toBe(2);
        expect(stepFrom(1, -1, 3)).toBe(0);
        expect(stepFrom(2, 1, 3)).toBeNull();
        expect(stepFrom(0, -1, 3)).toBeNull();
    });
    it("starts at the first block on J when none is lit", () => {
        expect(stepFrom(-1, 1, 3)).toBe(0);
        expect(stepFrom(-1, -1, 3)).toBeNull();
        expect(stepFrom(0, 1, 0)).toBeNull();
    });
    it("steps from the last block when the lit one is past the list", () => {
        expect(stepFrom(5, -1, 3)).toBe(1);
    });
});

describe("settleTo", () => {
    // a 600px view (line at 200) over 2000px of content
    const H = 600;
    const TOTAL = 2000;
    const spans = [
        { top: 100, bottom: 160 },
        { top: 200, bottom: 260 },
        { top: 300, bottom: 1500 },
        { top: 1520, bottom: 1580 },
    ];
    it("settles the block nearest the line onto it", () => {
        // the line at content 230 crosses block 1, whose top should sit TOP_ABOVE above it
        expect(settleTo(spans, 30, H, TOTAL)).toEqual({ index: 1, top: 200 - 200 + TOP_ABOVE });
    });
    it("does nothing when the block is already on the line", () => {
        expect(settleTo(spans, TOP_ABOVE, H, TOTAL)).toBeNull();
    });
    it("does nothing at the scroller's end", () => {
        expect(settleTo(spans, TOTAL - H, H, TOTAL)).toBeNull();
        expect(settleTo(spans, TOTAL - H - 1, H, TOTAL)).toBeNull();
    });
    it("does nothing inside a tall block, far from its top", () => {
        // the line at content 900 is 600px into block 2
        const at = 700;
        expect(Math.abs(scrollTopFor(spans[2], lineOffset(H), TOTAL - H) - at)).toBeGreaterThan(SETTLE_MAX);
        expect(settleTo(spans, at, H, TOTAL)).toBeNull();
    });
    it("does nothing with no blocks", () => {
        expect(settleTo([], 30, H, TOTAL)).toBeNull();
    });
});

describe("atEnd", () => {
    it("is within END_SLACK of the end", () => {
        expect(atEnd(1400, 2000, 600)).toBe(true);
        expect(atEnd(1398, 2000, 600)).toBe(true);
        expect(atEnd(1390, 2000, 600)).toBe(false);
        expect(atEnd(0, 300, 600)).toBe(true);
    });
});

describe("fencedText", () => {
    it("fences the code with its language", () => {
        expect(fencedText("ts", ["const a = 1;", "", "a++;"])).toBe("```ts\nconst a = 1;\n\na++;\n```");
        expect(fencedText("", ["x"])).toBe("```\nx\n```");
    });
});

describe("tableText", () => {
    it("rebuilds a markdown table with the first row as its header", () => {
        expect(
            tableText([
                ["Name", "Size"],
                ["a", "1"],
                ["b", "2"],
            ])
        ).toBe("| Name | Size |\n| --- | --- |\n| a | 1 |\n| b | 2 |");
    });
    it("escapes pipes, folds whitespace and pads a short row", () => {
        expect(tableText([["x|y", "z"], ["multi\n line"]])).toBe("| x\\|y | z |\n| --- | --- |\n| multi line |  |");
    });
    it("is empty with no rows", () => {
        expect(tableText([])).toBe("");
    });
});

describe("parseFocusReadIds", () => {
    it("is the stored list of agent ids", () => {
        expect(parseFocusReadIds('["a","b"]')).toEqual(["a", "b"]);
    });
    it("turns on no agent from nothing, the old global value or junk", () => {
        expect(parseFocusReadIds(null)).toEqual([]);
        expect(parseFocusReadIds("true")).toEqual([]);
        expect(parseFocusReadIds("false")).toEqual([]);
        expect(parseFocusReadIds("{")).toEqual([]);
        expect(parseFocusReadIds('[1,"",null,"a"]')).toEqual(["a"]);
    });
});

describe("withFocusRead", () => {
    it("turns one agent on, at the end, once", () => {
        expect(withFocusRead(["a", "b"], "a", true)).toEqual(["b", "a"]);
        expect(withFocusRead([], "a", true)).toEqual(["a"]);
    });
    it("turns one agent off and leaves the rest", () => {
        expect(withFocusRead(["a", "b"], "a", false)).toEqual(["b"]);
        expect(withFocusRead(["b"], "a", false)).toEqual(["b"]);
    });
    it("keeps the agents that turned it on last", () => {
        const many = Array.from({ length: FOCUS_READ_KEEP }, (_, i) => `x${i}`);
        const next = withFocusRead(many, "new", true);
        expect(next).toHaveLength(FOCUS_READ_KEEP);
        expect(next[0]).toBe("x1");
        expect(next.at(-1)).toBe("new");
    });
});
