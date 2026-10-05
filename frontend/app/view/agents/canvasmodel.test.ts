// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    ALL_TAB,
    boardLabel,
    boardsFromCanvasJson,
    boardUrl,
    buildGoal,
    canvasDir,
    canvasLayout,
    canvasTabs,
    currentTab,
    fitScale,
    isUnseen,
    paneState,
    parseCanvasPath,
    prototypePath,
    shownBoards,
    stepTab,
    updatedAgo,
    type CanvasBoard,
} from "./canvasmodel";
import type { CanvasState } from "./canvasstore";

const BOARDS: CanvasBoard[] = [
    { name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 },
    { name: "States.dc.html", x: 1520, y: 0, w: 1440, h: 900 },
];

function state(over: Partial<CanvasState>): CanvasState {
    return {
        topic: "t",
        dir: "/p/.superpowers/design/t",
        projectDir: "/p",
        mode: "terminal",
        board: null,
        all: false,
        boards: [],
        base: null,
        status: "ready",
        lastModifiedMs: null,
        lastViewedMs: 0,
        marking: false,
        marks: [],
        reloadKey: 0,
        ...over,
    };
}

describe("boardsFromCanvasJson", () => {
    const MAIN = { name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 };

    it("reads the design-local shape in its order", () => {
        const json = {
            boards: {
                "Main.dc.html": { x: 0, y: 0, w: 1440, h: 900 },
                "States.dc.html": { x: 1520, y: 0, w: 1440, h: 900 },
            },
            order: ["Main.dc.html", "States.dc.html"],
        };
        expect(boardsFromCanvasJson(json)).toEqual(BOARDS);
    });

    it("keeps a board's title", () => {
        const json = { boards: { "Main.dc.html": { x: 0, y: 0, w: 640, h: 960, title: "A — Thread" } } };
        expect(boardsFromCanvasJson(json)[0].title).toBe("A — Thread");
    });

    it("drops an order entry naming a board that isn't there", () => {
        const json = { boards: { "Main.dc.html": { x: 0, y: 0 } }, order: ["Gone.dc.html", "Main.dc.html"] };
        expect(boardsFromCanvasJson(json)).toEqual([MAIN]);
    });

    it("falls back to the board keys with Main first when there is no order", () => {
        const json = { boards: { "States.dc.html": { x: 0, y: 1000, w: 800 }, "Main.dc.html": { x: 0, y: 0 } } };
        expect(boardsFromCanvasJson(json).map((b) => b.name)).toEqual(["Main.dc.html", "States.dc.html"]);
    });

    it.each([null, "x", 3, {}, { boards: "x" }])("reads malformed %j as the one Main board", (json) => {
        expect(boardsFromCanvasJson(json)).toEqual([MAIN]);
    });

    it("gives a board with no size, or a bad one, the defaults", () => {
        const json = {
            boards: { "Main.dc.html": {}, "A.dc.html": { w: 0, h: "900" } },
            order: ["Main.dc.html", "A.dc.html"],
        };
        expect(boardsFromCanvasJson(json).map((b) => [b.w, b.h])).toEqual([
            [1440, 900],
            [1440, 900],
        ]);
    });

    it("places a board with no position to the right of those before it", () => {
        const json = {
            boards: { "Main.dc.html": { x: 0, y: 0, w: 640 }, "A.dc.html": { w: 640 }, "B.dc.html": { x: 5 } },
            order: ["Main.dc.html", "A.dc.html", "B.dc.html"],
        };
        expect(boardsFromCanvasJson(json).map((b) => [b.x, b.y])).toEqual([
            [0, 0],
            [720, 0],
            [1440, 0],
        ]);
    });
});

describe("canvasLayout", () => {
    const board = (name: string, x: number, y: number, w: number, h: number) => ({ name, x, y, w, h });

    it("draws side-by-side boards at full size when the row fits", () => {
        const layout = canvasLayout([board("A", 0, 0, 640, 960), board("B", 720, 0, 640, 960)], 1700);
        expect(layout.scale).toBe(1);
        expect([layout.width, layout.height]).toEqual([1360, 960]);
        expect(layout.frames.map((f) => [f.left, f.top, f.width, f.height])).toEqual([
            [0, 0, 640, 960],
            [720, 0, 640, 960],
        ]);
    });

    it("shrinks the whole canvas so its widest row fits the pane", () => {
        const layout = canvasLayout([board("A", 0, 0, 1440, 900), board("B", 1520, 0, 1440, 900)], 1480);
        expect(layout.scale).toBe(0.5);
        expect(layout.frames[1]).toMatchObject({ left: 760, top: 0, width: 720, height: 450 });
        expect(layout.height).toBe(450);
    });

    it("stacks rows and shifts the canvas so its top-left board sits at the origin", () => {
        const layout = canvasLayout([board("A", 100, 50, 640, 400), board("B", 100, 570, 640, 14)], 2000);
        expect(layout.frames.map((f) => [f.left, f.top])).toEqual([
            [0, 0],
            [0, 520],
        ]);
        expect([layout.width, layout.height]).toEqual([640, 534]);
    });

    it("lays out the one Main board before any boards are read", () => {
        const layout = canvasLayout([], 2000);
        expect(layout.frames.map((f) => f.board.name)).toEqual(["Main.dc.html"]);
    });
});

describe("boardLabel", () => {
    it("strips the board extension", () => {
        expect(boardLabel("Main.dc.html")).toBe("Main");
    });
});

describe("stepTab", () => {
    const tabs = [ALL_TAB, "Main.dc.html", "C.dc.html"];

    it("wraps forward and back, through All", () => {
        expect(stepTab(tabs, "C.dc.html", 1)).toBe(ALL_TAB);
        expect(stepTab(tabs, ALL_TAB, -1)).toBe("C.dc.html");
        expect(stepTab(tabs, ALL_TAB, 1)).toBe("Main.dc.html");
    });

    it("treats an unknown current tab as the first", () => {
        expect(stepTab(tabs, null, 1)).toBe("Main.dc.html");
        expect(stepTab(tabs, "Gone.dc.html", -1)).toBe("C.dc.html");
    });

    it("has nothing to step to with no tabs", () => {
        expect(stepTab([], null, 1)).toBeNull();
    });
});

describe("board tabs", () => {
    it("offers All first only when there are boards to lay side by side", () => {
        expect(canvasTabs(BOARDS)).toEqual([ALL_TAB, "Main.dc.html", "States.dc.html"]);
        expect(canvasTabs([BOARDS[0]])).toEqual(["Main.dc.html"]);
        expect(canvasTabs([])).toEqual([]);
    });

    it("shows the selected board alone on its tab, and every board under All", () => {
        const one = state({ boards: BOARDS, board: "States.dc.html" });
        expect(shownBoards(one)).toEqual([BOARDS[1]]);
        expect(currentTab(one)).toBe("States.dc.html");
        const all = state({ boards: BOARDS, board: "States.dc.html", all: true });
        expect(shownBoards(all)).toEqual(BOARDS);
        expect(currentTab(all)).toBe(ALL_TAB);
    });

    it("reads All with a single board as that board, since there is no All tab", () => {
        const s = state({ boards: [BOARDS[0]], all: true });
        expect(shownBoards(s)).toEqual([BOARDS[0]]);
        expect(currentTab(s)).toBe("Main.dc.html");
    });

    it("builds the board on its tab, and every board under All", () => {
        const dir = "/p/.superpowers/design/t";
        expect(buildGoal(dir, shownBoards(state({ boards: BOARDS, board: "States.dc.html" })))).toBe(
            "Build the design in /p/.superpowers/design/t/project (boards: States)"
        );
        expect(prototypePath(dir, shownBoards(state({ boards: BOARDS, board: "States.dc.html" })))).toBe(
            "/p/.superpowers/design/t/project/States.dc.html"
        );
        expect(buildGoal(dir, shownBoards(state({ boards: BOARDS, all: true })))).toBe(
            "Build the design in /p/.superpowers/design/t/project (boards: Main, States)"
        );
    });
});

describe("paneState", () => {
    it("shows the board once ready", () => {
        expect(paneState(state({ status: "ready" }))).toBe("board");
        expect(paneState(state({ status: "probing" }))).toBe("probing");
        expect(paneState(state({ status: "server-down" }))).toBe("server-down");
        expect(paneState(state({ status: "removed" }))).toBe("removed");
    });
});

describe("isUnseen", () => {
    it("is never unseen while the canvas is showing", () => {
        expect(isUnseen(state({ mode: "canvas", lastModifiedMs: 900, lastViewedMs: 100 }))).toBe(false);
    });

    it("is not unseen before anything was read", () => {
        expect(isUnseen(state({ lastModifiedMs: null, lastViewedMs: 100 }))).toBe(false);
    });

    it("is unseen when a board changed after the last look", () => {
        expect(isUnseen(state({ lastModifiedMs: 900, lastViewedMs: 100 }))).toBe(true);
        expect(isUnseen(state({ lastModifiedMs: 100, lastViewedMs: 100 }))).toBe(false);
    });
});

describe("updatedAgo", () => {
    const now = 10_000_000;
    it.each<[number, string]>([
        [0, "updated 0s ago"],
        [59, "updated 59s ago"],
        [60, "updated 1m ago"],
        [3600, "updated 1h ago"],
    ])("reads %ds back", (secs, want) => {
        expect(updatedAgo(now, now - secs * 1000)).toBe(want);
    });

    it("says nothing with no time", () => {
        expect(updatedAgo(now, null)).toBe("");
    });
});

describe("fitScale", () => {
    it("shrinks a board to the pane, never grows it", () => {
        expect(fitScale(1200, 1440)).toBe(1200 / 1440);
        expect(fitScale(2000, 1440)).toBe(1);
    });

    it("is 1 before the pane has a width", () => {
        expect(fitScale(0, 1440)).toBe(1);
        expect(fitScale(1200, 0)).toBe(1);
    });
});

describe("paths", () => {
    it("builds the board url", () => {
        expect(boardUrl("http://127.0.0.1:5005/canvas/tok", "t", "Main.dc.html")).toBe(
            "http://127.0.0.1:5005/canvas/tok/t/project/Main.dc.html"
        );
    });

    it("joins the canvas dir with the cwd's own separator", () => {
        expect(canvasDir("C:\\p", "t")).toBe("C:\\p\\.superpowers\\design\\t");
        expect(canvasDir("/p", "t")).toBe("/p/.superpowers/design/t");
        expect(canvasDir("/p/", "t")).toBe("/p/.superpowers/design/t");
    });

    it("names the project dir and its boards in the goal", () => {
        expect(buildGoal("C:\\p\\.superpowers\\design\\t", BOARDS)).toBe(
            "Build the design in C:\\p\\.superpowers\\design\\t\\project (boards: Main, States)"
        );
        expect(buildGoal("/p/.superpowers/design/t", BOARDS)).toBe(
            "Build the design in /p/.superpowers/design/t/project (boards: Main, States)"
        );
    });

    it("reads a board path back into the cwd, topic and board", () => {
        expect(parseCanvasPath("C:\\p\\.superpowers\\design\\t\\project\\Main.dc.html")).toEqual({
            cwd: "C:\\p",
            topic: "t",
            board: "Main.dc.html",
        });
        expect(parseCanvasPath(prototypePath("/p/q/.superpowers/design/t", [BOARDS[1]]))).toEqual({
            cwd: "/p/q",
            topic: "t",
            board: "States.dc.html",
        });
        expect(parseCanvasPath("/p/elsewhere/Main.dc.html")).toBeNull();
        expect(parseCanvasPath("/p/.superpowers/design/t/project/notes.md")).toBeNull();
        expect(parseCanvasPath("/p/.superpowers/design/t/project/sub/Main.dc.html")).toBeNull();
    });

    it("points the prototype at the first board", () => {
        expect(prototypePath("C:\\p\\.superpowers\\design\\t", BOARDS)).toBe(
            "C:\\p\\.superpowers\\design\\t\\project\\Main.dc.html"
        );
        expect(prototypePath("/p/.superpowers/design/t", [BOARDS[1]])).toBe(
            "/p/.superpowers/design/t/project/States.dc.html"
        );
    });
});
