import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import { BOUND_TEXT_PADDING, fitContainers, neededHeight } from "./boardfit";

function el(over: Record<string, unknown>): ExcalidrawElement {
    return {
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        ...over,
    } as unknown as ExcalidrawElement;
}

const box = (id: string, over: Record<string, unknown> = {}) =>
    el({ id, type: "rectangle", x: 10, y: 20, width: 300, height: 70, ...over });
const label = (id: string, containerId: string | null, height: number, width = 273) =>
    el({ id, type: "text", containerId, width, height, x: 0, y: 0 });

describe("neededHeight", () => {
    it("pads a rectangle's label, and gives an ellipse and a diamond more", () => {
        expect(neededHeight("rectangle", 75)).toBe(75 + 2 * BOUND_TEXT_PADDING);
        expect(neededHeight("diamond", 25)).toBe(70);
        expect(neededHeight("ellipse", 25)).toBe(Math.round((35 / Math.sqrt(2)) * 2));
    });
});

describe("fitContainers", () => {
    it("grows a box down to the label that wrapped past it, and centers the label again", () => {
        // the real board's case: three 25px lines (75px) in a 300x70 box
        const out = fitContainers([box("b"), label("t", "b", 75)], ["t"]);
        const [b, t] = out;
        expect(b).toMatchObject({ x: 10, y: 20, width: 300, height: 85, version: 2 });
        expect(t).toMatchObject({ x: 10 + (300 - 273) / 2, y: 20 + (85 - 75) / 2 });
    });

    it("leaves a box that holds its label", () => {
        const els = [box("b"), label("t", "b", 50)];
        const out = fitContainers(els, ["t"]);
        expect(out[0]).toBe(els[0]);
        expect(out[1]).toBe(els[1]);
    });

    it("touches only the named labels", () => {
        const els = [box("b"), label("t", "b", 75)];
        expect(fitContainers(els, [])[0]).toBe(els[0]);
    });

    it("leaves an arrow's label, a label with no box, and one whose box is gone", () => {
        const arrow = el({
            id: "a",
            type: "arrow",
            points: [
                [0, 0],
                [100, 0],
            ],
            height: 0,
        });
        const els = [arrow, label("t1", "a", 75), label("t2", null, 75), label("t3", "missing", 75)];
        expect(fitContainers(els, ["t1", "t2", "t3"])).toEqual(els);
    });

    it("grows a diamond to twice its padded label", () => {
        const out = fitContainers([box("d", { type: "diamond", height: 60 }), label("t", "d", 50, 80)], ["t"]);
        expect(out[0].height).toBe(120);
    });
});
