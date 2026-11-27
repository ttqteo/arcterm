// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    boardParts,
    lerpViewport,
    MAX_PARTS,
    needsParts,
    partAt,
    partOnView,
    partViewport,
    READ_ZOOM,
    stepPart,
    viewToScene,
    type BoardPart,
    type PartElement,
} from "./boardparts";

function el(id: string, x: number, y: number, w = 100, h = 50, more: Partial<PartElement> = {}): PartElement {
    return { id, type: "rectangle", x, y, width: w, height: h, ...more };
}

function text(id: string, x: number, y: number, words: string, more: Partial<PartElement> = {}): PartElement {
    return el(id, x, y, 200, 30, { type: "text", text: words, ...more });
}

describe("boardParts", () => {
    it("clusters shapes that sit close and names each by its top-most text", () => {
        const parts = boardParts([
            text("t1", 0, 0, "Harness\nfive parts"),
            el("a", 0, 40),
            el("b", 120, 40),
            text("t2", 1000, 0, "Benchmark"),
            el("c", 1000, 40),
        ]);
        expect(parts.map((p) => p.label)).toEqual(["Harness", "Benchmark"]);
        expect(parts[0]).toMatchObject({ x: 0, y: 0, w: 220, h: 90 });
    });

    it("reads a container's bound label as its text and skips the bound text as a shape", () => {
        const parts = boardParts([
            el("box", 0, 0),
            text("label", 10, 10, "4 contributions", { containerId: "box" }),
            el("far", 2000, 0),
            text("far-t", 2000, -40, "Motivation"),
        ]);
        expect(parts.map((p) => p.label)).toEqual(["4 contributions", "Motivation"]);
    });

    it("lists a part's shapes, their labels and the arrows tied to them", () => {
        const parts = boardParts([
            el("a", 0, 0),
            text("a-label", 10, 10, "first", { containerId: "a" }),
            el("b", 120, 0),
            el("c", 1000, 0),
            el("tie", 100, 25, 900, 0, {
                type: "arrow",
                startBinding: { elementId: "b" },
                endBinding: { elementId: "c" },
            }),
            el("loose", 1020, 10, 40, 0, { type: "line" }),
        ]);
        expect(parts).toHaveLength(2);
        expect([...parts[0].ids].sort()).toEqual(["a", "a-label", "b", "tie"]);
        expect([...parts[1].ids].sort()).toEqual(["c", "loose", "tie"]);
    });

    it("lists what a frame part's frame holds", () => {
        const parts = boardParts([
            el("f1", 0, 0, 400, 300, { type: "frame", name: "Harness" }),
            el("f2", 800, 0, 400, 300, { type: "frame", name: "Benchmark" }),
            el("in1", 2000, 2000, 100, 50, { frameId: "f1" }),
            el("in2", 820, 20, 100, 50, { frameId: "f2" }),
        ]);
        expect(parts.map((p) => p.ids)).toEqual([["in1"], ["in2"]]);
    });

    it("lets no arrow or line join two parts", () => {
        const parts = boardParts([
            el("a", 0, 0),
            el("b", 1000, 0),
            el("arrow", 100, 25, 900, 0, { type: "arrow" }),
            el("line", 100, 25, 900, 0, { type: "line" }),
        ]);
        expect(parts).toHaveLength(2);
    });

    it("prefers two or more frames, named and in reading order", () => {
        const parts = boardParts([
            el("f2", 800, 0, 400, 300, { type: "frame", name: "Benchmark" }),
            el("f1", 0, 0, 400, 300, { type: "frame", name: "Harness" }),
            el("f3", 0, 500, 400, 300, { type: "frame", name: null }),
            el("a", 5000, 5000),
        ]);
        expect(parts.map((p) => [p.id, p.label])).toEqual([
            ["f1", "Harness"],
            ["f2", "Benchmark"],
            ["f3", "Part 3"],
        ]);
    });

    it("reads rows top to bottom and left to right within a row", () => {
        const parts = boardParts([
            text("c", 0, 1000, "third"),
            text("b", 1000, 20, "second"),
            text("a", 0, 0, "first"),
        ]);
        expect(parts.map((p) => p.label)).toEqual(["first", "second", "third"]);
    });

    it("widens the gap until there are at most MAX_PARTS", () => {
        // four regions far apart, each of five groups 150px apart: 20 parts until the gap passes 150, then 4
        const many = Array.from({ length: 4 }, (_, r) =>
            Array.from({ length: 5 }, (_, g) => el(`e${r}-${g}`, r * 3000 + g * 250, 0))
        ).flat();
        expect(MAX_PARTS).toBeLessThan(20);
        expect(boardParts(many)).toHaveLength(4);
    });

    it("has no parts for one cluster, one shape, an empty or deleted board", () => {
        expect(boardParts([el("a", 0, 0), el("b", 120, 0)])).toEqual([]);
        expect(boardParts([el("a", 0, 0)])).toEqual([]);
        expect(boardParts([])).toEqual([]);
        expect(boardParts([el("a", 0, 0), el("b", 3000, 0, 100, 50, { isDeleted: true })])).toEqual([]);
    });

    it("cuts a long title and names a part with no text by its place", () => {
        const parts = boardParts([
            text("t", 0, 0, "a title that runs on far past what a label can hold"),
            el("x", 2000, 0),
        ]);
        expect(parts[0].label.length).toBeLessThanOrEqual(32);
        expect(parts[0].label.endsWith("…")).toBe(true);
        expect(parts[1].label).toBe("Part 2");
    });
});

describe("partViewport", () => {
    const part: BoardPart = { id: "p", label: "p", x: 100, y: 200, w: 400, h: 300, ids: [] };

    it("shows a small part whole and centred, never above 1:1", () => {
        const vp = partViewport(part, 1000, 800);
        expect(vp.zoom).toBe(1);
        const at = partOnView(part, vp);
        expect(at.left + at.width / 2).toBeCloseTo(500);
        expect(at.top + at.height / 2).toBeCloseTo(400);
    });

    it("keeps a tall part at the reading zoom, its top in view", () => {
        const tall = { ...part, h: 3000 };
        const vp = partViewport(tall, 1000, 800);
        expect(vp.zoom).toBe(READ_ZOOM);
        expect(partOnView(tall, vp).top).toBeCloseTo(40);
    });

    it("keeps a part wider than the view at the reading zoom too, its left edge in view", () => {
        const wide = { ...part, w: 4000, h: 300 };
        const vp = partViewport(wide, 1000, 800);
        expect(vp.zoom).toBe(READ_ZOOM);
        const at = partOnView(wide, vp);
        expect(at.left).toBeCloseTo(40);
        expect(at.top + at.height / 2).toBeCloseTo(400);
    });
});

describe("stepPart", () => {
    it("steps and wraps, and enters from the whole board at either end", () => {
        expect(stepPart(5, null, 1)).toBe(0);
        expect(stepPart(5, null, -1)).toBe(4);
        expect(stepPart(5, 4, 1)).toBe(0);
        expect(stepPart(5, 0, -1)).toBe(4);
        expect(stepPart(0, null, 1)).toBeNull();
    });
});

describe("lerpViewport", () => {
    it("starts at from, ends at to, and zooms geometrically between", () => {
        const from = { zoom: 0.25, scrollX: 0, scrollY: 0 };
        const to = { zoom: 1, scrollX: -300, scrollY: -100 };
        const start = lerpViewport(from, to, 0, 1000, 800);
        const end = lerpViewport(from, to, 1, 1000, 800);
        expect(start.zoom).toBeCloseTo(0.25);
        expect(start.scrollX).toBeCloseTo(0);
        expect(end.zoom).toBeCloseTo(1);
        expect(end.scrollX).toBeCloseTo(-300);
        expect(end.scrollY).toBeCloseTo(-100);
        expect(lerpViewport(from, to, 0.5, 1000, 800).zoom).toBeCloseTo(0.5);
    });
});

describe("partAt", () => {
    const parts: BoardPart[] = [
        { id: "big", label: "big", x: 0, y: 0, w: 1000, h: 1000, ids: [] },
        { id: "inner", label: "inner", x: 100, y: 100, w: 200, h: 200, ids: [] },
        { id: "far", label: "far", x: 3000, y: 0, w: 100, h: 100, ids: [] },
    ];
    it("finds the smallest part holding the point, and none over empty board", () => {
        expect(partAt(parts, 150, 150)).toBe(1);
        expect(partAt(parts, 500, 500)).toBe(0);
        expect(partAt(parts, 3050, 50)).toBe(2);
        expect(partAt(parts, 2000, 50)).toBeNull();
        expect(partAt([], 0, 0)).toBeNull();
    });
});

describe("viewToScene", () => {
    it("inverts partOnView", () => {
        const vp = { zoom: 0.3, scrollX: 120, scrollY: -40 };
        const part: BoardPart = { id: "p", label: "p", x: 500, y: 700, w: 10, h: 10, ids: [] };
        const at = partOnView(part, vp);
        const back = viewToScene(vp, at.left, at.top);
        expect(back.x).toBeCloseTo(500);
        expect(back.y).toBeCloseTo(700);
    });
});

describe("needsParts", () => {
    const a: BoardPart = { id: "a", label: "a", x: 0, y: 0, w: 200, h: 100, ids: [] };
    it("is false for a board that reads whole, or one part", () => {
        expect(needsParts([a, { ...a, id: "b", x: 400 }], 1000, 800)).toBe(false);
        expect(needsParts([a], 1000, 800)).toBe(false);
    });
    it("is true once the parts span more than the view at the reading zoom", () => {
        expect(needsParts([a, { ...a, id: "b", x: 3000 }], 1000, 800)).toBe(true);
        expect(needsParts([a, { ...a, id: "b", y: 3000 }], 1000, 800)).toBe(true);
    });
});
