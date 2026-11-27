// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { canvasHandoffLine, NO_CONTEXT, removeMark, type Mark, type MarkShot } from "./canvasmarks";
import { sendCanvasMarks, shootBoard, type SendIO, type ShotBox } from "./canvassend";
import { attachCanvas, detachCanvas, getCanvas, setCanvasMode, updateCanvas } from "./canvasstore";
import type { MarkContext } from "./protomodel";

const AGENT = { id: "a1", name: "Arc", blockId: "blk-1" } as AgentVM;
const DIR = "/p/.superpowers/design/t";
const REL = ".superpowers/design/t/feedback";
const MARKS: Mark[] = [
    { id: 1, x: 10, y: 10, w: 40, h: 40, note: "too wide", ctx: NO_CONTEXT, shot: null },
    { id: 2, x: 60, y: 60, w: 20, h: 20, note: "", ctx: NO_CONTEXT, shot: null },
];
const HOME: MarkContext = { screen: "Home", slots: [{ id: "list", label: "list", letter: "A" }] };
const LATER: MarkContext = { screen: "Later", slots: [{ id: "list", label: "list", letter: "B" }] };

type Fake = SendIO & {
    typed: [string, string][];
    written: string[];
    bytes: number[][];
    made: string[];
    composed: { png: Blob; boxes: ShotBox[]; scale: number }[];
    events: string[];
};

function fakeIO(over: Partial<SendIO> = {}): Fake {
    const io: Fake = {
        typed: [],
        written: [],
        bytes: [],
        made: [],
        composed: [],
        events: [],
        capture: async () => {
            io.events.push("capture");
            return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
        },
        crop: async (png) => {
            io.events.push("crop");
            return png;
        },
        pixelScale: async () => 1,
        boardRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        markOrigin: () => ({ left: 0, top: 0 }),
        hideOverlays: async (fn) => {
            io.events.push("hide");
            try {
                return await fn();
            } finally {
                io.events.push("show");
            }
        },
        compose: async (png, boxes, scale) => {
            io.composed.push({ png, boxes, scale });
            return png;
        },
        mkdir: async (path) => {
            io.made.push(path);
        },
        list: async () => ["001.png", "002.png", "003.png", "notes.txt"],
        write: async (path, bytes) => {
            io.written.push(path);
            io.bytes.push(Array.from(bytes));
        },
        type: async (blockId, text) => {
            io.typed.push([blockId, text]);
        },
        ...over,
    };
    return io;
}

const fail = async (): Promise<never> => {
    throw new Error("boom");
};

let ids = 100;
function shot(byte: number, rect = { left: 0, top: 0, width: 400, height: 300 }, scale = 1): MarkShot {
    return { png: new Blob([new Uint8Array([byte])], { type: "image/png" }), rect, scale };
}

function mark(note: string, ctx: MarkContext, s: MarkShot | null, box = { x: 10, y: 10, w: 20, h: 20 }): Mark {
    return { id: ++ids, ...box, note, ctx, shot: s };
}

function setMarks(marks: Mark[]): void {
    updateCanvas("a1", (s) => ({ ...s, marks }));
}

beforeEach(() => {
    attachCanvas("a1", { topic: "t", dir: DIR, projectDir: "/p", board: "States.dc.html" });
    setCanvasMode("a1", "canvas", 1);
    updateCanvas("a1", (s) => ({
        ...s,
        status: "ready",
        boards: [
            { name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 },
            { name: "States.dc.html", x: 0, y: 0, w: 1440, h: 900 },
        ],
        marking: true,
        marks: MARKS,
    }));
});

afterEach(() => {
    detachCanvas("a1");
});

describe("sendCanvasMarks", () => {
    it("saves the next feedback picture, types one line into the agent, then goes back to the terminal", async () => {
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io);
        expect(io.made).toEqual([`${DIR}/feedback`]);
        expect(io.written).toEqual([`${DIR}/feedback/004.png`]);
        expect(io.typed).toEqual([["blk-1", canvasHandoffLine(`${REL}/004.png`, "States.dc.html", MARKS) + "\r"]]);
        const s = getCanvas("a1")!;
        expect(s.mode).toBe("terminal");
        expect(s.marking).toBe(false);
        expect(s.marks).toEqual([]);
    });

    // a board with no screen and no slot: the line is the one it always was
    it("types today's line for marks with no screen and no slot", async () => {
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io);
        expect(io.typed[0][1]).toBe(
            "look at .superpowers/design/t/feedback/004.png — marks on States.dc.html: 1 too wide; 2 (no note)\r"
        );
    });

    it("writes the cropped picture's bytes", async () => {
        let bytes: Uint8Array | null = null;
        const io = fakeIO({
            crop: async () => new Blob([new Uint8Array([9, 8])]),
            write: async (_path, b) => {
                bytes = b;
            },
        });
        await sendCanvasMarks(AGENT, io);
        expect(Array.from(bytes!)).toEqual([9, 8]);
    });

    it("crops the capture to the board rect", async () => {
        let cropped: unknown = null;
        const rect = { left: 5, top: 6, width: 7, height: 8 };
        await sendCanvasMarks(
            AGENT,
            fakeIO({
                boardRect: () => rect,
                crop: async (png, r) => {
                    cropped = r;
                    return png;
                },
            })
        );
        expect(cropped).toEqual(rect);
    });

    it.each([
        ["capture", { capture: fail }],
        ["crop", { crop: fail }],
        ["mkdir", { mkdir: fail }],
        ["list", { list: fail }],
        ["write", { write: fail }],
        ["compose", { compose: fail }],
        ["board rect", { boardRect: (): null => null }],
    ])("a %s failure throws, types nothing, and keeps the marks", async (_name, over) => {
        const io = fakeIO(over as Partial<SendIO>);
        await expect(sendCanvasMarks(AGENT, io)).rejects.toThrow(Error);
        expect(io.typed).toEqual([]);
        const s = getCanvas("a1")!;
        expect(s.marks).toEqual(MARKS);
        expect(s.mode).toBe("canvas");
        expect(s.marking).toBe(true);
    });

    it("a typing failure throws and keeps the marks", async () => {
        const io = fakeIO({ type: fail });
        await expect(sendCanvasMarks(AGENT, io)).rejects.toThrow("boom");
        expect(getCanvas("a1")!.marks).toEqual(MARKS);
    });

    it("refuses with no marks", async () => {
        updateCanvas("a1", (s) => ({ ...s, marks: [] }));
        const io = fakeIO();
        await expect(sendCanvasMarks(AGENT, io)).rejects.toThrow("Nothing to send");
        expect(io.written).toEqual([]);
    });

    it("refuses with no canvas", async () => {
        detachCanvas("a1");
        await expect(sendCanvasMarks(AGENT, fakeIO())).rejects.toThrow("Nothing to send");
    });

    it("refuses an agent with no terminal before capturing", async () => {
        let captured = false;
        const io = fakeIO({
            capture: async () => {
                captured = true;
                return new Blob([]);
            },
        });
        await expect(sendCanvasMarks({ ...AGENT, blockId: undefined }, io)).rejects.toThrow(
            "This agent has no terminal to type into"
        );
        expect(captured).toBe(false);
    });

    it("names the first board when none is picked", async () => {
        updateCanvas("a1", (s) => ({
            ...s,
            board: null,
            boards: [{ name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 }],
        }));
        const io = fakeIO({ list: async () => [] });
        await sendCanvasMarks(AGENT, io);
        expect(io.typed[0][1]).toBe(canvasHandoffLine(`${REL}/001.png`, "Main.dc.html", MARKS) + "\r");
    });

    it("keeps a Windows dir's separators", async () => {
        updateCanvas("a1", (s) => ({ ...s, dir: "C:\\p\\.superpowers\\design\\t" }));
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io);
        expect(io.written).toEqual(["C:\\p\\.superpowers\\design\\t\\feedback\\004.png"]);
    });
});

describe("sendCanvasMarks with marks on more than one screen", () => {
    // home 1, later 2, home 3: two pictures, and each keeps its marks' numbers from the whole list
    function threeMarks() {
        const s1 = shot(11);
        const s2 = shot(22, { left: 0, top: 100, width: 400, height: 300 }, 2);
        const s3 = shot(33);
        const marks = [
            mark("a", HOME, s1, { x: 10, y: 20, w: 30, h: 40 }),
            mark("b", LATER, s2, { x: 30, y: 140, w: 50, h: 20 }),
            mark("c", HOME, s3, { x: 100, y: 100, w: 20, h: 20 }),
        ];
        return { marks, s1, s2, s3 };
    }

    it("writes one picture per context, the group's newest one, and types one line joined by ' | '", async () => {
        const { marks, s2, s3 } = threeMarks();
        setMarks(marks);
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io, HOME);
        expect(io.made).toEqual([`${DIR}/feedback`]);
        expect(io.written).toEqual([`${DIR}/feedback/004.png`, `${DIR}/feedback/005.png`]);
        expect(io.composed[0].png).toBe(s3.png);
        expect(io.composed[1].png).toBe(s2.png);
        expect(io.bytes).toEqual([[33], [22]]);
        const home = canvasHandoffLine(`${REL}/004.png`, "States.dc.html", [marks[0], marks[2]], HOME, [1, 3]);
        const later = canvasHandoffLine(`${REL}/005.png`, "States.dc.html", [marks[1]], LATER, [2]);
        expect(io.typed).toEqual([["blk-1", `${home} | ${later}\r`]]);
        expect(io.typed[0][1]).toContain('marks on States.dc.html, screen "Home", slot list = A: 1 a; 3 c | ');
        expect(io.typed[0][1]).toContain('marks on States.dc.html, screen "Later", slot list = B: 2 b');
        expect(getCanvas("a1")).toMatchObject({ mode: "terminal", marks: [] });
    });

    it("draws each group's boxes in its picture's pixels, scrolled and scaled, numbered across the groups", async () => {
        setMarks(threeMarks().marks);
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io, HOME);
        expect(io.composed[0].boxes).toEqual([
            { n: 1, x: 10, y: 20, w: 30, h: 40 },
            { n: 3, x: 100, y: 100, w: 20, h: 20 },
        ]);
        // 100 CSS px down the frame at 2 device px per CSS px
        expect(io.composed[1].boxes).toEqual([{ n: 2, x: 60, y: 80, w: 100, h: 40 }]);
        expect(io.composed.map((c) => c.scale)).toEqual([1, 2]);
    });

    it("leaves a removed mark out of its group's boxes and renumbers the rest", async () => {
        const { marks } = threeMarks();
        setMarks(removeMark(marks, 0));
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io, HOME);
        // Later is now the first context to appear (number 1), Home follows with its one mark left (number 2)
        expect(io.composed.map((c) => c.boxes.map((b) => b.n))).toEqual([[1], [2]]);
        expect(io.composed.map((c) => c.png)).toEqual([marks[1].shot!.png, marks[2].shot!.png]);
        const later = canvasHandoffLine(`${REL}/004.png`, "States.dc.html", [marks[1]], LATER, [1]);
        const home = canvasHandoffLine(`${REL}/005.png`, "States.dc.html", [marks[2]], HOME, [2]);
        expect(io.typed[0][1]).toBe(`${later} | ${home}\r`);
    });

    it("needs no capture and no board on screen when every group has its picture", async () => {
        setMarks(threeMarks().marks);
        const io = fakeIO({ boardRect: () => null });
        await sendCanvasMarks(AGENT, io, HOME);
        expect(io.events).toEqual([]);
        expect(io.written).toHaveLength(2);
    });

    it("falls back on an older picture of the group when its newest mark has none", async () => {
        const old = shot(44);
        setMarks([mark("a", HOME, old), mark("b", HOME, null)]);
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io, HOME);
        expect(io.composed).toHaveLength(1);
        expect(io.composed[0].png).toBe(old.png);
        expect(io.events).toEqual([]);
    });
});

describe("sendCanvasMarks for a group with no picture", () => {
    it("captures the board at Send, hiding the overlays, when the group's context is the one on screen", async () => {
        const marks = [mark("a", HOME, null, { x: 30, y: 30, w: 20, h: 20 })];
        setMarks(marks);
        const io = fakeIO({
            boardRect: () => ({ left: 50, top: 60, width: 200, height: 100 }),
            markOrigin: () => ({ left: 40, top: 50 }),
            pixelScale: async () => 2,
        });
        await sendCanvasMarks(AGENT, io, HOME);
        expect(io.events).toEqual(["hide", "capture", "crop", "show"]);
        expect(io.written).toEqual([`${DIR}/feedback/004.png`]);
        // the picture starts 10 CSS px into the frame's inside, at 2 device px per CSS px
        expect(io.composed[0].boxes).toEqual([{ n: 1, x: 40, y: 40, w: 40, h: 40 }]);
        expect(io.typed[0][1]).toBe(canvasHandoffLine(`${REL}/004.png`, "States.dc.html", marks, HOME) + "\r");
    });

    it("sends another context's group with its line and no picture, never a picture of what is on screen", async () => {
        const later = shot(22);
        const marks = [mark("a", HOME, null), mark("b", LATER, later)];
        setMarks(marks);
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io, LATER);
        // nothing was captured for HOME: the screen showing is LATER
        expect(io.events).toEqual([]);
        expect(io.written).toEqual([`${DIR}/feedback/004.png`]);
        expect(io.bytes).toEqual([[22]]);
        const home = canvasHandoffLine(null, "States.dc.html", [marks[0]], HOME, [1]);
        const laterLine = canvasHandoffLine(`${REL}/004.png`, "States.dc.html", [marks[1]], LATER, [2]);
        expect(io.typed).toEqual([["blk-1", `${home} | ${laterLine}\r`]]);
        expect(home.startsWith("look at")).toBe(false);
    });

    it("captures only the group on screen when two have no picture", async () => {
        const marks = [mark("a", HOME, null), mark("b", LATER, null)];
        setMarks(marks);
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io, LATER);
        expect(io.events).toEqual(["hide", "capture", "crop", "show"]);
        expect(io.written).toEqual([`${DIR}/feedback/004.png`]);
        expect(io.composed[0].boxes.map((b) => b.n)).toEqual([2]);
        expect(io.typed[0][1]).toBe(
            [
                canvasHandoffLine(null, "States.dc.html", [marks[0]], HOME, [1]),
                canvasHandoffLine(`${REL}/004.png`, "States.dc.html", [marks[1]], LATER, [2]),
            ].join(" | ") + "\r"
        );
    });

    it("writes no picture and makes no folder when no group has one and none is on screen", async () => {
        const marks = [mark("a", HOME, null)];
        setMarks(marks);
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io, LATER);
        expect(io.made).toEqual([]);
        expect(io.written).toEqual([]);
        expect(io.typed).toEqual([["blk-1", canvasHandoffLine(null, "States.dc.html", marks, HOME) + "\r"]]);
    });

    it("takes a group that has no screen and no slot for the one on screen when none is given", async () => {
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io);
        expect(io.events).toEqual(["hide", "capture", "crop", "show"]);
    });
});

describe("shootBoard", () => {
    it("captures with the overlays hidden, and reports where the picture sits in the frame", async () => {
        const io = fakeIO({
            boardRect: () => ({ left: 120, top: 80, width: 400, height: 300 }),
            markOrigin: () => ({ left: 101, top: 51 }),
            pixelScale: async () => 2,
        });
        const s = await shootBoard(io);
        expect(io.events).toEqual(["hide", "capture", "crop", "show"]);
        expect(s.rect).toEqual({ left: 19, top: 29, width: 400, height: 300 });
        expect(s.scale).toBe(2);
        expect(s.png).toBeInstanceOf(Blob);
    });

    it("puts the overlays back when the capture fails, and says what failed", async () => {
        const io = fakeIO({ capture: fail });
        await expect(shootBoard(io)).rejects.toThrow("Couldn't capture the board: boom");
        expect(io.events).toEqual(["hide", "show"]);
    });

    it("refuses a board that is not on screen without capturing", async () => {
        const io = fakeIO({ boardRect: (): null => null });
        await expect(shootBoard(io)).rejects.toThrow("The board isn't on screen");
        expect(io.events.filter((e) => e === "capture")).toEqual([]);
    });
});
