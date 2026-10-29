// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentActionEntry } from "./agentsviewmodel";
import type { CompactItem } from "./compacttimeline";
import {
    drawnToReach,
    firstDrawn,
    grownDrawn,
    holdingItem,
    itemSpan,
    keyFor,
    RENDER_CAP,
    topAction,
    windowStart,
    type ItemSpan,
} from "./compactwindow";

const act: AgentActionEntry = { kind: "action", verb: "read", target: "a.ts" };

// n message items on entries 0..n-1
const messages = (n: number): ItemSpan[] =>
    Array.from({ length: n }, (_, i) => itemSpan({ kind: "message", text: "", index: i }, 0));

describe("firstDrawn", () => {
    it("draws every item under the cap", () => {
        expect(firstDrawn(50, RENDER_CAP)).toBe(0);
    });

    it("draws every item at the cap", () => {
        expect(firstDrawn(RENDER_CAP, RENDER_CAP)).toBe(0);
    });

    it("leaves the oldest items hidden over the cap", () => {
        expect(firstDrawn(RENDER_CAP + 1, RENDER_CAP)).toBe(1);
        expect(firstDrawn(500, RENDER_CAP)).toBe(300);
    });
});

describe("grownDrawn", () => {
    it("adds a cap's worth, so the first drawn item moves back by it", () => {
        const drawn = grownDrawn(1000, RENDER_CAP);
        expect(drawn).toBe(2 * RENDER_CAP);
        expect(firstDrawn(1000, drawn)).toBe(1000 - 2 * RENDER_CAP);
    });

    it("stops at every item", () => {
        expect(grownDrawn(250, RENDER_CAP)).toBe(250);
        expect(firstDrawn(250, grownDrawn(250, RENDER_CAP))).toBe(0);
        expect(grownDrawn(10, 10)).toBe(10);
    });
});

describe("drawnToReach", () => {
    it("draws back to an item far from the end", () => {
        const drawn = drawnToReach(5000, 120);
        expect(drawn).toBe(4880);
        expect(firstDrawn(5000, drawn)).toBe(120);
    });

    it("needs one item for the last item", () => {
        expect(drawnToReach(5000, 4999)).toBe(1);
    });
});

describe("keyFor", () => {
    it("is the entry index with no offset", () => {
        expect(keyFor(7, 0)).toBe(7);
    });

    it("keeps an item's key when entries are put in front of it", () => {
        // an item at entry 7; a load puts 300 entries in front, so it sits at 307 and the offset is 300
        expect(keyFor(307, 300)).toBe(keyFor(7, 0));
    });

    it("gives the entries put in front keys before every old one", () => {
        expect(keyFor(0, 300)).toBe(-300);
        expect(keyFor(299, 300)).toBe(-1);
    });
});

describe("itemSpan", () => {
    it("holds one entry for prose and the other single items", () => {
        expect(itemSpan({ kind: "compaction", index: 9 }, 0)).toEqual({ start: 9, end: 10 });
        expect(itemSpan({ kind: "interrupted", index: 9 }, 4)).toEqual({ start: 5, end: 6 });
    });

    it("holds one entry per tool call for a work item", () => {
        const work: CompactItem = {
            kind: "work",
            startIndex: 20,
            actions: [act, act, act],
            durationMs: 0,
            failed: 0,
            files: [],
            adds: 0,
            dels: 0,
        };
        expect(itemSpan(work, 0)).toEqual({ start: 20, end: 23 });
        expect(itemSpan(work, 10)).toEqual({ start: 10, end: 13 });
    });
});

describe("windowStart", () => {
    it("starts at the cap before there is an anchor", () => {
        expect(windowStart(messages(500), null)).toBe(300);
        expect(windowStart(messages(50), null)).toBe(0);
    });

    it("stays on the anchored item as items are added at the end", () => {
        // the first render drew items 300..499 and anchored on item 300
        expect(windowStart(messages(500), 300)).toBe(300);
        expect(windowStart(messages(520), 300)).toBe(300);
    });

    it("stays on the anchored item as items are put in front", () => {
        // 100 entries in front: every old item moves 100 places later and keeps its key
        const spans = [...Array.from({ length: 100 }, (_, i) => ({ start: i - 100, end: i - 99 })), ...messages(500)];
        expect(windowStart(spans, 300)).toBe(400);
    });

    it("holds the anchor's item when a load merged it into an earlier one", () => {
        // a run of tool calls cut by a chunk edge: the part that was drawn (keys 10..) is now the tail of keys 4..12
        const spans = [
            { start: 0, end: 4 },
            { start: 4, end: 12 },
            { start: 12, end: 13 },
        ];
        expect(windowStart(spans, 10)).toBe(1);
    });

    it("starts over for an anchor past every item", () => {
        expect(windowStart(messages(500), 9000)).toBe(300);
    });

    it("draws nothing for no items", () => {
        expect(windowStart([], null)).toBe(0);
        expect(windowStart([], 5)).toBe(0);
    });
});

describe("holdingItem", () => {
    const spans: ItemSpan[] = [
        { start: 0, end: 1 },
        { start: 1, end: 6 },
        { start: 6, end: 7 },
    ];

    it("finds the item holding an entry, a work item's middle one included", () => {
        expect(holdingItem(spans, 0)).toBe(0);
        expect(holdingItem(spans, 1)).toBe(1);
        expect(holdingItem(spans, 4)).toBe(1);
        expect(holdingItem(spans, 6)).toBe(2);
    });

    it("is -1 for an entry no item holds", () => {
        expect(holdingItem(spans, 7)).toBe(-1);
        expect(holdingItem(spans, -1)).toBe(-1);
        expect(holdingItem([], 0)).toBe(-1);
    });

    it("finds an item far back by its key after entries were put in front", () => {
        // entry 130 of the loaded array, 100 entries of which were put in front: key 30
        expect(holdingItem(messages(300), keyFor(130, 100))).toBe(30);
    });
});

describe("topAction", () => {
    it("does nothing while the top is out of view", () => {
        expect(topAction({ topInView: false, first: 40, itemCount: 240, reachedAt: null })).toBe("none");
        expect(topAction({ topInView: false, first: 0, itemCount: 240, reachedAt: null })).toBe("none");
    });

    it("does nothing for no items", () => {
        expect(topAction({ topInView: true, first: 0, itemCount: 0, reachedAt: null })).toBe("none");
    });

    it("grows the window while items are hidden above, whatever was asked before", () => {
        expect(topAction({ topInView: true, first: 40, itemCount: 240, reachedAt: null })).toBe("grow");
        expect(topAction({ topInView: true, first: 40, itemCount: 240, reachedAt: 240 })).toBe("grow");
    });

    it("asks the caller for earlier items once everything is drawn", () => {
        expect(topAction({ topInView: true, first: 0, itemCount: 240, reachedAt: null })).toBe("reach");
    });

    it("does not ask again at the same item count", () => {
        expect(topAction({ topInView: true, first: 0, itemCount: 240, reachedAt: 240 })).toBe("none");
    });

    it("asks again once the items grew and everything is drawn again", () => {
        // asked at 240; the load put 500 items in front, the window grew back to the first, and the top is in view again
        expect(topAction({ topInView: true, first: 0, itemCount: 740, reachedAt: 240 })).toBe("reach");
    });
});
