import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import {
    BoardFileError,
    NUNITO,
    applyAnswer,
    needsNunito,
    nunitoTextIds,
    parseBoardFile,
    selectionLabel,
    serializeBoard,
    shapeCount,
    withReadableFont,
    wrapEarlier,
    type BoardScene,
} from "./boardmodel";

const NOW = new Date(2026, 10, 12, 16, 4).getTime();

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
        frameId: null,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        ...extra,
    } as unknown as ExcalidrawElement;
}

function rect(id: string, x: number, y: number, w: number, h: number, extra: object = {}) {
    return base(id, "rectangle", x, y, w, h, extra);
}

function text(id: string, x: number, y: number, t: string, extra: object = {}) {
    return base(id, "text", x, y, t.length * 10, 20, {
        text: t,
        originalText: t,
        fontSize: 20,
        fontFamily: 5,
        textAlign: "left",
        verticalAlign: "top",
        containerId: null,
        autoResize: true,
        lineHeight: 1.25,
        ...extra,
    });
}

function emptyScene(elements: ExcalidrawElement[] = []): BoardScene {
    return { arc: { name: "Startup flow", createdts: 1 }, elements, appState: {}, files: {} };
}

// a box with a bound label, as Excalidraw links them both ways
function labelled(id: string, x: number, y: number, label: string): ExcalidrawElement[] {
    return [
        rect(id, x, y, 200, 80, { boundElements: [{ type: "text", id: `${id}-label` }] }),
        text(`${id}-label`, x + 60, y + 30, label, {
            containerId: id,
            textAlign: "center",
            verticalAlign: "middle",
        }),
    ];
}

const userNote = text("user-note", 0, 0, "my note");
const userRect = rect("user-rect", 0, 40, 100, 60);

function drawnOnce(): BoardScene {
    return emptyScene([userNote, userRect, ...labelled("box", 200, 0, "wavesrv")]);
}

describe("parseBoardFile / serializeBoard", () => {
    it("round-trips and keeps arc as the first key", () => {
        const scene = drawnOnce();
        const textOut = serializeBoard(scene);
        expect(Object.keys(JSON.parse(textOut))[0]).toBe("arc");
        expect(textOut.indexOf('"arc"')).toBeLessThan(textOut.indexOf('"elements"'));
        const back = parseBoardFile(textOut);
        expect(back.arc).toEqual(JSON.parse(JSON.stringify(scene.arc)));
        expect(back.elements).toEqual(JSON.parse(JSON.stringify(scene.elements)));
    });

    it("drops deleted elements when saving", () => {
        const scene = emptyScene([userRect, { ...userNote, isDeleted: true } as ExcalidrawElement]);
        expect(parseBoardFile(serializeBoard(scene)).elements.map((el) => el.id)).toEqual(["user-rect"]);
    });

    it("refuses a damaged file", () => {
        const good = serializeBoard(drawnOnce());
        expect(() => parseBoardFile(good.slice(0, good.length - 40))).toThrow(BoardFileError);
        expect(() => parseBoardFile("[]")).toThrow(BoardFileError);
        expect(() => parseBoardFile('{"type":"excalidraw","elements":[]}')).toThrow(/no arc record/);
        expect(() => parseBoardFile('{"arc":{"name":"x"},"elements":{}}')).toThrow(/elements/);
    });

    it("reads a file with no elements, appState or files as an empty board", () => {
        const scene = parseBoardFile('{"arc":{"name":"x","createdts":1}}');
        expect(scene).toMatchObject({ elements: [], appState: {}, files: {} });
    });
});

function answer(extra: Partial<BoardAnswer> = {}): BoardAnswer {
    return { id: "ans1", project: "arcterm", boardid: "0a1b2c3d", turnid: "turn1", ts: NOW, ...extra };
}

// an edit of drawing d1, so the tests below see the answer land as it is, unmoved
function edit(extra: Partial<BoardAnswer> = {}): BoardAnswer {
    return answer({ drawingid: "d1", ...extra });
}

function byId(scene: BoardScene, id: string): any {
    return scene.elements.find((el) => el.id === id);
}

function frameEl(id: string, x: number, y: number, w: number, h: number, n: number | null, name: string) {
    return base(id, "frame", x, y, w, h, { name, customData: n == null ? undefined : { arcDrawing: n } });
}

function framesOf(scene: BoardScene): any[] {
    return scene.elements.filter((el) => el.type === "frame" && !el.isDeleted);
}

// a board whose shapes are all drawing d1, its children before it as Excalidraw orders them
function inDrawing(elements: ExcalidrawElement[]): BoardScene {
    const children = elements.map((el) => ({ ...el, frameId: "d1" }) as ExcalidrawElement);
    return emptyScene([...children, frameEl("d1", -40, -40, 2000, 2000, 1, "First")]);
}

function boundsOf(els: readonly any[]) {
    const pts = els.flatMap((el) =>
        el.points
            ? el.points.map(([px, py]: number[]) => [el.x + px, el.y + py])
            : [
                  [el.x, el.y],
                  [el.x + el.width, el.y + el.height],
              ]
    );
    return {
        minX: Math.min(...pts.map((p: number[]) => p[0])),
        minY: Math.min(...pts.map((p: number[]) => p[1])),
        maxX: Math.max(...pts.map((p: number[]) => p[0])),
        maxY: Math.max(...pts.map((p: number[]) => p[1])),
    };
}

function expectInside(frame: any, els: readonly any[]) {
    const b = boundsOf(els);
    expect(b.minX).toBeGreaterThanOrEqual(frame.x);
    expect(b.minY).toBeGreaterThanOrEqual(frame.y);
    expect(b.maxX).toBeLessThanOrEqual(frame.x + frame.width);
    expect(b.maxY).toBeLessThanOrEqual(frame.y + frame.height);
}

describe("applyAnswer", () => {
    it("adds the converted shapes", () => {
        const scene = inDrawing(labelled("wavesrv", 0, 0, "wavesrv"));
        const added = labelled("db", 0, 200, "SQLite");
        const { scene: next, shapeIds, textIds } = applyAnswer(scene, edit({ add: "[]" }), added, NOW);
        expect(next.elements.map((el) => el.id)).toEqual(["wavesrv", "wavesrv-label", "db", "db-label", "d1"]);
        // the bound label is part of its box: Show selects the box
        expect(shapeIds).toEqual(["db"]);
        expect(textIds).toEqual([]);
        expect(scene.elements).toHaveLength(3);
    });

    it("patches an update and bumps its version", () => {
        const scene = inDrawing([rect("a", 0, 0, 100, 40), text("note", 0, 100, "old")]);
        const update = JSON.stringify([
            { id: "a", x: 10, width: 150, strokeColor: "#e03131", backgroundColor: "#ffc9c9" },
            { id: "note", text: "new words" },
        ]);
        const { scene: next, shapeIds, textIds } = applyAnswer(scene, edit({ update }), [], NOW);
        const a = byId(next, "a");
        expect(a).toMatchObject({
            x: 10,
            y: 0,
            width: 150,
            height: 40,
            strokeColor: "#e03131",
            backgroundColor: "#ffc9c9",
            version: 2,
            updated: NOW,
        });
        expect(byId(next, "note")).toMatchObject({ text: "new words", originalText: "new words", version: 2 });
        expect(shapeIds).toEqual(["a", "note"]);
        expect(textIds).toEqual(["note"]);
    });

    it("moves a container's bound text with it", () => {
        const scene = inDrawing(labelled("wavesrv", 0, 0, "wavesrv"));
        const update = JSON.stringify([{ id: "wavesrv", x: 100, y: 50 }]);
        const { scene: next, shapeIds } = applyAnswer(scene, edit({ update }), [], NOW);
        expect(byId(next, "wavesrv")).toMatchObject({ x: 100, y: 50 });
        expect(byId(next, "wavesrv-label")).toMatchObject({ x: 160, y: 80, version: 2 });
        expect(shapeIds).toEqual(["wavesrv"]);
    });

    it("sets a label on the container's bound text", () => {
        const scene = inDrawing([...labelled("wavesrv", 0, 0, "wavesrv"), rect("bare", 300, 0, 100, 40)]);
        const update = JSON.stringify([
            { id: "wavesrv", label: "wavesrv (Go)" },
            { id: "bare", label: "store" },
        ]);
        const { scene: next, shapeIds, textIds } = applyAnswer(scene, edit({ update }), [], NOW);
        expect(byId(next, "wavesrv-label")).toMatchObject({
            text: "wavesrv (Go)",
            originalText: "wavesrv (Go)",
            version: 2,
        });
        // a box with no label gets one, bound both ways
        const made = next.elements.find((el) => el.type === "text" && (el as any).containerId === "bare") as any;
        expect(made).toMatchObject({ text: "store", originalText: "store", isDeleted: false });
        expect(byId(next, "bare").boundElements).toEqual([{ type: "text", id: made.id }]);
        expect(shapeIds).toEqual(["wavesrv", "bare"]);
        expect(textIds).toEqual(["wavesrv-label", made.id]);
    });

    it("removes a shape with its bound text", () => {
        const scene = inDrawing([...labelled("wavesrv", 0, 0, "wavesrv"), rect("keep", 300, 0, 100, 40)]);
        const { scene: next, shapeIds } = applyAnswer(scene, edit({ remove: ["wavesrv"] }), [], NOW);
        expect(byId(next, "wavesrv")).toMatchObject({ isDeleted: true, version: 2 });
        expect(byId(next, "wavesrv-label")).toMatchObject({ isDeleted: true, version: 2 });
        expect(byId(next, "keep").isDeleted).toBe(false);
        expect(shapeIds).toEqual([]);
    });

    it("skips ids the board no longer has", () => {
        const gone = rect("gone", 0, 0, 100, 40, { isDeleted: true });
        const mine = rect("mine", 0, 200, 100, 40);
        const scene = inDrawing([gone, mine]);
        const update = JSON.stringify([
            { id: "gone", x: 50 },
            { id: "missing", label: "x" },
        ]);
        const { scene: next, shapeIds } = applyAnswer(
            scene,
            edit({ update, remove: ["missing", "gone"] }),
            [rect("added", 0, 400, 100, 40)],
            NOW
        );
        expect(byId(next, "gone")).toBe(byId(scene, "gone"));
        expect(byId(next, "mine")).toBe(byId(scene, "mine"));
        expect(next.elements.map((el) => el.id)).toEqual(["gone", "mine", "added", "d1"]);
        expect(shapeIds).toEqual(["added"]);
    });

    it("refuses an update that is not a list", () => {
        expect(() => applyAnswer(emptyScene(), answer({ update: '{"id":"a"}' }), [], NOW)).toThrow(/not a list/);
    });
});

// an arrow as convertToExcalidrawElements leaves one bound to existing shapes: a 100px stub where its x, y put it
function arrow(id: string, x: number, y: number, start: string | null, end: string | null, extra: object = {}) {
    return base(id, "arrow", x, y, 99, 0, {
        points: [
            [0, 0],
            [99, 0],
        ],
        startBinding: start ? { elementId: start, focus: 0.4, gap: 1 } : null,
        endBinding: end ? { elementId: end, focus: 0.4, gap: 20 } : null,
        elbowed: false,
        ...extra,
    });
}

function ends(el: any): [number, number][] {
    return [el.points[0], el.points[el.points.length - 1]].map(([px, py]) => [el.x + px, el.y + py]);
}

// distance from a point to a box's outline, negative inside
function outside([x, y]: [number, number], b: any): number {
    const dx = Math.max(b.x - x, x - (b.x + b.width));
    const dy = Math.max(b.y - y, y - (b.y + b.height));
    return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
}

describe("applyAnswer arrow routing", () => {
    it("lays an added arrow between the shapes it binds", () => {
        const a = rect("a", 0, 0, 200, 80);
        const b = rect("b", 600, 400, 200, 80);
        const scene = inDrawing([a, b]);
        const stub = arrow("ab", 200, 40, "a", "b", { boundElements: [{ type: "text", id: "ab-label" }] });
        const label = text("ab-label", 230, 30, "calls", { containerId: "ab" });
        const { scene: next } = applyAnswer(scene, edit({ add: "[]" }), [stub, label], NOW);
        const routed = byId(next, "ab");
        const [start, end] = ends(routed);
        expect(outside(start, a)).toBeGreaterThan(0);
        expect(outside(start, a)).toBeLessThan(20);
        expect(outside(end, b)).toBeGreaterThan(0);
        expect(outside(end, b)).toBeLessThan(20);
        expect(routed.width).toBeCloseTo(Math.abs(end[0] - start[0]));
        expect(routed.height).toBeCloseTo(Math.abs(end[1] - start[1]));
        // the label sits on the arrow's middle
        const l = byId(next, "ab-label");
        expect(l.x + l.width / 2).toBeCloseTo((start[0] + end[0]) / 2);
        expect(l.y + l.height / 2).toBeCloseTo((start[1] + end[1]) / 2);
    });

    it("re-routes an arrow whose shape the answer moves, and leaves other arrows alone", () => {
        const a = rect("a", 0, 0, 200, 80);
        const b = rect("b", 300, 0, 200, 80);
        const c = rect("c", 0, 300, 200, 80);
        const ab = arrow("ab", 200, 40, "a", "b");
        const ac = arrow("ac", 100, 80, "a", "c");
        const scene = inDrawing([a, b, c, ab, ac]);
        const update = JSON.stringify([{ id: "b", x: 300, y: 500 }]);
        const { scene: next, shapeIds } = applyAnswer(scene, edit({ update }), [], NOW);
        const [, end] = ends(byId(next, "ab"));
        expect(outside(end, byId(next, "b"))).toBeGreaterThan(0);
        expect(outside(end, byId(next, "b"))).toBeLessThan(20);
        expect(byId(next, "ab").version).toBe(2);
        expect(byId(next, "ac")).toBe(byId(scene, "ac"));
        expect(shapeIds).toEqual(["b"]);
    });

    it("keeps an arrow's free end where it was", () => {
        const a = rect("a", 0, 0, 200, 80);
        const free = arrow("free", 500, 300, "a", null);
        const { scene: next } = applyAnswer(inDrawing([a]), edit({ add: "[]" }), [free], NOW);
        const [start, end] = ends(byId(next, "free"));
        expect(end).toEqual([599, 300]);
        expect(outside(start, a)).toBeGreaterThan(0);
        expect(outside(start, a)).toBeLessThan(20);
    });

    it("leaves an arrow between overlapping shapes as drawn", () => {
        const a = rect("a", 0, 0, 200, 80);
        const b = rect("b", 50, 20, 200, 80);
        const ab = arrow("ab", 200, 40, "a", "b");
        const { scene: next } = applyAnswer(inDrawing([a, b]), edit({ add: "[]" }), [ab], NOW);
        // left as drawn, though landing in the drawing sets its frameId
        expect(byId(next, "ab")).toMatchObject({ x: ab.x, y: ab.y, points: (ab as any).points, version: 1 });
    });
});

describe("applyAnswer drawings", () => {
    it("lands a new drawing on an empty board as frame 1 at the origin, holding every added shape", () => {
        const added = [...labelled("api", 300, 200, "api"), rect("db", 300, 400, 100, 40)];
        const { scene: next, drawingId } = applyAnswer(
            emptyScene(),
            answer({ add: "[]", title: "Request flow" }),
            added,
            NOW
        );
        const frames = framesOf(next);
        expect(frames).toHaveLength(1);
        const [f] = frames;
        expect(f).toMatchObject({ id: drawingId, name: "Request flow", customData: { arcDrawing: 1 }, x: 0, y: 0 });
        const children = ["api", "api-label", "db"].map((id) => byId(next, id));
        expect(children.map((c) => c.frameId)).toEqual([f.id, f.id, f.id]);
        expectInside(f, children);
        // excalidraw keeps a frame after its children
        expect(next.elements[next.elements.length - 1].id).toBe(f.id);
    });

    it("lands a new drawing numbered max+1, right of every shape and top-aligned with the topmost", () => {
        const scene = emptyScene([
            rect("a", 0, 0, 200, 80, { frameId: "d3" }),
            frameEl("d3", -20, -50, 600, 300, 3, "Third"),
            rect("loose", 900, 100, 100, 100),
        ]);
        const { scene: next, drawingId } = applyAnswer(
            scene,
            answer({ add: "[]", title: "Next" }),
            [rect("n1", -500, -500, 100, 40), rect("n2", -500, -300, 100, 40)],
            NOW
        );
        const f = byId(next, drawingId);
        expect(framesOf(next)).toHaveLength(2);
        expect(f).toMatchObject({ name: "Next", customData: { arcDrawing: 4 }, y: -50 });
        // everything on the board ends at x 1000 (the loose rectangle); the frame starts 120 right of that
        expect(f.x).toBe(1120);
        expectInside(f, [byId(next, "n1"), byId(next, "n2")]);
        // the drawing keeps its own layout
        expect(byId(next, "n2").y - byId(next, "n1").y).toBe(200);
        expect(byId(next, "loose")).toBe(scene.elements[2]);
    });

    it("lands an edit in the named drawing, growing it to hold the new shapes", () => {
        const scene = emptyScene([
            rect("a", 0, 0, 200, 80, { frameId: "d1" }),
            frameEl("d1", -20, -20, 240, 120, 1, "First"),
            rect("b", 400, 0, 100, 40, { frameId: "d2" }),
            frameEl("d2", 380, -20, 140, 80, 2, "Second"),
        ]);
        const { scene: next, drawingId } = applyAnswer(
            scene,
            edit({ add: "[]", title: "Ignored" }),
            labelled("z", 0, 300, "cache"),
            NOW
        );
        expect(drawingId).toBe("d1");
        expect(framesOf(next).map((f) => f.id)).toEqual(["d1", "d2"]);
        const d1 = byId(next, "d1");
        expect(d1).toMatchObject({ name: "First", version: 2 });
        expect(byId(next, "z")).toMatchObject({ x: 0, y: 300, frameId: "d1" });
        expect(byId(next, "z-label").frameId).toBe("d1");
        expectInside(d1, [byId(next, "a"), byId(next, "z"), byId(next, "z-label")]);
        const ids = next.elements.map((el) => el.id);
        expect(ids.indexOf("z-label")).toBeLessThan(ids.indexOf("d1"));
        expect(byId(next, "d2")).toBe(scene.elements[3]);
    });

    it("deletes a whole drawing when an edit removes its shapes and its frame", () => {
        const scene = emptyScene([
            rect("a", 0, 0, 200, 80, { frameId: "d1" }),
            frameEl("d1", -20, -20, 240, 120, 1, "First"),
            rect("b", 400, 0, 100, 40, { frameId: "d2" }),
            frameEl("d2", 380, -20, 140, 80, 2, "Second"),
        ]);
        const { scene: next, shapeIds } = applyAnswer(scene, edit({ remove: ["a", "d1"], title: "First, gone" }), [], NOW);
        expect(byId(next, "a").isDeleted).toBe(true);
        expect(byId(next, "d1").isDeleted).toBe(true);
        expect(framesOf(next).map((f) => f.id)).toEqual(["d2"]);
        expect(byId(next, "d2")).toBe(scene.elements[3]);
        expect(shapeIds).toEqual([]);
    });

    it("fits an edited drawing's frame to its text as measured", () => {
        const scene = emptyScene([
            text("note", 0, 0, "short", { frameId: "d1" }),
            frameEl("d1", -40, -40, 130, 100, 1, "First"),
        ]);
        const update = JSON.stringify([{ id: "note", text: "a much longer note than before" }]);
        // stands in for Excalidraw's measuring: the changed text comes out 400 wide and 60 tall
        const measureText = (els: readonly ExcalidrawElement[], ids: readonly string[]) =>
            els.map((el) => (ids.includes(el.id) ? ({ ...el, width: 400, height: 60 } as ExcalidrawElement) : el));
        const { scene: next } = applyAnswer(scene, edit({ update }), [], NOW, measureText);
        expect(byId(next, "note")).toMatchObject({ x: 0, y: 0, width: 400, height: 60 });
        expect(byId(next, "d1")).toMatchObject({ x: -40, y: -40, width: 480, height: 140 });
    });

    it("hands the measuring function the changed text, and reports those ids", () => {
        const scene = inDrawing([rect("a", 0, 0, 100, 40), text("note", 0, 100, "old")]);
        const update = JSON.stringify([{ id: "note", text: "new words" }]);
        const seen: string[][] = [];
        const measureText = (els: readonly ExcalidrawElement[], ids: readonly string[]) => {
            seen.push([...ids]);
            return [...els];
        };
        const { textIds } = applyAnswer(scene, edit({ update }), [], NOW, measureText);
        expect(seen).toEqual([["note"]]);
        expect(textIds).toEqual(["note"]);
    });

    it("gives a label made for a shape in a drawing that drawing", () => {
        const scene = inDrawing([rect("bare", 0, 0, 100, 40)]);
        const update = JSON.stringify([{ id: "bare", label: "store" }]);
        const { scene: next } = applyAnswer(scene, edit({ update }), [], NOW);
        const ids = next.elements.map((el) => el.id);
        const made = next.elements.find((el) => el.type === "text") as any;
        expect(made.frameId).toBe("d1");
        expect(ids.indexOf(made.id)).toBeLessThan(ids.indexOf("d1"));
        // right after its container
        expect(ids.indexOf(made.id)).toBe(ids.indexOf("bare") + 1);
    });

    it.each([
        ["deleted since the ask", true],
        ["never on the board", false],
    ])("lands an edit of a drawing %s as a new drawing", (_, deleted) => {
        const scene = emptyScene([
            rect("a", 0, 0, 200, 80, { frameId: "gone" }),
            frameEl("gone", -20, -20, 240, 120, 1, "First"),
            rect("b", 400, 0, 100, 40, { frameId: "d2" }),
            frameEl("d2", 380, -20, 140, 80, 2, "Second"),
        ]);
        if (deleted) {
            (scene.elements as any[])[1] = { ...scene.elements[1], isDeleted: true };
            (scene.elements as any[])[0] = { ...scene.elements[0], isDeleted: true };
        }
        const { scene: next, drawingId } = applyAnswer(
            scene,
            answer({ add: "[]", title: "Fresh", drawingid: deleted ? "gone" : "missing" }),
            [rect("n", 0, 0, 100, 40)],
            NOW
        );
        expect(drawingId).not.toMatch(/^(gone|missing|d2)$/);
        expect(byId(next, drawingId)).toMatchObject({ name: "Fresh", customData: { arcDrawing: 3 } });
        expect(byId(next, "n").frameId).toBe(drawingId);
    });

    it("wraps a frameless board's shapes before landing a new drawing", () => {
        const { scene: next, drawingId } = applyAnswer(
            drawnOnce(),
            answer({ add: "[]", title: "Next" }),
            [rect("n", 0, 0, 100, 40)],
            NOW
        );
        const [earlier, fresh] = framesOf(next);
        expect(earlier).toMatchObject({ name: "Earlier drawings", customData: { arcDrawing: 1 } });
        expect(byId(next, "user-rect").frameId).toBe(earlier.id);
        expect(fresh).toMatchObject({ id: drawingId, customData: { arcDrawing: 2 } });
        // the new drawing sits right of the wrapped one
        expect(fresh.x).toBeGreaterThan(earlier.x + earlier.width);
    });
});

describe("selectionLabel", () => {
    it("names the first selected shape", () => {
        const els = [
            ...labelled("wavesrv", 0, 0, "wavesrv"),
            text("note", 0, 200, "a note"),
            rect("r1", 0, 300, 10, 10),
            rect("r2", 0, 400, 10, 10),
            rect("r3", 0, 500, 10, 10),
        ];
        expect(selectionLabel(els, ["wavesrv"])).toBe("wavesrv");
        // a selected container's own bound text is not counted again
        expect(selectionLabel(els, ["wavesrv", "wavesrv-label"])).toBe("wavesrv");
        expect(selectionLabel(els, ["note"])).toBe("a note");
        expect(selectionLabel(els, ["wavesrv", "r1", "r2"])).toBe("wavesrv and 2 more");
        expect(selectionLabel(els, ["r1", "wavesrv", "r2"])).toBe("wavesrv and 2 more");
        expect(selectionLabel(els, ["r1", "r2", "r3"])).toBe("3 shapes");
        expect(selectionLabel(els, ["r1"])).toBe("1 shape");
        expect(selectionLabel(els, [])).toBeNull();
        expect(selectionLabel(els, ["missing"])).toBeNull();
    });
});

describe("shapeCount", () => {
    it("skips bound text and deleted elements", () => {
        const els = [
            ...labelled("wavesrv", 0, 0, "wavesrv"),
            text("note", 0, 200, "a note"),
            rect("gone", 0, 300, 10, 10, { isDeleted: true }),
        ];
        expect(shapeCount(els)).toBe(2);
        expect(shapeCount([])).toBe(0);
    });

    it("skips a drawing's frame", () => {
        const els = [...labelled("wavesrv", 0, 0, "wavesrv"), frameEl("d1", 0, 0, 400, 400, 1, "First")];
        expect(shapeCount(els)).toBe(1);
    });
});

describe("wrapEarlier", () => {
    it("puts a frameless board's live shapes in one Earlier drawings frame", () => {
        const gone = rect("gone", 0, 900, 10, 10, { isDeleted: true });
        const scene = emptyScene([...drawnOnce().elements, gone]);
        const next = wrapEarlier(scene, NOW);
        const frames = framesOf(next);
        expect(frames).toHaveLength(1);
        const [f] = frames;
        expect(f).toMatchObject({ name: "Earlier drawings", customData: { arcDrawing: 1 }, frameId: null });
        const shapes = ["user-note", "user-rect", "box", "box-label"].map((id) => byId(next, id));
        expect(shapes.map((s) => s.frameId)).toEqual([f.id, f.id, f.id, f.id]);
        expect(shapes.map((s) => s.version)).toEqual([2, 2, 2, 2]);
        // padded 40 around everything live: the shapes span x 0..400 (box 200..400), y 0..100 (user-rect 40..100)
        expect(f).toMatchObject({ x: -40, y: -40, width: 480, height: 180 });
        // the frame comes after its children; a deleted shape stays as it was
        expect(next.elements[next.elements.length - 1].id).toBe(f.id);
        expect(byId(next, "gone")).toBe(gone);
        expect(scene.elements[0].frameId).toBeNull();
    });

    it.each([
        ["an empty board", emptyScene()],
        ["a board of deleted shapes", emptyScene([rect("gone", 0, 0, 10, 10, { isDeleted: true })])],
        ["a board with a frame", emptyScene([userRect, frameEl("hand", 0, 0, 10, 10, null, "Mine")])],
    ])("leaves %s as the same object", (_, scene) => {
        expect(wrapEarlier(scene, NOW)).toBe(scene);
    });
});

describe("the board's face", () => {
    it("knows a Vietnamese letter the hand-drawn fonts lack, precomposed or decomposed", () => {
        expect(needsNunito("Benchmark và oracle")).toBe(false); // à is Latin-1: Excalifont has it
        expect(needsNunito("Bài toán")).toBe(false);
        expect(needsNunito("Đánh giá")).toBe(true);
        expect(needsNunito("hướng luận văn")).toBe(true);
        expect(needsNunito("tới nơi")).toBe(true);
        expect(needsNunito("ăn")).toBe(true);
        expect(needsNunito("ạ")).toBe(true); // ạ written as a + combining dot below
        expect(needsNunito("wavesrv → wsh")).toBe(false);
    });

    it("turns every hand-drawn text to Nunito once any text needs it, and names what it turned", () => {
        const els = [
            ...labelled("a", 0, 0, "Bài toán"),
            text("t1", 0, 200, "PoV sớm từ ít thông tin"),
            text("t2", 0, 300, "API"),
            text("code", 0, 400, "npm test", { fontFamily: 3 }),
            text("gone", 0, 500, "Đã xoá", { isDeleted: true }),
        ];
        const { elements, changed } = withReadableFont(els, NOW);
        expect(changed).toEqual(["a-label", "t1", "t2"]);
        const byId = new Map(elements.map((el) => [el.id, el as any]));
        expect(byId.get("t2")).toMatchObject({ fontFamily: NUNITO, version: 2, updated: NOW });
        expect(byId.get("a-label").fontFamily).toBe(NUNITO);
        expect(byId.get("code").fontFamily).toBe(3); // a code font is not hand-drawn: it stays
        expect(byId.get("gone").fontFamily).toBe(5); // a deleted text neither counts nor turns
        expect(byId.get("a")).toBe(els[0]);
        expect(nunitoTextIds(elements)).toEqual(["a-label", "t1", "t2"]);
    });

    it("leaves a board whose text the hand-drawn fonts can show as it is", () => {
        const els = [...labelled("a", 0, 0, "Login box"), text("t", 0, 200, "Đã xoá", { isDeleted: true })];
        const { elements, changed } = withReadableFont(els, NOW);
        expect(changed).toEqual([]);
        expect(elements).toEqual(els);
        expect(nunitoTextIds(elements)).toEqual([]);
    });
});
