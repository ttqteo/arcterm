import { beforeEach, describe, expect, it } from "vitest";
import {
    NO_PILLS,
    clearKeptPlaces,
    followsEnd,
    glideAt,
    glideMs,
    jumpPills,
    keepPlace,
    keptPlace,
    placeOf,
    readingRow,
    returnTop,
    stillLanded,
    topFor,
} from "./councilscroll";

const box = (scrollTop: number, scrollHeight = 2000, clientHeight = 500) => ({ scrollTop, scrollHeight, clientHeight });

beforeEach(clearKeptPlaces);

describe("placeOf", () => {
    it("is at the bottom within 80px of the end, else an offset", () => {
        expect(placeOf(box(1500))).toEqual({ top: 1500, bottom: true });
        expect(placeOf(box(1421))).toEqual({ top: 1421, bottom: true });
        expect(placeOf(box(1420))).toEqual({ top: 1420, bottom: false });
        expect(placeOf(box(300))).toEqual({ top: 300, bottom: false });
    });
});

describe("topFor", () => {
    it("puts a reader who was at the bottom at the end, however much came since", () => {
        expect(topFor({ top: 1500, bottom: true }, box(0, 3000), true)).toBe(2500);
    });

    it("puts a reader who scrolled up back at their offset, clamped to the end", () => {
        expect(topFor({ top: 300, bottom: false }, box(0), true)).toBe(300);
        expect(topFor({ top: 300, bottom: false }, box(0), false)).toBe(300);
        expect(topFor({ top: 1800, bottom: false }, box(0), false)).toBe(1500);
    });

    it("with nothing kept, starts a following scroller at the end and any other at the top", () => {
        expect(topFor(undefined, box(0), true)).toBe(1500);
        expect(topFor(undefined, box(0), false)).toBe(0);
        expect(topFor(undefined, box(0, 300), true)).toBe(0);
    });
});

describe("followsEnd", () => {
    it("follows new lines only in a following scroller the reader has not scrolled up in", () => {
        expect(followsEnd(undefined, true)).toBe(true);
        expect(followsEnd({ top: 1500, bottom: true }, true)).toBe(true);
        expect(followsEnd({ top: 300, bottom: false }, true)).toBe(false);
        expect(followsEnd(undefined, false)).toBe(false);
        expect(followsEnd({ top: 1500, bottom: true }, false)).toBe(false);
    });
});

describe("keepPlace", () => {
    it("keeps each key's place, the latest write winning", () => {
        keepPlace("channel:c1", { top: 10, bottom: false });
        keepPlace("channel:c2", { top: 20, bottom: true });
        keepPlace("channel:c1", { top: 30, bottom: false });
        expect(keptPlace("channel:c1")).toEqual({ top: 30, bottom: false });
        expect(keptPlace("channel:c2")).toEqual({ top: 20, bottom: true });
        expect(keptPlace("summary:c1")).toBeUndefined();
    });

    it("drops the least recently kept past 60 places", () => {
        for (let i = 0; i < 61; i++) {
            keepPlace(`channel:c${i}`, { top: i, bottom: false });
        }
        expect(keptPlace("channel:c0")).toBeUndefined();
        expect(keptPlace("channel:c1")).toEqual({ top: 1, bottom: false });
        expect(keptPlace("channel:c60")).toEqual({ top: 60, bottom: false });
    });
});

describe("readingRow", () => {
    const rows = [
        { top: 0, bottom: 100 },
        { top: 116, bottom: 400 },
        { top: 416, bottom: 500 },
    ];

    it("is the first row still showing more than a sliver below the view's top", () => {
        expect(readingRow(rows, 0)).toBe(0);
        expect(readingRow(rows, 50)).toBe(0);
        expect(readingRow(rows, 90)).toBe(1);
        expect(readingRow(rows, 300)).toBe(1);
        expect(readingRow(rows, 380)).toBe(2);
    });

    it("is -1 past every row", () => {
        expect(readingRow(rows, 490)).toBe(-1);
        expect(readingRow([], 0)).toBe(-1);
    });
});

describe("returnTop", () => {
    it("puts the row back where it sat in the view, though rows above it grew", () => {
        // the row sat 40px above the view's top at 1200; it has since moved down by 100
        expect(returnTop({ offset: -40, top: 1200 }, 1260, box(0))).toBe(1300);
        expect(returnTop({ offset: 10, top: 800 }, 810, box(0))).toBe(800);
    });

    it("falls back to the scrollTop when the row is gone, and clamps to the scroller", () => {
        expect(returnTop({ offset: 0, top: 700 }, null, box(0))).toBe(700);
        expect(returnTop({ offset: 0, top: 1900 }, null, box(0))).toBe(1500);
        expect(returnTop({ offset: 50, top: 0 }, 20, box(0))).toBe(0);
    });
});

describe("stillLanded", () => {
    it("is on the top while within 80px of it, on the latest while at the end", () => {
        expect(stillLanded("top", box(0))).toBe(true);
        expect(stillLanded("top", box(79))).toBe(true);
        expect(stillLanded("top", box(80))).toBe(false);
        expect(stillLanded("latest", box(1500))).toBe(true);
        expect(stillLanded("latest", box(1000))).toBe(false);
        expect(stillLanded(null, box(0))).toBe(false);
    });
});

describe("jumpPills", () => {
    it("offers Top past a screen down and Latest off the end", () => {
        expect(jumpPills(box(0), null)).toEqual({ top: false, latest: true, back: false });
        expect(jumpPills(box(500), null)).toEqual({ top: false, latest: true, back: false });
        expect(jumpPills(box(501), null)).toEqual({ top: true, latest: true, back: false });
        expect(jumpPills(box(1500), null)).toEqual({ top: true, latest: false, back: false });
        expect(jumpPills(box(0, 400), null)).toEqual(NO_PILLS);
    });

    it("offers Back while the saved place is more than half a screen away", () => {
        expect(jumpPills(box(0), 1200).back).toBe(true);
        expect(jumpPills(box(1500), 1200).back).toBe(true);
        expect(jumpPills(box(1000), 1200).back).toBe(false);
        expect(jumpPills(box(1250), 1000).back).toBe(false);
    });
});

describe("glideMs", () => {
    it("is quick for a short hop and capped for a long one", () => {
        expect(glideMs(0)).toBe(220);
        expect(glideMs(-1000)).toBe(260);
        expect(glideMs(100_000)).toBe(450);
    });
});

describe("glideAt", () => {
    it("starts at from, ends at to, and is past halfway at half time", () => {
        expect(glideAt(1000, 0, 0)).toBe(1000);
        expect(glideAt(1000, 0, 1)).toBe(0);
        expect(glideAt(0, 1000, 0.5)).toBeGreaterThan(500);
        expect(glideAt(0, 1000, 2)).toBe(1000);
    });
});
