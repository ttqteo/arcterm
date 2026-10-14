import { describe, expect, it } from "vitest";
import {
    SUGGEST_AFTER_DAYS,
    boardCountLabel,
    cardMeta,
    cleanupGroups,
    groupByDay,
    initialSelection,
    isSuggested,
    moveCursor,
    previewStale,
    searchCanvases,
    selectionTotal,
    stepIndex,
    type GalleryCanvas,
} from "./canvasgallery";

const DAY = 24 * 60 * 60 * 1000;
// a local time, so the day boundaries below are local midnights whatever zone the test runs in
const NOW = new Date(2026, 9, 14, 13, 37, 0).getTime();
const MIDNIGHT = new Date(2026, 9, 14, 0, 0, 0, 0).getTime();
const YESTERDAY = new Date(2026, 9, 13, 0, 0, 0, 0).getTime();

function canvas(over: Partial<GalleryCanvas> = {}): GalleryCanvas {
    return {
        topic: "gallery",
        project: "D:/work/arcterm",
        projectname: "arcterm",
        designdir: "D:/work/arcterm/.superpowers/design",
        dir: "D:/work/arcterm/.superpowers/design/gallery",
        boards: ["Main"],
        modts: NOW,
        thumbts: NOW,
        bytes: 1000,
        ...over,
    };
}

describe("groupByDay", () => {
    it("splits at local midnight, newest first inside a group", () => {
        const older = canvas({ topic: "older", modts: MIDNIGHT + 1000 });
        const newer = canvas({ topic: "newer", modts: NOW });
        const lastNight = canvas({ topic: "last-night", modts: MIDNIGHT - 1 });
        const yesterdayStart = canvas({ topic: "yesterday-start", modts: YESTERDAY });
        const dayBefore = canvas({ topic: "day-before", modts: YESTERDAY - 1 });
        const groups = groupByDay([older, dayBefore, lastNight, newer, yesterdayStart], NOW);
        expect(groups.map((g) => [g.key, g.label, g.items.map((c) => c.topic)])).toEqual([
            ["today", "Today", ["newer", "older"]],
            ["yesterday", "Yesterday", ["last-night", "yesterday-start"]],
            ["earlier", "Earlier", ["day-before"]],
        ]);
    });

    it("drops a group with no items", () => {
        const groups = groupByDay([canvas({ modts: YESTERDAY - 5 * DAY })], NOW);
        expect(groups.map((g) => g.key)).toEqual(["earlier"]);
        expect(groupByDay([], NOW)).toEqual([]);
    });

    it("counts a board dated after now (clock skew) as today", () => {
        const groups = groupByDay([canvas({ modts: NOW + 3 * DAY })], NOW);
        expect(groups.map((g) => g.key)).toEqual(["today"]);
    });
});

describe("searchCanvases", () => {
    const items = [
        canvas({ topic: "canvas-gallery", boards: ["Main", "Viewer"], projectname: "arcterm" }),
        canvas({ topic: "settings-sync", boards: ["Overview"], projectname: "notes" }),
    ];

    it("returns everything for a blank query", () => {
        expect(searchCanvases(items, "")).toEqual(items);
        expect(searchCanvases(items, "   ")).toEqual(items);
    });

    it("matches the topic, a board name and the project name, ignoring case", () => {
        expect(searchCanvases(items, "GALLERY").map((c) => c.topic)).toEqual(["canvas-gallery"]);
        expect(searchCanvases(items, "viewer").map((c) => c.topic)).toEqual(["canvas-gallery"]);
        expect(searchCanvases(items, "Notes").map((c) => c.topic)).toEqual(["settings-sync"]);
    });

    it("matches nothing for text in none of them", () => {
        expect(searchCanvases(items, "settings sync")).toEqual([]);
    });

    it("does not read the folder path or the board file extension", () => {
        expect(searchCanvases(items, "superpowers")).toEqual([]);
        expect(searchCanvases(items, "dc.html")).toEqual([]);
    });
});

describe("isSuggested", () => {
    it("leaves a canvas exactly 30 days old and suggests one 1 ms older", () => {
        expect(SUGGEST_AFTER_DAYS).toBe(30);
        expect(isSuggested(canvas({ modts: NOW - 30 * DAY }), NOW)).toBe(false);
        expect(isSuggested(canvas({ modts: NOW - 30 * DAY - 1 }), NOW)).toBe(true);
        expect(isSuggested(canvas({ modts: NOW }), NOW)).toBe(false);
    });
});

describe("cleanup helpers", () => {
    const fresh = canvas({ topic: "fresh", dir: "d/fresh", modts: NOW - DAY, bytes: 300 });
    const stale = canvas({ topic: "stale", dir: "d/stale", modts: NOW - 40 * DAY, bytes: 5000 });
    const staler = canvas({ topic: "staler", dir: "d/staler", modts: NOW - 90 * DAY, bytes: 7000 });

    it("splits the suggested canvases from the newer ones, each newest first", () => {
        const { suggested, newer } = cleanupGroups([staler, fresh, stale], NOW);
        expect(suggested.map((c) => c.topic)).toEqual(["stale", "staler"]);
        expect(newer.map((c) => c.topic)).toEqual(["fresh"]);
    });

    it("starts with the suggested dirs selected", () => {
        expect(initialSelection([fresh, stale, staler], NOW)).toEqual(new Set(["d/stale", "d/staler"]));
        expect(initialSelection([fresh], NOW)).toEqual(new Set());
    });

    it("totals the selected canvases and ignores a dir that is no longer listed", () => {
        const sel = new Set(["d/stale", "d/staler", "d/gone"]);
        expect(selectionTotal([fresh, stale, staler], sel)).toEqual({ count: 2, bytes: 12000 });
        expect(selectionTotal([fresh, stale, staler], new Set())).toEqual({ count: 0, bytes: 0 });
    });
});

describe("previewStale", () => {
    it("is stale with no preview, an older one, and fresh only when the preview is not older than the board", () => {
        expect(previewStale({ modts: 1000, thumbts: 0 })).toBe(true);
        expect(previewStale({ modts: 1000, thumbts: 999 })).toBe(true);
        expect(previewStale({ modts: 1000, thumbts: 1000 })).toBe(false);
        expect(previewStale({ modts: 1000, thumbts: 2000 })).toBe(false);
    });
});

describe("cardMeta", () => {
    it("shows the time for today and the date before", () => {
        expect(cardMeta(canvas({ modts: NOW }), NOW)).toBe("arcterm · 13:37");
        expect(cardMeta(canvas({ modts: new Date(2026, 9, 14, 9, 5).getTime() }), NOW)).toBe("arcterm · 09:05");
        expect(cardMeta(canvas({ modts: new Date(2026, 9, 13, 23, 59).getTime() }), NOW)).toBe("arcterm · 13 Oct");
        expect(cardMeta(canvas({ modts: new Date(2026, 7, 2, 10, 0).getTime() }), NOW)).toBe("arcterm · 2 Aug");
    });
});

describe("boardCountLabel", () => {
    it("is singular for one board only", () => {
        expect(boardCountLabel(0)).toBe("0 boards");
        expect(boardCountLabel(1)).toBe("1 board");
        expect(boardCountLabel(6)).toBe("6 boards");
    });
});

describe("stepIndex", () => {
    it("wraps both ways", () => {
        expect(stepIndex(3, 0, 1)).toBe(1);
        expect(stepIndex(3, 2, 1)).toBe(0);
        expect(stepIndex(3, 0, -1)).toBe(2);
        expect(stepIndex(3, 1, -1)).toBe(0);
    });

    it("stays on 0 when there is nothing to step through", () => {
        expect(stepIndex(0, 0, 1)).toBe(0);
        expect(stepIndex(1, 0, 1)).toBe(0);
    });
});

describe("moveCursor", () => {
    // seven cards in rows of three: 0 1 2 / 3 4 5 / 6
    it("moves by one sideways and by a row up and down", () => {
        expect(moveCursor(7, 3, 4, "ArrowLeft")).toBe(3);
        expect(moveCursor(7, 3, 4, "ArrowRight")).toBe(5);
        expect(moveCursor(7, 3, 4, "ArrowUp")).toBe(1);
        expect(moveCursor(7, 3, 1, "ArrowDown")).toBe(4);
    });

    it("clamps at the edges instead of wrapping", () => {
        expect(moveCursor(7, 3, 0, "ArrowLeft")).toBe(0);
        expect(moveCursor(7, 3, 6, "ArrowRight")).toBe(6);
        expect(moveCursor(7, 3, 1, "ArrowUp")).toBe(1);
        expect(moveCursor(7, 3, 6, "ArrowDown")).toBe(6);
    });

    it("goes down onto a short last row's last card, and stays once on the last row", () => {
        expect(moveCursor(7, 3, 4, "ArrowDown")).toBe(6);
        expect(moveCursor(7, 3, 5, "ArrowDown")).toBe(6);
        expect(moveCursor(6, 3, 4, "ArrowDown")).toBe(4);
    });

    it("stays on 0 with no cards, and pulls a stale index into range", () => {
        expect(moveCursor(0, 3, 0, "ArrowRight")).toBe(0);
        expect(moveCursor(0, 3, 5, "ArrowDown")).toBe(0);
        expect(moveCursor(4, 3, 9, "ArrowLeft")).toBe(2);
    });
});
