// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    cardPoints,
    countText,
    keyRows,
    milestoneLine,
    openCard,
    ornamentDetail,
    ornamentName,
    treeCardStep,
    type CardState,
} from "./xmastreecardmodel";
import { advance, emptyArrangement, type Arrangement, type Ornament } from "./xmastreemodel";

// a row of spots 0..n-1, one apart left to right, so ← → step through them in order
function line(n: number): { x: number; y: number }[] {
    return Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
}

const small = (i: number): Ornament => ({ tier: 0, first: i, last: i });

// spots: 0 an ornament, 1 free, 2 an ornament, 3 free, 4 an ornament
const arr: Arrangement = { count: 5, spots: [small(0), null, small(1), null, small(2)] };
const ctx = { points: line(5), arrangement: arr };

describe("openCard", () => {
    it("puts the cursor on the first ornament, with nothing lifted", () => {
        expect(openCard({ count: 2, spots: [null, small(0), small(1)] })).toEqual({ cursor: 1, lifted: null });
    });

    it("puts the cursor on spot 0 when no ornament hangs", () => {
        expect(openCard(emptyArrangement())).toEqual({ cursor: 0, lifted: null });
    });
});

describe("treeCardStep", () => {
    it("moves over ornaments only while nothing is lifted", () => {
        const s: CardState = { cursor: 0, lifted: null };
        expect(treeCardStep(s, { do: "treeMove", dir: "right" }, ctx)).toEqual({ state: { cursor: 2, lifted: null } });
        expect(treeCardStep({ cursor: 2, lifted: null }, { do: "treeMove", dir: "left" }, ctx).state.cursor).toBe(0);
    });

    it("moves over every spot while one is lifted", () => {
        const s: CardState = { cursor: 0, lifted: 0 };
        expect(treeCardStep(s, { do: "treeMove", dir: "right" }, ctx)).toEqual({ state: { cursor: 1, lifted: 0 } });
    });

    it("stays put when no spot lies that way", () => {
        expect(treeCardStep({ cursor: 4, lifted: null }, { do: "treeMove", dir: "right" }, ctx).state.cursor).toBe(4);
        expect(treeCardStep({ cursor: 0, lifted: null }, { do: "treeMove", dir: "up" }, ctx).state.cursor).toBe(0);
    });

    it("lifts the ornament under the cursor, and nothing from a free spot", () => {
        expect(treeCardStep({ cursor: 2, lifted: null }, { do: "treeLift" }, ctx)).toEqual({
            state: { cursor: 2, lifted: 2 },
        });
        expect(treeCardStep({ cursor: 1, lifted: null }, { do: "treeLift" }, ctx)).toEqual({
            state: { cursor: 1, lifted: null },
        });
    });

    it("puts a lifted ornament down on another spot as a move, which moveOrnament applies", () => {
        const out = treeCardStep({ cursor: 3, lifted: 0 }, { do: "treeLift" }, ctx);
        expect(out).toEqual({ state: { cursor: 3, lifted: null }, move: { from: 0, to: 3 } });
    });

    it("puts a lifted ornament back on its own spot with no move", () => {
        expect(treeCardStep({ cursor: 2, lifted: 2 }, { do: "treeLift" }, ctx)).toEqual({
            state: { cursor: 2, lifted: null },
        });
    });

    it("puts a lifted ornament back on close, the cursor with it", () => {
        expect(treeCardStep({ cursor: 3, lifted: 0 }, { do: "close" }, ctx)).toEqual({
            state: { cursor: 0, lifted: null },
        });
        expect(treeCardStep({ cursor: 2, lifted: null }, { do: "close" }, ctx)).toEqual({
            state: { cursor: 2, lifted: null },
        });
    });

    it("drops a lift whose ornament is gone, and keeps the cursor on the tree", () => {
        const gone = { points: line(5), arrangement: { count: 5, spots: [null, null, null, null, small(0)] } };
        expect(treeCardStep({ cursor: 3, lifted: 0 }, { do: "treeLift" }, gone)).toEqual({
            state: { cursor: 3, lifted: null },
        });
        const shrunk = { points: line(2), arrangement: { count: 1, spots: [small(0), null] } };
        expect(treeCardStep({ cursor: 4, lifted: null }, { do: "treeMove", dir: "left" }, shrunk).state.cursor).toBe(0);
    });
});

describe("cardPoints", () => {
    it("gives one point per spot of the stage, on the grid the tree is drawn with", () => {
        const a = advance(emptyArrangement(), 214);
        expect(cardPoints(4, a)).toHaveLength(a.spots.length);
        expect(cardPoints(4, a)).toHaveLength(25);
    });
});

describe("the side column's texts", () => {
    it("counts the season's tasks", () => {
        expect(countText(214)).toBe("214 tasks");
        expect(countText(1)).toBe("1 task");
        expect(countText(1632)).toBe("1,632 tasks");
    });

    it("names the milestone reached and the tasks to the next one", () => {
        expect(milestoneLine(214)).toBe("Milestone 4 / 7: four tiers. 36 tasks to the fifth tier.");
        expect(milestoneLine(0)).toBe("Milestone 0 / 7: a sapling. 5 tasks to the first tier.");
        expect(milestoneLine(14)).toBe("Milestone 1 / 7: one tier. 1 task to the second tier.");
    });

    it("words the lights and the star as the next milestones", () => {
        expect(milestoneLine(300)).toBe("Milestone 5 / 7: five tiers. 300 tasks to the lights.");
        expect(milestoneLine(1000)).toBe("Milestone 6 / 7: the lights. 500 tasks to the star.");
    });

    it("says the tree is complete at the star", () => {
        expect(milestoneLine(1500)).toBe("Milestone 7 / 7: the star on top. The tree is complete.");
        expect(milestoneLine(4000)).toBe("Milestone 7 / 7: the star on top. The tree is complete.");
    });

    it("names each tier's ornament", () => {
        expect([0, 1, 2, 3].map((t) => ornamentName(t as 0 | 1 | 2 | 3))).toEqual([
            "Small ornament",
            "Big bauble",
            "Rare ornament",
            "Heirloom",
        ]);
    });

    it("says what a merged ornament holds and the day and month its tasks finished in", () => {
        const done = Array.from({ length: 10 }, (_, i) => new Date(2026, 10, 8 + Math.floor(i / 2), 15).getTime());
        expect(ornamentDetail({ tier: 1, first: 0, last: 9 }, done)).toBe("Merged from 10 tasks, 8/11 to 12/11");
        expect(ornamentDetail({ tier: 1, first: 0, last: 1 }, done)).toBe("Merged from 2 tasks, 8/11");
    });

    it("gives a small ornament's one task and its day", () => {
        const done = [new Date(2026, 10, 8, 9).getTime()];
        expect(ornamentDetail(small(0), done)).toBe("1 task, 8/11");
    });

    it("keys small, big and rare always, with how many of each hang", () => {
        const a = advance(emptyArrangement(), 214);
        expect(keyRows(a)).toEqual([
            { tier: 0, label: "Small ornament: 1 task", onTree: "14 on the tree" },
            { tier: 1, label: "Big bauble: 10 tasks", onTree: "10 on the tree" },
            { tier: 2, label: "Rare ornament: 100 tasks", onTree: "1 on the tree" },
        ]);
        expect(keyRows(emptyArrangement()).map((r) => r.onTree)).toEqual([
            "0 on the tree",
            "0 on the tree",
            "0 on the tree",
        ]);
    });

    it("adds the heirloom once one hangs", () => {
        const a: Arrangement = { count: 1000, spots: [{ tier: 3, first: 0, last: 999 }] };
        expect(keyRows(a)[3]).toEqual({ tier: 3, label: "Heirloom: 1,000 tasks", onTree: "1 on the tree" });
        expect(keyRows(a)).toHaveLength(4);
    });
});
