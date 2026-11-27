import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import {
    boardCommands,
    drawingAfterDelete,
    drawingIds,
    exportFileName,
    registerBoardCommands,
    setDeleted,
    type BoardCommands,
} from "./boardcommands";
import type { Drawing } from "./boarddrawings";

function el(id: string, type: string, extra: object = {}) {
    return {
        id,
        type,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        version: 1,
        versionNonce: 7,
        isDeleted: false,
        frameId: null,
        ...extra,
    } as unknown as ExcalidrawElement;
}

function drawing(id: string, n: number): Drawing {
    return { id, n, title: id, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
}

describe("drawingIds", () => {
    const els = [
        el("box", "rectangle", { frameId: "f1" }),
        el("label", "text", { frameId: "f1", containerId: "box" }),
        el("stray-label", "text", { containerId: "box" }),
        el("arrow", "arrow", { frameId: "f1" }),
        el("f1", "frame"),
        el("other", "rectangle", { frameId: "f2" }),
        el("f2", "frame"),
        el("gone", "rectangle", { frameId: "f1", isDeleted: true }),
    ];

    it("takes the frame, its shapes and the text bound to them, nothing of another drawing", () => {
        expect([...drawingIds(els, "f1")].sort()).toEqual(["arrow", "box", "f1", "label", "stray-label"]);
    });

    it("takes nothing for an id that is not a live frame", () => {
        expect(drawingIds(els, "box").size).toBe(0);
        expect(drawingIds(els, "nope").size).toBe(0);
        expect(drawingIds([el("f3", "frame", { isDeleted: true })], "f3").size).toBe(0);
    });
});

describe("setDeleted", () => {
    it("marks the ids deleted with a new version and nonce, and live again for an undo", () => {
        const els = [el("a", "rectangle"), el("b", "rectangle")];
        const out = setDeleted(els, new Set(["a"]), true, 99);
        expect(out[0]).toMatchObject({ id: "a", isDeleted: true, version: 2, updated: 99 });
        expect(out[1]).toBe(els[1]);
        const back = setDeleted(out, new Set(["a"]), false, 100);
        expect(back[0]).toMatchObject({ isDeleted: false, version: 3 });
    });

    it("leaves an element already in that state as it is", () => {
        const els = [el("a", "rectangle", { isDeleted: true })];
        expect(setDeleted(els, new Set(["a"]), true, 1)[0]).toBe(els[0]);
    });
});

describe("drawingAfterDelete", () => {
    const ds = [drawing("d1", 1), drawing("d2", 2), drawing("d3", 3)];
    it("goes to the drawing before, else the one after, else none", () => {
        expect(drawingAfterDelete(ds, "d2")?.id).toBe("d1");
        expect(drawingAfterDelete(ds, "d1")?.id).toBe("d2");
        expect(drawingAfterDelete([drawing("d1", 1)], "d1")).toBeNull();
        expect(drawingAfterDelete(ds, "nope")).toBeNull();
    });
});

describe("exportFileName", () => {
    it("names the file by the drawing's title, without what a file name refuses", () => {
        expect(exportFileName({ n: 3, title: "Tiếp 27/11: pha thử" }, "png")).toBe("Tiếp 27-11- pha thử.png");
        expect(exportFileName({ n: 3, title: "  ..a?b  " }, "svg")).toBe("a-b.svg");
    });

    it("names an untitled drawing by its number", () => {
        expect(exportFileName({ n: 4, title: "" }, "png")).toBe("drawing-4.png");
        expect(exportFileName({ n: 4, title: "///" }, "svg")).toBe("drawing-4.svg");
    });
});

describe("registerBoardCommands", () => {
    const cmds = (): BoardCommands => ({
        copyView: async () => {},
        exportDrawing: async () => null,
        deleteDrawing: () => true,
    });

    it("answers with the newest canvas of the board, and the one before once it goes", () => {
        const a = cmds();
        const b = cmds();
        const offA = registerBoardCommands("board", a);
        const offB = registerBoardCommands("board", b);
        expect(boardCommands("board")).toBe(b);
        offB();
        expect(boardCommands("board")).toBe(a);
        offA();
        expect(boardCommands("board")).toBeUndefined();
    });
});
