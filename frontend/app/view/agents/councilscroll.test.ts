import { beforeEach, describe, expect, it } from "vitest";
import { clearKeptPlaces, followsEnd, keepPlace, keptPlace, placeOf, topFor } from "./councilscroll";

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
