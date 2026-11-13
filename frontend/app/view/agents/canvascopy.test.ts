// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { copyBoardShot, type CopyShotIO } from "./canvascopy";

vi.mock("./canvassend", () => ({ tauriSendIO: {} }));
vi.mock("./canvasthumb", () => ({ tauriThumbIO: {} }));

const el = {} as HTMLElement;
const rect = { left: 10, top: 20, width: 300, height: 200 };

function fakeIO(over: Partial<CopyShotIO> = {}): CopyShotIO & { written: Blob[] } {
    const written: Blob[] = [];
    return {
        written,
        boardRect: () => rect,
        capture: async () => new Blob(["window"]),
        crop: async (_png, r) => new Blob([`crop ${r.left},${r.top},${r.width}x${r.height}`]),
        writeImage: async (png) => {
            written.push(png);
        },
        ...over,
    };
}

describe("copyBoardShot", () => {
    it("crops the window capture to the board and copies it", async () => {
        const io = fakeIO();
        await copyBoardShot(io, el);
        expect(io.written).toHaveLength(1);
        expect(await io.written[0].text()).toBe("crop 10,20,300x200");
    });

    it("refuses a board that is off screen, capturing nothing", async () => {
        const capture = vi.fn(async () => new Blob(["window"]));
        const io = fakeIO({ boardRect: () => ({ left: 0, top: 0, width: 300, height: 0 }), capture });
        await expect(copyBoardShot(io, el)).rejects.toThrow("The board isn't on screen");
        expect(capture).not.toHaveBeenCalled();
        await expect(copyBoardShot(fakeIO({ boardRect: () => null }), el)).rejects.toThrow("isn't on screen");
    });

    it("says which step failed", async () => {
        const noCapture = fakeIO({
            capture: async () => {
                throw new Error("minimised");
            },
        });
        await expect(copyBoardShot(noCapture, el)).rejects.toThrow("Couldn't capture the board: minimised");
        const noClipboard = fakeIO({
            writeImage: async () => {
                throw new Error("denied");
            },
        });
        await expect(copyBoardShot(noClipboard, el)).rejects.toThrow(
            "Couldn't put the picture on the clipboard: denied"
        );
    });
});
