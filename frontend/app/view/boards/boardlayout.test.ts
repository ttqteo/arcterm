import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { tidyDrawing, tidyFrame } from "./boardlayout";

const NOW = new Date(2026, 10, 26, 16, 0).getTime();

function base(id: string, type: string, x: number, y: number, w: number, h: number, extra: object = {}) {
    return {
        id,
        type,
        x,
        y,
        width: w,
        height: h,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: 1,
        version: 1,
        versionNonce: 1,
        index: null,
        isDeleted: false,
        groupIds: [],
        frameId: "f1",
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        ...extra,
    } as unknown as ExcalidrawElement;
}

function rect(id: string, x: number, y: number, extra: object = {}) {
    return base(id, "rectangle", x, y, 120, 60, extra);
}

function label(id: string, container: string, x: number, y: number) {
    return base(id, "text", x, y, 60, 25, { text: id, originalText: id, containerId: container });
}

function arrow(id: string, from: string, to: string, extra: object = {}) {
    return base(id, "arrow", 0, 0, 100, 0, {
        points: [
            [0, 0],
            [100, 0],
        ],
        startBinding: { elementId: from, focus: 0, gap: 8 },
        endBinding: { elementId: to, focus: 0, gap: 8 },
        ...extra,
    });
}

function frame(id: string, x: number, y: number, w: number, h: number, n: number) {
    return base(id, "frame", x, y, w, h, { frameId: null, name: `drawing ${n}`, customData: { arcDrawing: n } });
}

function byId(els: readonly ExcalidrawElement[]) {
    return new Map(els.map((el) => [el.id, el]));
}

function overlaps(a: ExcalidrawElement, b: ExcalidrawElement): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("tidyDrawing", () => {
    it("leaves a missing drawing, or one with fewer than two shapes, alone", () => {
        const one = [rect("a", 0, 0), frame("f1", -40, -40, 200, 140, 1)];
        expect(tidyDrawing(one, "nope", NOW)).toBeNull();
        expect(tidyDrawing(one, "f1", NOW)).toBeNull();
    });

    it("lays a chain out along its flow, keeps the top-left corner, and fits the frame", () => {
        // c drawn left of a, b on top of c: a → b → c reads backwards and overlaps
        const els = [
            rect("a", 300, 100),
            rect("b", 20, 130),
            rect("c", 0, 100),
            arrow("ab", "a", "b"),
            arrow("bc", "b", "c"),
            frame("f1", -40, 60, 500, 170, 1),
        ];
        const out = byId(tidyDrawing(els, "f1", NOW));
        const [a, b, c] = ["a", "b", "c"].map((id) => out.get(id));
        expect(a.x).toBeLessThan(b.x);
        expect(b.x).toBeLessThan(c.x);
        expect(overlaps(a, b) || overlaps(b, c) || overlaps(a, c)).toBe(false);
        // the drawing's top-left corner stays where it was
        expect(Math.min(a.x, b.x, c.x)).toBe(0);
        expect(Math.min(a.y, b.y, c.y)).toBe(100);
        const f = out.get("f1");
        expect(f.x).toBe(-40);
        expect(f.y).toBe(60);
        expect(f.x + f.width).toBe(c.x + c.width + 40);
        expect(f.version).toBe(2);
        // a new versionNonce on every moved element, which is how Excalidraw's undo tells a change
        expect(["a", "b", "c", "f1"].every((id) => out.get(id).versionNonce !== 1)).toBe(true);
    });

    it("routes each arrow from its start shape's outline to its end shape's", () => {
        const els = [rect("a", 0, 0), rect("b", 0, 200), arrow("ab", "a", "b"), frame("f1", -40, -40, 200, 340, 1)];
        // a straight down arrow: top down flow
        els[2] = arrow("ab", "a", "b", {
            points: [
                [0, 0],
                [0, 140],
            ],
            width: 0,
            height: 140,
        });
        const out = byId(tidyDrawing(els, "f1", NOW));
        const [a, b, ab] = ["a", "b", "ab"].map((id) => out.get(id)) as (ExcalidrawElement & {
            points: [number, number][];
        })[];
        expect(b.y).toBeGreaterThan(a.y + a.height);
        const end = ab.points[ab.points.length - 1];
        expect(ab.y).toBeGreaterThan(a.y + a.height);
        expect(ab.y + end[1]).toBeLessThan(b.y);
    });

    it("moves a box's label with it and puts an arrow's label on the arrow", () => {
        const els = [
            rect("a", 400, 0, { boundElements: [{ type: "text", id: "a-label" }] }),
            label("a-label", "a", 430, 17),
            rect("b", 0, 0),
            arrow("ab", "a", "b", { boundElements: [{ type: "text", id: "ab-label" }] }),
            label("ab-label", "ab", 200, 0),
            frame("f1", -40, -40, 600, 140, 1),
        ];
        const out = byId(tidyDrawing(els, "f1", NOW));
        const a = out.get("a");
        const aLabel = out.get("a-label");
        expect(aLabel.x - a.x).toBe(30);
        expect(aLabel.y - a.y).toBe(17);
        const ab = out.get("ab") as ExcalidrawElement & { points: [number, number][] };
        const abLabel = out.get("ab-label");
        const xs = ab.points.map((p) => ab.x + p[0]);
        const mid = abLabel.x + abLabel.width / 2;
        expect(mid).toBeGreaterThan(Math.min(...xs));
        expect(mid).toBeLessThan(Math.max(...xs));
    });

    it("keeps two crossing arrows from crossing", () => {
        // a over b on the left, c over d on the right; a → d and b → c cross
        const els = [
            rect("a", 0, 0),
            rect("b", 0, 200),
            rect("c", 400, 0),
            rect("d", 400, 200),
            arrow("ad", "a", "d"),
            arrow("bc", "b", "c"),
            frame("f1", -40, -40, 600, 340, 1),
        ];
        const out = byId(tidyDrawing(els, "f1", NOW));
        const above = (p: string, q: string) => out.get(p).y < out.get(q).y;
        expect(above("a", "b")).toBe(above("d", "c"));
    });

    it("moves a group as one, and loose text with the shape it was nearest", () => {
        const els = [
            rect("a", 300, 0),
            rect("g1", 0, 0, { groupIds: ["chart"] }),
            base("g2", "line", 10, 70, 100, 0, {
                groupIds: ["chart"],
                points: [
                    [0, 0],
                    [100, 0],
                ],
            }),
            base("note", "text", 300, 70, 80, 20, { text: "note", originalText: "note" }),
            arrow("ga", "g1", "a"),
            frame("f1", -40, -40, 500, 170, 1),
        ];
        const before = byId(els);
        const out = byId(tidyDrawing(els, "f1", NOW));
        const d = (id: string) => [out.get(id).x - before.get(id).x, out.get(id).y - before.get(id).y];
        expect(d("g2")).toEqual(d("g1"));
        expect(d("note")).toEqual(d("a"));
    });

    it("moves the drawings to its right over by what its frame grew, and none to its left", () => {
        const els = [
            rect("a", 0, 0),
            rect("b", 10, 10),
            arrow("ab", "a", "b"),
            frame("f1", -40, -40, 220, 150, 1),
            rect("left", -400, 0, { frameId: "f0" }),
            frame("f0", -440, -40, 200, 140, 0),
            rect("right", 300, 0, { frameId: "f2" }),
            frame("f2", 260, -40, 200, 140, 2),
        ];
        const out = byId(tidyDrawing(els, "f1", NOW));
        const f1 = out.get("f1");
        const grew = f1.x + f1.width - 180;
        expect(grew).toBeGreaterThan(0);
        expect(out.get("f2").x).toBe(260 + grew);
        expect(out.get("right").x).toBe(300 + grew);
        expect(out.get("f0").x).toBe(-440);
        expect(out.get("left")).toBe(els[4]);
    });
});

describe("tidyFrame", () => {
    const before = [
        rect("a", 300, 0),
        rect("b", 0, 0),
        arrow("ab", "a", "b", {
            x: 300,
            y: 30,
            points: [
                [0, 0],
                [-180, 0],
            ],
        }),
        frame("f1", -40, -40, 500, 140, 1),
    ];
    const after = tidyDrawing(before, "f1", NOW);

    it("starts where the drawing was and ends at the tidy, in the versions before it", () => {
        const start = byId(tidyFrame(before, after, 0));
        const end = byId(tidyFrame(before, after, 1));
        const tidy = byId(after);
        expect(start.get("a").x).toBe(300);
        expect(end.get("a").x).toBe(tidy.get("a").x);
        expect(end.get("a").version).toBe(1);
    });

    it("slides a shape half-way at the middle, and draws an arrow straight between its sliding ends", () => {
        const mid = byId(tidyFrame(before, after, 0.5));
        const tidy = byId(after);
        expect(mid.get("a").x).toBe((300 + tidy.get("a").x) / 2);
        const ab = mid.get("ab") as ExcalidrawElement & { points: [number, number][] };
        expect(ab.points).toHaveLength(2);
        expect(ab.points[0]).toEqual([0, 0]);
    });
});
