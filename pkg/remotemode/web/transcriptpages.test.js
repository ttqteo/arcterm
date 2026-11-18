import { describe, expect, it } from "vitest";
import {
    allLines,
    canLoadOlder,
    createPages,
    MAX_LINES,
    merge,
    needMore,
    prependPage,
    SCREENFUL,
} from "./static/transcriptpages.js";

const lines = (from, n) => Array.from({ length: n }, (_, i) => `line-${from + i}`);

describe("merge", () => {
    it("a first backlog sets the oldest cursor and becomes the tail", () => {
        const pages = merge(createPages(), { lines: ["a", "b"], cursor: 4096, backlog: true });
        expect(pages.tail).toEqual(["a", "b"]);
        expect(pages.history).toEqual([]);
        expect(pages.oldest).toBe(4096);
        expect(pages.start).toBe(false);
        expect(canLoadOlder(pages)).toBe(true);
    });

    it("a first backlog at cursor 0 has reached the start", () => {
        const pages = merge(createPages(), { lines: ["a"], cursor: 0, backlog: true });
        expect(pages.oldest).toBe(0);
        expect(pages.start).toBe(true);
        expect(canLoadOlder(pages)).toBe(false);
    });

    it("a resumed backlog appends to the tail and keeps the cursor and the history", () => {
        let pages = merge(createPages(), { lines: ["a", "b"], cursor: 4096, backlog: true });
        pages = prependPage(pages, { lines: ["x", "y"], cursor: 1000 });
        // the same reconnect's backlog flag and a cursor of its own must not move what is held
        pages = merge(pages, { lines: ["c"], cursor: 9999, backlog: true });
        expect(pages.tail).toEqual(["a", "b", "c"]);
        expect(pages.history).toEqual(["x", "y"]);
        expect(pages.oldest).toBe(1000);
        expect(allLines(pages)).toEqual(["x", "y", "a", "b", "c"]);
    });

    it("a chunk after the backlog appends", () => {
        let pages = merge(createPages(), { lines: ["a"], cursor: 10, backlog: true });
        pages = merge(pages, { lines: ["b", "c"], cursor: 0, backlog: false });
        pages = merge(pages, { lines: ["d"] });
        expect(pages.tail).toEqual(["a", "b", "c", "d"]);
        expect(pages.oldest).toBe(10);
    });

    it("an empty or missing lines array changes nothing", () => {
        const first = merge(createPages(), { lines: ["a"], cursor: 10, backlog: true });
        expect(merge(first, { lines: [] }).tail).toEqual(["a"]);
        expect(merge(first, {}).tail).toEqual(["a"]);
        expect(merge(first, { lines: null }).tail).toEqual(["a"]);
    });

    it("lines with no backlog before them mean nothing lies earlier", () => {
        // an empty transcript sends no backlog, and a server that sends no cursor is read the same way
        const fresh = merge(createPages(), { lines: ["a"], backlog: false });
        expect(fresh.tail).toEqual(["a"]);
        expect(fresh.start).toBe(true);
        expect(canLoadOlder(fresh)).toBe(false);
        const old = merge(createPages(), { lines: ["a"], backlog: true });
        expect(old.start).toBe(true);
    });

    it("the tail is capped at MAX_LINES and the history is left alone", () => {
        let pages = merge(createPages(), { lines: lines(0, 10), cursor: 5000, backlog: true });
        pages = prependPage(pages, { lines: ["h1", "h2", "h3"], cursor: 100 });
        pages = merge(pages, { lines: lines(10, MAX_LINES + 50) });
        expect(pages.tail).toHaveLength(MAX_LINES);
        expect(pages.tail[0]).toBe("line-60");
        expect(pages.tail[MAX_LINES - 1]).toBe(`line-${MAX_LINES + 59}`);
        expect(pages.history).toEqual(["h1", "h2", "h3"]);
        expect(pages.oldest).toBe(100);
    });

    it("never changes the pages it is given", () => {
        const before = merge(createPages(), { lines: ["a"], cursor: 10, backlog: true });
        const snapshot = JSON.stringify(before);
        merge(before, { lines: ["b"] });
        prependPage(before, { lines: ["z"], cursor: 1 });
        expect(JSON.stringify(before)).toBe(snapshot);
    });
});

describe("prependPage", () => {
    const held = () => merge(createPages(), { lines: ["d", "e"], cursor: 300, backlog: true });

    it("puts the page before what is held and moves the cursor to its start", () => {
        let pages = prependPage(held(), { lines: ["b", "c"], cursor: 120 });
        expect(allLines(pages)).toEqual(["b", "c", "d", "e"]);
        expect(pages.oldest).toBe(120);
        expect(pages.start).toBe(false);
        pages = prependPage(pages, { lines: ["a"], cursor: 40 });
        expect(allLines(pages)).toEqual(["a", "b", "c", "d", "e"]);
        expect(pages.oldest).toBe(40);
    });

    it("a page at cursor 0 reaches the start", () => {
        const pages = prependPage(held(), { lines: ["a", "b", "c"], cursor: 0 });
        expect(pages.oldest).toBe(0);
        expect(pages.start).toBe(true);
        expect(canLoadOlder(pages)).toBe(false);
    });

    it("an empty page that moved the cursor goes on", () => {
        const pages = prependPage(held(), { lines: [], cursor: 200 });
        expect(allLines(pages)).toEqual(["d", "e"]);
        expect(pages.oldest).toBe(200);
        expect(canLoadOlder(pages)).toBe(true);
    });

    it("a page that did not move the cursor ends the paging, so the loop cannot spin", () => {
        const stuck = prependPage(held(), { lines: [], cursor: 300 });
        expect(stuck.start).toBe(true);
        expect(canLoadOlder(stuck)).toBe(false);
        const bad = prependPage(held(), { lines: ["zz"], cursor: -1 });
        expect(bad.start).toBe(true);
        expect(allLines(bad)).toEqual(["d", "e"]);
        const missing = prependPage(held(), { lines: ["zz"] });
        expect(missing.start).toBe(true);
        expect(allLines(missing)).toEqual(["d", "e"]);
    });

    it("does nothing before the first backlog has set a cursor", () => {
        const pages = prependPage(createPages(), { lines: ["a"], cursor: 5 });
        expect(allLines(pages)).toEqual([]);
        expect(canLoadOlder(pages)).toBe(false);
    });
});

describe("needMore", () => {
    it("asks for more until a screenful of items is gained", () => {
        expect(SCREENFUL).toBe(20);
        expect(needMore(0)).toBe(true);
        expect(needMore(SCREENFUL - 1)).toBe(true);
        expect(needMore(SCREENFUL)).toBe(false);
        expect(needMore(SCREENFUL + 7)).toBe(false);
    });

    it("a negative or missing gain still asks for more", () => {
        expect(needMore(-3)).toBe(true);
        expect(needMore(undefined)).toBe(true);
    });
});

describe("canLoadOlder", () => {
    it("is false before any backlog and true while older lines remain", () => {
        expect(canLoadOlder(createPages())).toBe(false);
        expect(canLoadOlder(merge(createPages(), { lines: ["a"], cursor: 1, backlog: true }))).toBe(true);
    });
});
