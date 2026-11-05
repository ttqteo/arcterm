// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { advance, emptyArrangement, moveOrnament, spotCount, type Arrangement } from "./xmastreemodel";
import {
    arrangementFor,
    asPhase,
    parseAnnounced,
    railPine,
    treeView,
    xmasAnnouncedKey,
    xmasTreeKey,
} from "./xmastreestore";

const done = (n: number) => Array.from({ length: n }, (_, i) => 1_762_000_000_000 + i * 60_000);

describe("storage keys", () => {
    it("are per season", () => {
        expect(xmasTreeKey(2026)).toBe("xmas.tree.2026");
        expect(xmasAnnouncedKey(2026)).toBe("xmas.tree.announced.2026");
    });
});

describe("asPhase", () => {
    it("keeps season and newyear, reads anything else as off", () => {
        expect(asPhase("season")).toBe("season");
        expect(asPhase("newyear")).toBe("newyear");
        expect(asPhase("off")).toBe("off");
        expect(asPhase("")).toBe("off");
        expect(asPhase(undefined)).toBe("off");
    });
});

describe("arrangementFor", () => {
    it("builds from nothing when nothing is saved", () => {
        expect(arrangementFor(null, 214)).toEqual(advance(emptyArrangement(), 214));
    });

    it("advances a saved arrangement that is behind, keeping a moved ornament where it was put", () => {
        const at20 = advance(emptyArrangement(), 20);
        const free = at20.spots.indexOf(null);
        const moved = moveOrnament(at20, 0, free);
        const next = arrangementFor(moved, 25);
        expect(next.count).toBe(25);
        expect(next.spots[free]).toEqual(moved.spots[free]);
        expect(next).not.toEqual(advance(emptyArrangement(), 25));
    });

    it("returns a level arrangement as it is", () => {
        const a = advance(emptyArrangement(), 50);
        expect(arrangementFor(a, 50)).toBe(a);
    });

    it("rebuilds an arrangement ahead of the ledger (a fixture, another store)", () => {
        const ahead = moveOrnament(advance(emptyArrangement(), 250), 0, 24);
        expect(arrangementFor(ahead, 249)).toEqual(advance(emptyArrangement(), 249));
    });

    it("rebuilds one holding more spots than its own stage has", () => {
        const odd: Arrangement = { count: 3, spots: new Array(30).fill(null) };
        expect(arrangementFor(odd, 3)).toEqual(advance(emptyArrangement(), 3));
    });

    it("pads a short spots list to the stage's spot count", () => {
        const short: Arrangement = { count: 1, spots: [{ tier: 0, first: 0, last: 0 }] };
        const a = arrangementFor(short, 1);
        expect(a.spots.length).toBe(spotCount(0));
        expect(a.spots[0]).toEqual({ tier: 0, first: 0, last: 0 });
    });
});

describe("treeView", () => {
    it("derives the count, the milestone and the arrangement in season", () => {
        const v = treeView({ season: 2026, phase: "season", done: done(214) }, null);
        expect(v).toMatchObject({ season: 2026, phase: "season", count: 214, milestone: 4 });
        expect(v.arrangement).toEqual(advance(emptyArrangement(), 214));
        expect(v.done.length).toBe(214);
    });

    it("builds on the saved arrangement", () => {
        const saved = moveOrnament(advance(emptyArrangement(), 214), 0, 24);
        const v = treeView({ season: 2026, phase: "newyear", done: done(214) }, saved);
        expect(v.arrangement).toBe(saved);
    });

    it("is a bare tree out of season: count 0, no ornaments", () => {
        const v = treeView({ season: 2026, phase: "off", done: done(9) }, null);
        expect(v).toMatchObject({ phase: "off", count: 0, milestone: 0, done: [] });
        expect(v.arrangement).toEqual(emptyArrangement());
    });

    it("reads a missing done list as none", () => {
        const v = treeView({ season: 2026, phase: "season", done: undefined as unknown as number[] }, null);
        expect(v.count).toBe(0);
    });
});

describe("railPine", () => {
    it("draws the season's stage with its ornaments in season and on 1 January", () => {
        for (const phase of ["season", "newyear"]) {
            const v = treeView({ season: 2026, phase, done: done(214) }, null);
            expect(railPine(v)).toEqual({ milestone: 4, arrangement: v.arrangement });
        }
    });

    it("draws the full tree bare out of season", () => {
        const v = treeView({ season: 2026, phase: "off", done: [] }, null);
        expect(railPine(v)).toEqual({ milestone: 7, arrangement: null });
    });
});

describe("parseAnnounced", () => {
    it("reads a stored milestone, and 0 for nothing or garbage", () => {
        expect(parseAnnounced("5")).toBe(5);
        expect(parseAnnounced(null)).toBe(0);
        expect(parseAnnounced("x")).toBe(0);
        expect(parseAnnounced("-1")).toBe(0);
        expect(parseAnnounced("2.5")).toBe(0);
    });
});
