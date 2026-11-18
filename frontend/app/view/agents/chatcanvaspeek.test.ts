// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { CanvasBoard } from "./canvasmodel";
import { peekBoards, peekPick, peekTitle, turnCanvas } from "./chatcanvaspeek";

const f = (path: string) => ({ path, adds: 1, dels: 0 });
const board = (name: string, title?: string): CanvasBoard => ({ name, x: 0, y: 0, w: 1440, h: 900, title });

describe("turnCanvas", () => {
    it("names the canvas and its boards in the order the turn wrote them, once each", () => {
        const files = [
            f("D:\\p\\.superpowers\\design\\sidecar\\project\\Panel.dc.html"),
            f("D:\\p\\.superpowers\\design\\sidecar\\project\\Main.dc.html"),
            f("D:\\p\\.superpowers\\design\\sidecar\\project\\canvas.json"),
            f("D:\\p\\frontend\\x.tsx"),
        ];
        expect(turnCanvas(files, "D:\\p")).toEqual({
            topic: "sidecar",
            cwd: "D:\\p",
            boards: ["Panel.dc.html", "Main.dc.html"],
        });
    });

    it("reads a relative path against the agent's directory", () => {
        expect(turnCanvas([f(".superpowers/design/t/project/Main.dc.html")], "/home/me/p")).toEqual({
            topic: "t",
            cwd: "/home/me/p",
            boards: ["Main.dc.html"],
        });
    });

    it("is null for a turn that wrote no board, a board set aside, or a relative path with no directory", () => {
        expect(turnCanvas([f("/p/a.ts"), f("/p/.superpowers/design/t/project/canvas.json")], "/p")).toBeNull();
        expect(turnCanvas([f("/p/.superpowers/design/t/unchosen/B-x.dc.html")], "/p")).toBeNull();
        expect(turnCanvas([f(".superpowers/design/t/project/Main.dc.html")], null)).toBeNull();
    });

    it("takes the canvas the turn wrote more boards of, the first on a tie", () => {
        const files = [
            f("/p/.superpowers/design/a/project/Main.dc.html"),
            f("/p/.superpowers/design/b/project/Main.dc.html"),
            f("/p/.superpowers/design/b/project/Two.dc.html"),
        ];
        expect(turnCanvas(files, "/p")?.topic).toBe("b");
        expect(turnCanvas(files.slice(0, 2), "/p")?.topic).toBe("a");
    });
});

describe("peekBoards", () => {
    it("keeps the boards the turn wrote, in canvas.json's order, and drops one canvas.json no longer lists", () => {
        const boards = [board("Main.dc.html"), board("Other.dc.html"), board("Panel.dc.html")];
        expect(peekBoards(boards, ["Panel.dc.html", "Main.dc.html", "Gone.dc.html"]).map((b) => b.name)).toEqual([
            "Main.dc.html",
            "Panel.dc.html",
        ]);
    });
});

describe("peekTitle and peekPick", () => {
    it("names a board by its title, else its file name less the extension", () => {
        expect(peekTitle(board("Main.dc.html", "Cửa sổ lớn"))).toBe("Cửa sổ lớn");
        expect(peekTitle(board("Panel-wall.dc.html", "  "))).toBe("Panel-wall");
    });

    it("hands the modal rows with no letter, under the canvas's name", () => {
        expect(peekPick("sidecar", [board("Main.dc.html", "Main")])).toEqual({
            question: "sidecar",
            rows: [{ letter: "", title: "Main", board: "Main.dc.html" }],
        });
    });
});
