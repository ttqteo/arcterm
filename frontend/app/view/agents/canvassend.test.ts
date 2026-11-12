// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { canvasHandoffLine, type Mark } from "./canvasmarks";
import { sendCanvasMarks, type SendIO } from "./canvassend";
import { attachCanvas, detachCanvas, getCanvas, setCanvasMode, updateCanvas } from "./canvasstore";

const AGENT = { id: "a1", name: "Arc", blockId: "blk-1" } as AgentVM;
const DIR = "/p/.superpowers/design/t";
const MARKS: Mark[] = [
    { x: 10, y: 10, w: 40, h: 40, note: "too wide" },
    { x: 60, y: 60, w: 20, h: 20, note: "" },
];

type Fake = SendIO & { typed: [string, string][]; written: string[]; made: string[] };

function fakeIO(over: Partial<SendIO> = {}): Fake {
    const io: Fake = {
        typed: [],
        written: [],
        made: [],
        capture: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        crop: async (png) => png,
        boardRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        mkdir: async (path) => {
            io.made.push(path);
        },
        list: async () => ["001.png", "002.png", "003.png", "notes.txt"],
        write: async (path) => {
            io.written.push(path);
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
        expect(io.typed).toEqual([
            ["blk-1", canvasHandoffLine(".superpowers/design/t/feedback/004.png", "States.dc.html", MARKS) + "\r"],
        ]);
        const s = getCanvas("a1")!;
        expect(s.mode).toBe("terminal");
        expect(s.marking).toBe(false);
        expect(s.marks).toEqual([]);
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
        updateCanvas("a1", (s) => ({ ...s, board: null, boards: [{ name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 }] }));
        const io = fakeIO({ list: async () => [] });
        await sendCanvasMarks(AGENT, io);
        expect(io.typed[0][1]).toBe(
            canvasHandoffLine(".superpowers/design/t/feedback/001.png", "Main.dc.html", MARKS) + "\r"
        );
    });

    it("keeps a Windows dir's separators", async () => {
        updateCanvas("a1", (s) => ({ ...s, dir: "C:\\p\\.superpowers\\design\\t" }));
        const io = fakeIO();
        await sendCanvasMarks(AGENT, io);
        expect(io.written).toEqual(["C:\\p\\.superpowers\\design\\t\\feedback\\004.png"]);
    });
});
