// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    advance,
    branchTiers,
    emptyArrangement,
    hasLights,
    hasStar,
    milestoneAt,
    MILESTONES,
    milestoneTitle,
    milestoneToAnnounce,
    moveOrnament,
    nearestSpot,
    ornamentRange,
    ornamentTasks,
    parseArrangement,
    progress,
    spotCount,
    SPOTS_BY_STAGE,
    tierCounts,
    type Arrangement,
    type Ornament,
} from "./xmastreemodel";

function hungTasks(a: Arrangement): number {
    return a.spots.reduce((n, o) => n + (o ? ornamentTasks(o) : 0), 0);
}

describe("milestones", () => {
    it("rises through the spec's thresholds", () => {
        expect(MILESTONES).toEqual([5, 15, 50, 150, 250, 600, 1500]);
        expect(SPOTS_BY_STAGE).toEqual([4, 10, 19, 22, 25, 30]);
        expect(milestoneAt(0)).toBe(0);
        expect(milestoneAt(4)).toBe(0);
        expect(milestoneAt(5)).toBe(1);
        expect(milestoneAt(1499)).toBe(6);
        expect(milestoneAt(1500)).toBe(7);
        expect(milestoneAt(100000)).toBe(7);
    });

    it("grows branches to 5 tiers, then the lights, then the star", () => {
        expect([0, 1, 5, 6, 7].map(branchTiers)).toEqual([0, 1, 5, 5, 5]);
        expect([5, 6, 7].map(hasLights)).toEqual([false, true, true]);
        expect([6, 7].map(hasStar)).toEqual([false, true]);
        expect([0, 1, 2, 3, 4, 5, 6, 7].map(spotCount)).toEqual([4, 10, 19, 22, 25, 30, 30, 30]);
    });

    it("reports progress to the next milestone", () => {
        expect(progress(214)).toEqual({ milestone: 4, left: 36, fraction: 64 / 100 });
        expect(progress(0)).toEqual({ milestone: 0, left: 5, fraction: 0 });
        expect(progress(1500)).toEqual({ milestone: 7, left: 0, fraction: 1 });
        expect(progress(9999)).toEqual({ milestone: 7, left: 0, fraction: 1 });
    });

    it("announces only a milestone above the announced one", () => {
        expect(milestoneToAnnounce(4, 0)).toBe(4);
        expect(milestoneToAnnounce(4, 4)).toBeNull();
        expect(milestoneToAnnounce(5, 4)).toBe(5);
        expect(milestoneToAnnounce(3, 4)).toBeNull();
        expect(milestoneToAnnounce(0, 0)).toBeNull();
    });

    it("titles each milestone", () => {
        expect(milestoneTitle(1)).toBe("The tree grew its 1st tier");
        expect(milestoneTitle(2)).toBe("The tree grew its 2nd tier");
        expect(milestoneTitle(3)).toBe("The tree grew its 3rd tier");
        expect(milestoneTitle(5)).toBe("The tree grew its 5th tier");
        expect(milestoneTitle(6)).toBe("The tree's lights are on");
        expect(milestoneTitle(7)).toBe("The star is on top of the tree");
    });
});

describe("advance", () => {
    it("starts as a sapling with its free spots", () => {
        const a = emptyArrangement();
        expect(a).toEqual({ count: 0, spots: [null, null, null, null] });
    });

    it("draws board A at 214 tasks: 14 small, 10 big, 1 rare", () => {
        const a = advance(emptyArrangement(), 214);
        expect(a.count).toBe(214);
        expect(a.spots).toHaveLength(25);
        expect(tierCounts(a)).toEqual([14, 10, 1, 0]);
    });

    it("hangs each new ornament in the lowest-numbered free spot", () => {
        const a = advance(emptyArrangement(), 3);
        expect(a.spots).toEqual([
            { tier: 0, first: 0, last: 0 },
            { tier: 0, first: 1, last: 1 },
            { tier: 0, first: 2, last: 2 },
            null,
        ]);
    });

    it("appends free spots when the tree grows a stage", () => {
        const a = advance(emptyArrangement(), 5);
        expect(a.spots).toHaveLength(10);
        expect(a.spots.slice(5)).toEqual([null, null, null, null, null]);
    });

    it("equals advancing one task at a time", () => {
        let step = emptyArrangement();
        for (let n = 1; n <= 300; n++) step = advance(step, n);
        expect(advance(emptyArrangement(), 300)).toEqual(step);
    });

    it("leaves the input untouched and ignores a count at or below its own", () => {
        const a = advance(emptyArrangement(), 20);
        const copy = structuredClone(a);
        advance(a, 40);
        expect(a).toEqual(copy);
        expect(advance(a, 20)).toEqual(a);
        expect(advance(a, 3)).toEqual(a);
    });

    it("merges the 10 oldest of the lowest tier with 10 at the oldest one's spot", () => {
        // Advance until the first merge.
        let a = emptyArrangement();
        let n = 0;
        while (tierCounts(a)[1] === 0) a = advance(a, ++n);
        const big = a.spots.find((o) => o?.tier === 1)!;
        expect(big).toEqual({ tier: 1, first: 0, last: 9 });
        expect(a.spots.indexOf(big)).toBe(0);
        // The new task took the lowest-numbered spot the merge freed.
        expect(a.spots[1]).toEqual({ tier: 0, first: n - 1, last: n - 1 });
        expect(hungTasks(a)).toBe(n);
    });

    it("hangs every task up to 3,999, then counts one it cannot hang", () => {
        let a = emptyArrangement();
        let dropped = 0;
        for (let n = 1; n < 6000; n++) {
            a = advance(a, n);
            if (n < 4000) {
                expect(hungTasks(a)).toBe(n);
            } else if (hungTasks(a) < n) {
                dropped = n;
                break;
            }
        }
        expect(dropped).toBeGreaterThan(3999);
        // The pinned no-spot case: the count advances, the ornament is dropped, the tree is full with no tier of 10.
        expect(a.count).toBe(dropped);
        expect(hungTasks(a)).toBe(dropped - 1);
        expect(a.spots.every((o) => o != null)).toBe(true);
        const counts = tierCounts(a);
        expect(counts.slice(0, 3).every((c) => c < 10)).toBe(true);
        const next = advance(a, dropped + 1);
        expect(next.count).toBe(dropped + 1);
        expect(next.spots).toEqual(a.spots);
    });

    it("keeps a moved ornament in its spot as new ones take free spots", () => {
        const a = advance(emptyArrangement(), 6); // 10 spots, 0..5 taken
        const moved = moveOrnament(a, 0, 9);
        expect(moved.spots[0]).toBeNull();
        expect(moved.spots[9]).toEqual({ tier: 0, first: 0, last: 0 });
        const b = advance(moved, 8);
        expect(b.spots[9]).toEqual({ tier: 0, first: 0, last: 0 });
        expect(b.spots[0]).toEqual({ tier: 0, first: 6, last: 6 });
        expect(b.spots[6]).toEqual({ tier: 0, first: 7, last: 7 });
    });
});

describe("moveOrnament", () => {
    const a = advance(emptyArrangement(), 3);

    it("moves into a free spot", () => {
        const b = moveOrnament(a, 1, 3);
        expect(b.spots).toEqual([
            { tier: 0, first: 0, last: 0 },
            null,
            { tier: 0, first: 2, last: 2 },
            { tier: 0, first: 1, last: 1 },
        ]);
        expect(a.spots[1]).toEqual({ tier: 0, first: 1, last: 1 });
    });

    it("swaps with a taken spot", () => {
        const b = moveOrnament(a, 0, 2);
        expect(b.spots[0]).toEqual({ tier: 0, first: 2, last: 2 });
        expect(b.spots[2]).toEqual({ tier: 0, first: 0, last: 0 });
        expect(b.count).toBe(3);
    });

    it("ignores an empty source or a spot out of range", () => {
        expect(moveOrnament(a, 3, 0)).toEqual(a);
        expect(moveOrnament(a, 0, 9)).toEqual(a);
        expect(moveOrnament(a, 1, 1)).toEqual(a);
    });
});

describe("ornaments", () => {
    it("spans a merged big bauble's ten tasks", () => {
        const done = Array.from({ length: 30 }, (_, i) => 1_000 + i * 100);
        let a = emptyArrangement();
        let n = 0;
        while (tierCounts(a)[1] === 0) a = advance(a, ++n);
        const big = a.spots.find((o) => o?.tier === 1)!;
        expect(ornamentTasks(big)).toBe(10);
        expect(ornamentRange(big, done)).toEqual({ from: done[0], to: done[9] });
        const small: Ornament = { tier: 0, first: 4, last: 4 };
        expect(ornamentTasks(small)).toBe(1);
        expect(ornamentRange(small, done)).toEqual({ from: done[4], to: done[4] });
    });
});

describe("parseArrangement", () => {
    it("reads back a saved arrangement", () => {
        const a = advance(emptyArrangement(), 214);
        expect(parseArrangement(JSON.parse(JSON.stringify(a)))).toEqual(a);
    });

    it("rejects a wrong shape", () => {
        expect(parseArrangement(null)).toBeNull();
        expect(parseArrangement("x")).toBeNull();
        expect(parseArrangement({ count: 1 })).toBeNull();
        expect(parseArrangement({ count: -1, spots: [] })).toBeNull();
        expect(parseArrangement({ count: 1.5, spots: [] })).toBeNull();
        expect(parseArrangement({ count: 1, spots: [{ tier: 4, first: 0, last: 0 }] })).toBeNull();
        expect(parseArrangement({ count: 1, spots: [{ tier: 0, first: "0", last: 0 }] })).toBeNull();
        expect(parseArrangement({ count: 1, spots: [7] })).toBeNull();
    });

    it("rejects more than 30 spots", () => {
        expect(parseArrangement({ count: 0, spots: Array(30).fill(null) })).not.toBeNull();
        expect(parseArrangement({ count: 0, spots: Array(31).fill(null) })).toBeNull();
    });

    it("rejects first > last and a task past the count", () => {
        expect(parseArrangement({ count: 9, spots: [{ tier: 1, first: 5, last: 4 }] })).toBeNull();
        expect(parseArrangement({ count: 3, spots: [{ tier: 0, first: 3, last: 3 }] })).toBeNull();
    });
});

describe("nearestSpot", () => {
    //   0 . 1
    //   . 2 .
    //   3 . 4
    const pts = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 2 },
        { x: 2, y: 2 },
    ];
    const all = [true, true, true, true, true];

    it("picks the closest allowed point in the arrow's direction", () => {
        expect(nearestSpot(pts, 0, "right", all)).toBe(1);
        expect(nearestSpot(pts, 0, "down", all)).toBe(3);
        expect(nearestSpot(pts, 4, "up", all)).toBe(1);
        expect(nearestSpot(pts, 4, "left", all)).toBe(3);
        expect(nearestSpot(pts, 3, "up", all)).toBe(0);
        expect(nearestSpot(pts, 2, "right", all)).toBe(1);
    });

    it("skips a spot that is not allowed", () => {
        expect(nearestSpot(pts, 0, "right", [true, false, true, true, true])).toBe(2);
    });

    it("returns from when none lies that way", () => {
        expect(nearestSpot(pts, 0, "left", all)).toBe(0);
        expect(nearestSpot(pts, 0, "up", all)).toBe(0);
        expect(nearestSpot(pts, 0, "right", [true, false, false, true, false])).toBe(0);
    });
});
