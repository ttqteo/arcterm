// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { SidecarMessage, SidecarTile } from "./sidecartypes";
import {
    ageText,
    applyOlder,
    canAnswer,
    EMPTY_HISTORY,
    foldSlid,
    formatTileAge,
    markAsked,
    MIN_TILE_H,
    MIN_TILE_W,
    moveSelection,
    nameSizePx,
    olderRequest,
    resolveSelection,
    returnedToBottom,
    SCROLL_EDGE_PX,
    scrollEdges,
    slidOut,
    tileAgeMs,
    WALL_GAP,
    wallKey,
    wallShape,
    type TileHistory,
} from "./sidecarwallmodel";

// 1920×1080's wall area: the window less the title bar (38), the footer (28) and the wall's padding (16 / 20 a side).
const W = 1880;
const H = 982;

describe("wallShape at 1920×1080", () => {
    it("4 agents: 2×2 with about 6 messages a tile", () => {
        const s = wallShape(W, H, 4);
        expect(s).toMatchObject({ cols: 2, rows: 2, msgs: 6, scroll: false });
        expect(s.tileW).toBeCloseTo((W - WALL_GAP) / 2);
        expect(s.tileH).toBeCloseTo((H - WALL_GAP) / 2);
    });

    it("12 agents: 4×3 with 2 messages", () => {
        expect(wallShape(W, H, 12)).toMatchObject({ cols: 4, rows: 3, msgs: 2, scroll: false });
    });

    it("20 agents: 5×4 with 1 message", () => {
        expect(wallShape(W, H, 20)).toMatchObject({ cols: 5, rows: 4, msgs: 1, scroll: false });
    });

    it("no agents: an empty shape that does not scroll", () => {
        expect(wallShape(W, H, 0)).toEqual({ cols: 0, rows: 0, msgs: 1, tileW: 0, tileH: 0, scroll: false });
    });

    it("one agent fills the wall and shows the most messages", () => {
        const s = wallShape(W, H, 1);
        expect(s).toMatchObject({ cols: 1, rows: 1, msgs: 8, scroll: false });
        expect(s.tileW).toBeCloseTo(W);
        expect(s.tileH).toBeCloseTo(H);
    });

    it("40 agents: tiles stay at the floor and the wall scrolls", () => {
        const s = wallShape(W, H, 40);
        expect(s).toMatchObject({ cols: 6, rows: 7, msgs: 1, scroll: true, tileH: MIN_TILE_H });
        expect(s.tileW).toBeGreaterThanOrEqual(MIN_TILE_W);
        // the columns fill the width
        expect(s.tileW * s.cols + WALL_GAP * (s.cols - 1)).toBeCloseTo(W);
        // and more than one screen of them is what makes it scroll
        expect(s.rows * s.tileH + WALL_GAP * (s.rows - 1)).toBeGreaterThan(H);
    });

    it("keeps the grid on one screen while a tile still meets the floor", () => {
        // 30 agents fit 6×5 at 1080p with tiles of about 303×187; one more row would not
        expect(wallShape(W, H, 30)).toMatchObject({ cols: 6, rows: 5, scroll: false });
        expect(wallShape(W, H, 31).scroll).toBe(true);
    });
});

describe("wallShape on other windows", () => {
    it("the narrowest window (340×440) holds one column and scrolls past one tile", () => {
        // the window's minimum less the same chrome: 300 wide, 342 tall
        expect(wallShape(300, 342, 1)).toMatchObject({ cols: 1, rows: 1, scroll: false });
        const s = wallShape(300, 342, 3);
        expect(s).toMatchObject({ cols: 1, rows: 3, scroll: true, tileW: 300, tileH: MIN_TILE_H });
    });

    it("a narrow window of any height never makes a tile narrower than the floor", () => {
        for (const w of [300, 320, 450, 612, 700]) {
            for (const n of [1, 2, 5, 12]) {
                const s = wallShape(w, 900, n);
                expect(s.tileW).toBeGreaterThanOrEqual(MIN_TILE_W);
                expect(s.cols).toBeLessThanOrEqual(Math.floor((w + WALL_GAP) / (MIN_TILE_W + WALL_GAP)));
            }
        }
    });

    it("a wide, short window prefers columns, a narrow one rows, a middling one a square", () => {
        expect(wallShape(2400, 400, 4)).toMatchObject({ cols: 4, rows: 1 });
        // 1×4 tiles of 700×341 beat 2×2 tiles of 344×694: a tile is worth its width until it is 1.5× as wide as tall
        expect(wallShape(700, 1400, 4)).toMatchObject({ cols: 1, rows: 4 });
        expect(wallShape(320, 1400, 4)).toMatchObject({ cols: 1, rows: 4 });
        expect(wallShape(1000, 800, 4)).toMatchObject({ cols: 2, rows: 2 });
    });

    it("an area not measured yet (0×0) is the scrolling floor shape, not a crash", () => {
        expect(wallShape(0, 0, 5)).toMatchObject({ cols: 1, rows: 5, scroll: true });
    });

    it("whatever the size, a fitted wall holds every tile at or above the floor within the area", () => {
        for (const [w, h] of [
            [1880, 982],
            [1260, 700],
            [900, 640],
            [2520, 1300],
            [3800, 2000],
        ]) {
            for (let n = 1; n <= 45; n++) {
                const s = wallShape(w, h, n);
                expect(s.cols * s.rows).toBeGreaterThanOrEqual(n);
                expect(s.msgs).toBeGreaterThanOrEqual(1);
                expect(s.msgs).toBeLessThanOrEqual(8);
                if (!s.scroll) {
                    expect(s.tileW).toBeGreaterThanOrEqual(MIN_TILE_W - 1e-6);
                    expect(s.tileH).toBeGreaterThanOrEqual(MIN_TILE_H - 1e-6);
                    expect(s.cols * s.tileW + WALL_GAP * (s.cols - 1)).toBeLessThanOrEqual(w + 1e-6);
                    expect(s.rows * s.tileH + WALL_GAP * (s.rows - 1)).toBeLessThanOrEqual(h + 1e-6);
                }
            }
        }
    });

    it("messages per tile follow the tile's height, within the cap of 8", () => {
        // 2×2 at all three heights; not monotonic across shapes (a taller wall can switch to a wider grid)
        const at = (h: number) => wallShape(1880, h, 4);
        expect(at(800)).toMatchObject({ cols: 2, rows: 2, msgs: 4 });
        expect(at(982)).toMatchObject({ cols: 2, rows: 2, msgs: 6 });
        expect(at(1400)).toMatchObject({ cols: 2, rows: 2, msgs: 8 });
    });

    it("the tile name is larger when there are only a few tiles", () => {
        expect(nameSizePx(1)).toBe(16);
        expect(nameSizePx(4)).toBe(16);
        expect(nameSizePx(5)).toBe(14);
        expect(nameSizePx(20)).toBe(14);
    });
});

describe("moveSelection", () => {
    // 10 tiles on 4 columns: rows of 4, 4, 2
    it("left and right step by one, in reading order, and stop at the ends", () => {
        expect(moveSelection(5, "ArrowRight", 4, 10)).toBe(6);
        expect(moveSelection(5, "ArrowLeft", 4, 10)).toBe(4);
        expect(moveSelection(3, "ArrowRight", 4, 10)).toBe(4);
        expect(moveSelection(4, "ArrowLeft", 4, 10)).toBe(3);
        expect(moveSelection(0, "ArrowLeft", 4, 10)).toBe(0);
        expect(moveSelection(9, "ArrowRight", 4, 10)).toBe(9);
    });

    it("up and down step by one row", () => {
        expect(moveSelection(5, "ArrowUp", 4, 10)).toBe(1);
        expect(moveSelection(5, "ArrowDown", 4, 10)).toBe(9);
        expect(moveSelection(0, "ArrowDown", 4, 10)).toBe(4);
    });

    it("a move off the grid stays where it is", () => {
        expect(moveSelection(2, "ArrowUp", 4, 10)).toBe(2);
        // 6 is in column 2; below it the last row has only columns 0 and 1
        expect(moveSelection(6, "ArrowDown", 4, 10)).toBe(6);
        expect(moveSelection(9, "ArrowDown", 4, 10)).toBe(9);
    });

    it("one column is a list", () => {
        expect(moveSelection(1, "ArrowDown", 1, 3)).toBe(2);
        expect(moveSelection(2, "ArrowDown", 1, 3)).toBe(2);
        expect(moveSelection(1, "ArrowUp", 1, 3)).toBe(0);
    });

    it("no tiles, or an index past the end, comes back inside the list", () => {
        expect(moveSelection(0, "ArrowRight", 3, 0)).toBe(0);
        expect(moveSelection(12, "ArrowLeft", 3, 5)).toBe(3);
    });
});

describe("resolveSelection", () => {
    const ids = (...s: string[]) => s;

    it("keeps the selected agent by id when the order changes", () => {
        expect(resolveSelection("b", ids("a", "b", "c"), ids("c", "b", "a"))).toBe("b");
    });

    it("an agent that leaves moves the selection to the same index", () => {
        expect(resolveSelection("b", ids("a", "b", "c"), ids("a", "c"))).toBe("c");
        expect(resolveSelection("a", ids("a", "b", "c"), ids("x", "b", "c"))).toBe("x");
    });

    it("clamps to the last tile when the list got shorter than the index", () => {
        expect(resolveSelection("e", ids("a", "b", "c", "d", "e"), ids("a", "b"))).toBe("b");
    });

    it("selects the first tile when nothing was selected, and none when nothing is there", () => {
        expect(resolveSelection(null, ids(), ids("a", "b"))).toBe("a");
        expect(resolveSelection("a", ids("a"), ids())).toBeNull();
        expect(resolveSelection(null, ids(), ids())).toBeNull();
    });

    it("an id the previous list never held falls back to the first tile", () => {
        expect(resolveSelection("zzz", ids("a", "b"), ids("a", "b"))).toBe("a");
    });
});

describe("the age text", () => {
    const MIN = 60_000;
    const HOUR = 60 * MIN;

    it("formats under a minute, minutes, hours with minutes, and days", () => {
        expect(formatTileAge(0)).toBe("<1m");
        expect(formatTileAge(59_999)).toBe("<1m");
        expect(formatTileAge(MIN)).toBe("1m");
        expect(formatTileAge(33 * MIN + 20_000)).toBe("33m");
        expect(formatTileAge(HOUR)).toBe("1h");
        expect(formatTileAge(HOUR + 5 * MIN)).toBe("1h 05m");
        expect(formatTileAge(HOUR + 12 * MIN)).toBe("1h 12m");
        expect(formatTileAge(23 * HOUR + 59 * MIN)).toBe("23h 59m");
        expect(formatTileAge(24 * HOUR)).toBe("1d");
        expect(formatTileAge(24 * HOUR + 3 * HOUR + 40 * MIN)).toBe("1d 3h");
    });

    it("adds the time since the snapshot arrived to the snapshot's own now", () => {
        const now = 1_800_000_000_000;
        expect(tileAgeMs(now - 2 * MIN, now, 0)).toBe(2 * MIN);
        expect(tileAgeMs(now - 2 * MIN, now, 3 * MIN)).toBe(5 * MIN);
        expect(ageText(now - 2 * MIN, now, 0)).toBe("2m");
        expect(ageText(now - 2 * MIN, now, 30 * MIN)).toBe("32m");
    });

    it("has no age without a since, and never goes negative", () => {
        const now = 1_800_000_000_000;
        expect(ageText(undefined, now, 0)).toBe("");
        expect(tileAgeMs(now + 5000, now, 0)).toBe(0);
        expect(ageText(now + 5000, now, 0)).toBe("<1m");
        // a clock that ran backwards between the two readings adds nothing
        expect(tileAgeMs(now - MIN, now, -10_000)).toBe(MIN);
    });
});

describe("keys", () => {
    it("maps arrows, Enter and 1-9; anything else is not the wall's", () => {
        expect(wallKey("ArrowLeft")).toEqual({ kind: "move", key: "ArrowLeft" });
        expect(wallKey("ArrowDown")).toEqual({ kind: "move", key: "ArrowDown" });
        expect(wallKey("Enter")).toEqual({ kind: "open" });
        expect(wallKey("1")).toEqual({ kind: "answer", option: 0 });
        expect(wallKey("9")).toEqual({ kind: "answer", option: 8 });
        expect(wallKey("0")).toBeNull();
        expect(wallKey("a")).toBeNull();
        expect(wallKey("F11")).toBeNull();
        expect(wallKey("10")).toBeNull();
    });

    const tile = (over: Partial<SidecarTile> = {}): Pick<SidecarTile, "ask" | "sent"> => ({
        ask: { question: "Q?", options: ["A", "B", "C"], answerable: true },
        ...over,
    });

    it("answers only an answerable ask, not yet sent, with that option on it", () => {
        expect(canAnswer(tile(), 0)).toBe(true);
        expect(canAnswer(tile(), 2)).toBe(true);
        expect(canAnswer(tile(), 3)).toBe(false);
        expect(canAnswer(tile({ sent: true }), 0)).toBe(false);
        expect(canAnswer(tile({ ask: { question: "Q?", options: ["A"], answerable: false } }), 0)).toBe(false);
        expect(canAnswer({}, 0)).toBe(false);
        expect(canAnswer(undefined, 0)).toBe(false);
    });
});

const row = (say: string): SidecarMessage => ({ say });
const rows = (...says: string[]) => says.map(row);
const says = (list: readonly SidecarMessage[]) => list.map((m) => m.say);

describe("scrollEdges", () => {
    it("is at the top at 0 and at the bottom when the viewport reaches the content's end", () => {
        expect(scrollEdges(0, 100, 300)).toEqual({ top: true, bottom: false });
        expect(scrollEdges(100, 100, 300)).toEqual({ top: false, bottom: false });
        expect(scrollEdges(200, 100, 300)).toEqual({ top: false, bottom: true });
    });

    it("counts a position within the tolerance as the end, and one just past it as not", () => {
        expect(scrollEdges(SCROLL_EDGE_PX, 100, 300).top).toBe(true);
        expect(scrollEdges(SCROLL_EDGE_PX + 1, 100, 300).top).toBe(false);
        expect(scrollEdges(200 - SCROLL_EDGE_PX, 100, 300).bottom).toBe(true);
        expect(scrollEdges(200 - SCROLL_EDGE_PX - 1, 100, 300).bottom).toBe(false);
        // a fractional scrollTop (a zoomed page) still reaches the bottom
        expect(scrollEdges(199.4, 100, 300).bottom).toBe(true);
    });

    it("puts a list that does not overflow at both ends", () => {
        expect(scrollEdges(0, 200, 150)).toEqual({ top: true, bottom: true });
        expect(scrollEdges(0, 200, 200)).toEqual({ top: true, bottom: true });
    });
});

describe("a tile's history", () => {
    it("asks for the page above the snapshot's rows first (before null), once", () => {
        expect(olderRequest(undefined)).toEqual({ before: null });
        expect(olderRequest(EMPTY_HISTORY)).toEqual({ before: null });
        const out = markAsked(undefined);
        expect(out).toEqual({ ...EMPTY_HISTORY, pending: true });
        // one request per cursor: while it is out nothing more is asked
        expect(olderRequest(out)).toBeNull();
    });

    it("joins an answer's rows above the loaded ones and asks the next cursor after it", () => {
        let h = markAsked(undefined);
        h = applyOlder(h, { before: null, rows: rows("r6", "r7"), next: "m:6" });
        expect(says(h.rows)).toEqual(["r6", "r7"]);
        expect(h).toMatchObject({ before: "m:6", start: false, pending: false });
        expect(olderRequest(h)).toEqual({ before: "m:6" });
        h = applyOlder(markAsked(h), { before: "m:6", rows: rows("r4", "r5"), next: "m:4" });
        expect(says(h.rows)).toEqual(["r4", "r5", "r6", "r7"]);
        expect(olderRequest(h)).toEqual({ before: "m:4" });
    });

    it("ends at a null next: the start, and nothing more is asked", () => {
        let h = applyOlder(markAsked(undefined), { before: null, rows: rows("r0"), next: null });
        expect(says(h.rows)).toEqual(["r0"]);
        expect(h).toMatchObject({ start: true, pending: false });
        expect(olderRequest(h)).toBeNull();
        // a tile with only what the snapshot shows: an empty page that is the start
        h = applyOlder(markAsked(undefined), { before: null, rows: [], next: null });
        expect(h).toMatchObject({ rows: [], start: true });
    });

    it("drops a stale answer: none is out, or it answers another cursor", () => {
        const none = applyOlder(undefined, { before: null, rows: rows("x"), next: "m:1" });
        expect(none).toEqual(EMPTY_HISTORY);
        const out = markAsked({ ...EMPTY_HISTORY, rows: rows("r6"), before: "m:6" });
        const stale = applyOlder(out, { before: "m:9", rows: rows("x"), next: "m:3" });
        expect(stale).toBe(out);
        // an answer applied once is not applied again by a duplicate
        const done = applyOlder(out, { before: "m:6", rows: rows("r5"), next: "m:5" });
        expect(applyOlder(done, { before: "m:6", rows: rows("r5"), next: "m:5" })).toBe(done);
        expect(says(done.rows)).toEqual(["r5", "r6"]);
    });

    it("an empty answer with a cursor changes nothing but lets the same cursor be asked again", () => {
        const h = applyOlder(markAsked({ ...EMPTY_HISTORY, before: "m:6" }), { before: "m:6", rows: [], next: "m:6" });
        expect(h).toMatchObject({ rows: [], before: "m:6", pending: false, start: false });
    });
});

describe("slidOut and foldSlid", () => {
    const eight = rows("r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8");

    it("finds the rows that left the top when new rows arrived at the bottom", () => {
        expect(says(slidOut(eight, rows("r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9")))).toEqual(["r1"]);
        expect(says(slidOut(eight, rows("r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10")))).toEqual(["r1", "r2"]);
    });

    it("sees the slide although the last row changed in place (a tool row that got its result)", () => {
        const prev: SidecarMessage[] = [
            ...rows("r1", "r2", "r3", "r4", "r5", "r6", "r7"),
            { tool: { verb: "Bash", target: "go test" } },
        ];
        const next: SidecarMessage[] = [
            ...rows("r2", "r3", "r4", "r5", "r6", "r7"),
            { tool: { verb: "Bash", target: "go test", outcome: "ok" } },
            row("r9"),
        ];
        expect(says(slidOut(prev, next))).toEqual(["r1"]);
    });

    it("finds nothing when the window did not move, or the rows do not line up", () => {
        expect(slidOut(eight, eight)).toEqual([]);
        expect(slidOut(eight, rows("a", "b", "c", "d", "e", "f", "g", "h"))).toEqual([]);
        expect(slidOut([], eight)).toEqual([]);
        expect(slidOut(eight, [])).toEqual([]);
        expect(slidOut(rows("r1", "r2"), rows("r2", "r3"))).toEqual([]);
    });

    it("takes a window that only grew, or that changed only in its last row, for no slide (even a repeating transcript)", () => {
        const ab = rows("a", "b", "a", "b", "a", "b", "a");
        const growing = [...ab, row("b")];
        expect(slidOut(ab, growing)).toEqual([]);
        const prev: SidecarMessage[] = [...ab, { tool: { verb: "Read", target: "x" } }];
        const next: SidecarMessage[] = [...ab, { tool: { verb: "Read", target: "x", outcome: "ok" } }];
        expect(slidOut(prev, next)).toEqual([]);
        expect(slidOut(growing, growing)).toEqual([]);
    });

    it("does not take one repeated row for a slide", () => {
        const prev = rows("same", "x", "y", "z");
        expect(slidOut(prev, rows("same", "q", "w", "e"))).toEqual([]);
    });

    it("appends the rows to a history that has loaded rows, and leaves one without alone", () => {
        const h: TileHistory = { ...EMPTY_HISTORY, rows: rows("r-1", "r0"), before: "m:3" };
        expect(says(foldSlid(h, rows("r1")).rows)).toEqual(["r-1", "r0", "r1"]);
        expect(foldSlid(h, [])).toBe(h);
        expect(foldSlid(EMPTY_HISTORY, rows("r1"))).toBe(EMPTY_HISTORY);
    });
});

describe("returnedToBottom", () => {
    it("is the user arriving at the bottom, not a list that stayed there", () => {
        expect(returnedToBottom(false, true)).toBe(true);
        expect(returnedToBottom(true, true)).toBe(false);
        expect(returnedToBottom(false, false)).toBe(false);
        expect(returnedToBottom(true, false)).toBe(false);
    });
});
