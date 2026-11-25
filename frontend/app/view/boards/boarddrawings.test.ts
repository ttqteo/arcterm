import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import {
    afterLanding,
    askedDrawing,
    drawingData,
    drawingInView,
    drawingNumber,
    drawingShapes,
    drawingViewport,
    drawingsOf,
    isFollowing,
    isFrame,
    rowState,
    type BoardDrawings,
    type Drawing,
    type ViewRect,
} from "./boarddrawings";

function el(id: string, type: string, x: number, y: number, w: number, h: number, extra: object = {}) {
    return { id, type, x, y, width: w, height: h, isDeleted: false, frameId: null, ...extra } as ExcalidrawElement;
}

function frame(id: string, x: number, y: number, w: number, h: number, n: number | null, name: string | null) {
    return el(id, "frame", x, y, w, h, { name, customData: n == null ? undefined : { arcDrawing: n } });
}

describe("isFrame, drawingNumber, drawingData", () => {
    it("reads a drawing's number from customData and writes the same shape", () => {
        expect(isFrame(frame("f", 0, 0, 1, 1, 3, "x"))).toBe(true);
        expect(isFrame(el("r", "rectangle", 0, 0, 1, 1))).toBe(false);
        expect(drawingNumber(frame("f", 0, 0, 1, 1, 3, "x"))).toBe(3);
        expect(drawingNumber(frame("hand", 0, 0, 1, 1, null, "x"))).toBeNull();
        expect(drawingNumber(el("r", "rectangle", 0, 0, 1, 1))).toBeNull();
        expect(drawingNumber(el("odd", "frame", 0, 0, 1, 1, { customData: { arcDrawing: "2" } }))).toBeNull();
        expect(drawingNumber(el("n", "frame", 0, 0, 1, 1, { customData: drawingData(7) }))).toBe(7);
    });
});

describe("drawingsOf", () => {
    it("drawingsOf lists live frames by number, hand frames after in element order", () => {
        const els = [
            frame("hand-b", 0, 900, 10, 10, null, "Mine"),
            frame("d2", 500, 0, 300, 200, 2, "Second"),
            el("r", "rectangle", 0, 0, 10, 10),
            frame("gone", 0, 0, 10, 10, 5, "Deleted"),
            frame("d1", 0, 0, 400, 250, 1, "First"),
            frame("hand-a", 0, 1200, 10, 10, null, null),
        ];
        (els[3] as any).isDeleted = true;
        const drawings = drawingsOf(els);
        expect(drawings.map((d) => d.id)).toEqual(["d1", "d2", "hand-b", "hand-a"]);
        expect(drawings[0]).toEqual({
            id: "d1",
            n: 1,
            title: "First",
            bounds: { minX: 0, minY: 0, maxX: 400, maxY: 250 },
        });
        expect(drawings[1]).toMatchObject({ n: 2, title: "Second" });
        // hand frames number on after the highest drawing
        expect(drawings[2]).toMatchObject({ n: 3, title: "Mine" });
        expect(drawings[3]).toMatchObject({ n: 4, title: "" });
        expect(drawingsOf([el("r", "rectangle", 0, 0, 10, 10)])).toEqual([]);
    });
});

function drawing(id: string, n: number, minX: number, minY: number, maxX: number, maxY: number): Drawing {
    return { id, n, title: id, bounds: { minX, minY, maxX, maxY } };
}

// a view showing scene x in [x, x + width/zoom], y in [y, y + height/zoom]
function view(x: number, y: number, zoom = 1, width = 1000, height = 600): ViewRect {
    return { scrollX: -x, scrollY: -y, zoom, width, height };
}

describe("drawingInView", () => {
    const d1 = drawing("d1", 1, 0, 0, 800, 500);
    const d2 = drawing("d2", 2, 900, 0, 1500, 400);

    it.each([
        ["the drawing covering most of the view", view(0, 0), "d1"],
        ["the other when it covers more", view(700, 0), "d2"],
        ["the newest when zoomed inside it", view(1000, 100, 4), "d2"],
        ["an earlier one when zoomed inside it", view(100, 100, 4), "d1"],
        ["null when no frame is visible", view(0, 2000), null],
    ])("drawingInView returns %s", (_, rect, want) => {
        expect(drawingInView([d1, d2], rect)).toBe(want);
    });

    it("drawingInView prefers the newer of overlapping drawings that cover the view alike", () => {
        const outer = drawing("outer", 1, 0, 0, 2000, 2000);
        const inner = drawing("inner", 2, 500, 500, 1500, 1500);
        expect(drawingInView([outer, inner], view(600, 600, 2))).toBe("inner");
        expect(drawingInView([], view(0, 0))).toBeNull();
    });
});

describe("askedDrawing", () => {
    const els = [
        el("a", "rectangle", 0, 0, 10, 10, { frameId: "f1" }),
        el("a-label", "text", 0, 0, 10, 10, { frameId: "f1", containerId: "a" }),
        el("b", "rectangle", 0, 0, 10, 10, { frameId: "f1" }),
        frame("f1", 0, 0, 100, 100, 1, "One"),
        el("c", "rectangle", 200, 0, 10, 10, { frameId: "f2" }),
        frame("f2", 200, 0, 100, 100, 2, "Two"),
        el("loose", "rectangle", 500, 0, 10, 10),
        el("orphan", "rectangle", 0, 0, 10, 10, { frameId: "f-gone" }),
        el("gone", "rectangle", 0, 0, 10, 10, { frameId: "f2", isDeleted: true }),
    ];

    it.each([
        ["shapes inside one drawing name it", ["a", "a-label", "b"], "f1"],
        ["a selected frame names itself", ["f2", "c"], "f2"],
        ["a selection across drawings leaves the one in view", ["a", "c"], "f9"],
        ["a loose shape leaves the one in view", ["a", "loose"], "f9"],
        ["a shape whose frame is gone leaves the one in view", ["orphan"], "f9"],
        ["deleted and unknown ids are ignored", ["c", "gone", "missing"], "f2"],
        ["no selection leaves the one in view", [], "f9"],
    ])("askedDrawing: %s", (_, selected, want) => {
        expect(askedDrawing(els, selected, "f9")).toBe(want);
    });
});

describe("drawingShapes", () => {
    const els = [
        el("a", "rectangle", 0, 0, 10, 10, { frameId: "f1" }),
        el("a-label", "text", 0, 0, 10, 10, { frameId: "f1", containerId: "a" }),
        frame("f1", 0, 0, 100, 100, 1, "One"),
        el("c", "rectangle", 200, 0, 10, 10, { frameId: "f2" }),
        frame("f2", 200, 0, 100, 100, 2, "Two"),
        el("loose", "rectangle", 500, 0, 10, 10),
        el("gone", "rectangle", 0, 0, 10, 10, { frameId: "f1", isDeleted: true }),
    ];

    it("drawingShapes returns a drawing's live children, its frame and other drawings' shapes left out", () => {
        expect(drawingShapes(els, "f1").map((s) => s.id)).toEqual(["a", "a-label"]);
        expect(drawingShapes(els, "f2").map((s) => s.id)).toEqual(["c"]);
    });

    it("drawingShapes is empty for a frame with no children or an id that is not a frame", () => {
        expect(drawingShapes([frame("f1", 0, 0, 1, 1, 1, "One")], "f1")).toEqual([]);
        expect(drawingShapes(els, "nope")).toEqual([]);
    });
});

describe("drawingViewport", () => {
    // Excalidraw maps a scene point to the view as (point + scroll) * zoom
    function centreOnView(d: Drawing, vp: { zoom: number; scrollX: number; scrollY: number }, w: number, h: number) {
        const cx = (d.bounds.minX + d.bounds.maxX) / 2;
        const cy = (d.bounds.minY + d.bounds.maxY) / 2;
        return [(cx + vp.scrollX) * vp.zoom, (cy + vp.scrollY) * vp.zoom, w / 2, h / 2];
    }

    it("fits a wide drawing in a narrow view below 1, whole and centred", () => {
        const d = drawing("wide", 1, 100, 50, 2100, 550); // 2000 x 500
        const vp = drawingViewport(d, 800, 600);
        expect(vp.zoom).toBeCloseTo(0.9 * (800 / 2000), 10);
        expect(vp.zoom).toBeLessThan(0.7); // no READ_ZOOM floor: the whole drawing, narrow cell included
        const [x, y, wantX, wantY] = centreOnView(d, vp, 800, 600);
        expect(x).toBeCloseTo(wantX, 6);
        expect(y).toBeCloseTo(wantY, 6);
    });

    it("fits a tall drawing by its height", () => {
        const d = drawing("tall", 1, 0, 0, 300, 1500);
        expect(drawingViewport(d, 1000, 600).zoom).toBeCloseTo(0.9 * (600 / 1500), 10);
    });

    it("keeps a small drawing at 1 and centred", () => {
        const d = drawing("small", 1, 400, 200, 600, 300); // 200 x 100
        const vp = drawingViewport(d, 1000, 600);
        expect(vp.zoom).toBe(1);
        const [x, y, wantX, wantY] = centreOnView(d, vp, 1000, 600);
        expect(x).toBeCloseTo(wantX, 6);
        expect(y).toBeCloseTo(wantY, 6);
    });

    it("never divides by a zero-size drawing", () => {
        const vp = drawingViewport(drawing("dot", 1, 5, 5, 5, 5), 800, 600);
        expect(vp.zoom).toBe(1);
        expect(Number.isFinite(vp.scrollX) && Number.isFinite(vp.scrollY)).toBe(true);
    });
});

describe("isFollowing", () => {
    const d1 = drawing("d1", 1, 0, 0, 800, 500);
    const d2 = drawing("d2", 2, 900, 0, 1500, 400);

    it("isFollowing is true with no drawings, whatever is in view", () => {
        expect(isFollowing([], null)).toBe(true);
        expect(isFollowing([], "gone")).toBe(true);
    });

    it("isFollowing is true when the newest drawing is in view and false on an earlier one or none", () => {
        expect(isFollowing([d1, d2], "d2")).toBe(true);
        expect(isFollowing([d1, d2], "d1")).toBe(false);
        expect(isFollowing([d1, d2], null)).toBe(false);
        expect(isFollowing([d1], "d1")).toBe(true);
    });
});

describe("rowState", () => {
    const d1 = drawing("d1", 1, 0, 0, 800, 500);
    const d2 = drawing("d2", 2, 900, 0, 1500, 400);
    const d3 = drawing("d3", 3, 1600, 0, 2000, 400);
    const row = (over: Partial<BoardDrawings> = {}): BoardDrawings => ({
        drawings: [
            { id: "d1", n: 1, title: "d1" },
            { id: "d2", n: 2, title: "d2" },
        ],
        inView: "d2",
        fresh: [],
        selected: null,
        ...over,
    });

    it("rowState builds the first row from the drawings, the one in view and the selected", () => {
        expect(rowState(null, [d1, d2], "d1", "d2")).toEqual(row({ inView: "d1", selected: "d2" }));
        expect(rowState(null, [], null, null)).toEqual({ drawings: [], inView: null, fresh: [], selected: null });
    });

    it("rowState returns prev itself when nothing changed", () => {
        const prev = row({ fresh: ["d1"], inView: "d2" });
        expect(rowState(prev, [d1, d2], "d2", null)).toBe(prev);
    });

    it("rowState returns a new row when the drawing in view, a title, the selection or the list changes", () => {
        const prev = row();
        expect(rowState(prev, [d1, d2], "d1", null)).not.toBe(prev);
        expect(rowState(prev, [d1, d2], "d2", "d1")).toMatchObject({ selected: "d1" });
        expect(rowState(prev, [d1, { ...d2, title: "renamed" }], "d2", null).drawings[1].title).toBe("renamed");
        expect(rowState(prev, [d1, d2, d3], "d2", null).drawings.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    });

    it("rowState drops the drawing now in view from fresh", () => {
        const prev = row({ fresh: ["d1", "d2"], inView: "d1" });
        const next = rowState(prev, [d1, d2], "d2", null);
        expect(next.fresh).toEqual(["d1"]);
        expect(next).not.toBe(prev);
    });

    it("rowState drops gone drawings from fresh and keeps the others in order", () => {
        const prev = row({ fresh: ["d3", "d2", "gone"], inView: "d1" });
        expect(rowState(prev, [d1, d2, d3], "d1", null).fresh).toEqual(["d3", "d2"]);
        expect(rowState(prev, [d1, d2], "d1", null).fresh).toEqual(["d2"]);
    });

    it("rowState keeps the same fresh array contents when prev had none", () => {
        const prev = row({ fresh: [] });
        expect(rowState(prev, [d1, d2], "d2", null)).toBe(prev);
    });
});

describe("afterLanding", () => {
    const d1 = drawing("d1", 1, 0, 0, 800, 500);
    const d2 = drawing("d2", 2, 900, 0, 1500, 400);
    const d3 = drawing("d3", 3, 1600, 0, 2000, 400);

    it("afterLanding fits a new drawing while following", () => {
        expect(afterLanding(["d1", "d2"], true, "d2", [d1, d2, d3], undefined)).toEqual({ fit: "d3", fresh: null });
    });

    it("afterLanding marks a new drawing fresh while on an earlier one, and fits nothing", () => {
        expect(afterLanding(["d1", "d2"], false, "d1", [d1, d2, d3], undefined)).toEqual({ fit: null, fresh: "d3" });
    });

    it("afterLanding fits the first drawing of an empty board, which follows", () => {
        expect(afterLanding([], true, null, [d1], undefined)).toEqual({ fit: "d1", fresh: null });
    });

    it("afterLanding refits an edit of the drawing in view", () => {
        expect(afterLanding(["d1", "d2"], false, "d1", [d1, d2], "d1")).toEqual({ fit: "d1", fresh: null });
        expect(afterLanding(["d1", "d2"], true, "d2", [d1, d2], "d2")).toEqual({ fit: "d2", fresh: null });
    });

    it("afterLanding leaves the view alone for an edit of a drawing out of view", () => {
        expect(afterLanding(["d1", "d2"], true, "d2", [d1, d2], "d1")).toEqual({ fit: null, fresh: null });
    });

    it("afterLanding does nothing when no drawing was added and none edited", () => {
        expect(afterLanding(["d1", "d2"], true, "d2", [d1, d2], undefined)).toEqual({ fit: null, fresh: null });
        expect(afterLanding(["d1", "d2"], false, null, [d1, d2], undefined)).toEqual({ fit: null, fresh: null });
    });

    it("afterLanding treats a new drawing as new even when the answer names an edited id", () => {
        // an edit whose frame was gone lands new: the answer names the old id, the drawing is another
        expect(afterLanding(["d1", "d2"], true, "d2", [d1, d2, d3], "d2")).toEqual({ fit: "d3", fresh: null });
        expect(afterLanding(["d1", "d2"], false, "d2", [d1, d2, d3], "d2")).toEqual({ fit: null, fresh: "d3" });
    });
});
