import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import {
    linkAt,
    linkDrawing,
    linkTarget,
    linkTo,
    MAX_BACK,
    popBack,
    pushBack,
    resolveLinks,
    sceneAt,
} from "./boardlinks";

function el(over: Record<string, unknown>): ExcalidrawElement {
    return {
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        isDeleted: false,
        link: null,
        frameId: null,
        ...over,
    } as unknown as ExcalidrawElement;
}

describe("linkTo / linkTarget", () => {
    it("round-trips an id through Excalidraw's element link", () => {
        expect(linkTo("f 1")).toBe("?element=f%201");
        expect(linkTarget(linkTo("f 1"))).toBe("f 1");
        expect(linkTarget("http://localhost:5174/?element=b1")).toBe("b1");
    });

    it("reads no target from no link or a web page", () => {
        expect(linkTarget(null)).toBeNull();
        expect(linkTarget("")).toBeNull();
        expect(linkTarget("https://example.com/page")).toBeNull();
        expect(linkTarget("?element=")).toBeNull();
    });
});

describe("resolveLinks", () => {
    it("makes @new the new drawing and a bare id a link, only on the named elements", () => {
        const els = [
            el({ id: "a", link: "@new" }),
            el({ id: "b", link: "f1" }),
            el({ id: "c", link: "f1" }),
            el({ id: "d", link: "?element=x" }),
            el({ id: "e", link: "https://example.com" }),
        ];
        const out = resolveLinks(els, new Set(["a", "b", "d", "e"]), "f9");
        expect(out.map((e) => e.link)).toEqual([
            "?element=f9",
            "?element=f1",
            "f1",
            "?element=x",
            "https://example.com",
        ]);
        expect(out[2]).toBe(els[2]);
    });

    it("drops @new when the answer added no drawing", () => {
        expect(resolveLinks([el({ id: "a", link: "@new" })], new Set(["a"]), null)[0].link).toBeNull();
    });
});

describe("linkDrawing", () => {
    const els = [
        el({ id: "f1", type: "frame" }),
        el({ id: "box", frameId: "f1" }),
        el({ id: "loose" }),
        el({ id: "gone", isDeleted: true }),
    ];
    it("is a frame itself, or the frame a shape is in", () => {
        expect(linkDrawing(els, "f1")).toBe("f1");
        expect(linkDrawing(els, "box")).toBe("f1");
    });
    it("is null for a loose shape or one that is gone", () => {
        expect(linkDrawing(els, "loose")).toBeNull();
        expect(linkDrawing(els, "gone")).toBeNull();
        expect(linkDrawing(els, "nope")).toBeNull();
    });
});

describe("linkAt", () => {
    const els = [
        el({ id: "f1", type: "frame", x: -50, y: -50, width: 500, height: 500, link: "?element=zz" }),
        el({ id: "box", x: 0, y: 0, width: 100, height: 50, link: "?element=f2" }),
        el({ id: "label", type: "text", containerId: "box", x: 10, y: 10, width: 80, height: 25 }),
        el({ id: "plain", x: 200, y: 0 }),
    ];
    it("finds the linked box under the point, through its label", () => {
        expect(linkAt(els, 50, 20)).toBe("f2");
        expect(linkAt(els, 5, 45)).toBe("f2");
    });
    it("finds nothing on a box with no link, on a frame, or on empty canvas", () => {
        expect(linkAt(els, 250, 20)).toBeNull();
        expect(linkAt(els, 400, 400)).toBeNull();
    });
});

describe("sceneAt", () => {
    it("maps a page point through the canvas offset, zoom and scroll", () => {
        expect(
            sceneAt(300, 200, { offsetLeft: 100, offsetTop: 50, scrollX: -10, scrollY: 20, zoom: { value: 2 } })
        ).toEqual({
            x: 110,
            y: 55,
        });
    });
});

describe("pushBack / popBack", () => {
    it("remembers the drawing left, once in a row, the newest MAX_BACK", () => {
        expect(pushBack([], "f1", "f2")).toEqual(["f1"]);
        expect(pushBack(["f1"], "f1", "f3")).toEqual(["f1"]);
        expect(pushBack(["f1"], "f2", "f2")).toEqual(["f1"]);
        expect(pushBack(["f1"], null, "f2")).toEqual(["f1"]);
        const full = Array.from({ length: MAX_BACK }, (_, i) => `d${i}`);
        expect(pushBack(full, "new", "x")).toEqual([...full.slice(1), "new"]);
    });

    it("goes back to the newest drawing still on the board", () => {
        expect(popBack(["f1", "f2"], new Set(["f1", "f2"]))).toEqual({ to: "f2", stack: ["f1"] });
        expect(popBack(["f1", "gone"], new Set(["f1"]))).toEqual({ to: "f1", stack: [] });
        expect(popBack(["gone"], new Set())).toEqual({ to: null, stack: [] });
    });
});
