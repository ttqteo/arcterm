// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { NoteScratchReadCommand: vi.fn(), NoteScratchWriteCommand: vi.fn() },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./floatstore", async () => {
    const { atom } = await import("jotai");
    return { enterFloat: vi.fn(), floatModeAtom: atom(false) };
});

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import type { AgentsViewModel } from "./agents";
import { SCRATCH_SAVE_MS, scratchErrorLine } from "./floatnote";
import {
    closeFloatNote,
    editScratch,
    floatNoteOpenAtom,
    loadScratch,
    openFloatNote,
    scratchBodyAtom,
    scratchErrorAtom,
    scratchPreviewAtom,
    toggleFloatNote,
} from "./floatnotestore";
import { enterFloat, floatModeAtom } from "./floatstore";

const read = vi.mocked(RpcApi.NoteScratchReadCommand);
const write = vi.mocked(RpcApi.NoteScratchWriteCommand);

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    // a pending save from the last test must not leak into this one
    closeFloatNote();
    vi.resetAllMocks();
    globalStore.set(scratchBodyAtom, null);
    globalStore.set(scratchErrorAtom, null);
    globalStore.set(scratchPreviewAtom, false);
    globalStore.set(floatNoteOpenAtom, false);
    globalStore.set(floatModeAtom, false);
    write.mockResolvedValue(undefined);
    read.mockResolvedValue("");
});

afterEach(() => {
    vi.useRealTimers();
});

describe("editScratch", () => {
    it("saves once, SCRATCH_SAVE_MS after the last edit", async () => {
        editScratch("a");
        await vi.advanceTimersByTimeAsync(300);
        editScratch("ab");
        await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS - 1);
        expect(write).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith({}, { body: "ab" });
    });
    it("keeps the text and shows the error line after a failed save, and the next edit retries", async () => {
        const err = new Error("permission denied");
        write.mockRejectedValueOnce(err);
        editScratch("x");
        await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS);
        expect(globalStore.get(scratchBodyAtom)).toBe("x");
        expect(globalStore.get(scratchErrorAtom)).toBe(scratchErrorLine(err));
        editScratch("xy");
        await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS);
        expect(write).toHaveBeenLastCalledWith({}, { body: "xy" });
        expect(globalStore.get(scratchErrorAtom)).toBeNull();
    });
});

describe("closeFloatNote", () => {
    it("saves a pending edit at once and closes", async () => {
        globalStore.set(floatNoteOpenAtom, true);
        globalStore.set(scratchPreviewAtom, true);
        editScratch("x");
        closeFloatNote();
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith({}, { body: "x" });
        expect(globalStore.get(floatNoteOpenAtom)).toBe(false);
        expect(globalStore.get(scratchPreviewAtom)).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(write).toHaveBeenCalledTimes(1);
    });
});

describe("a failed save, then closing and reopening", () => {
    it("saves the same body again on close, and the reopen's read leaves the typed text", async () => {
        vi.mocked(enterFloat).mockImplementation(async () => {
            globalStore.set(floatModeAtom, true);
        });
        // a disk: the retry that lands is what the reopen's read finds
        let disk = "old";
        write.mockRejectedValueOnce(new Error("permission denied"));
        write.mockImplementation(async (_c, data) => {
            disk = data.body;
        });
        read.mockImplementation(async () => disk);
        editScratch("x");
        await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS);
        expect(write).toHaveBeenCalledTimes(1);
        closeFloatNote();
        expect(write).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenLastCalledWith({}, { body: "x" });
        await openFloatNote(model);
        expect(globalStore.get(scratchBodyAtom)).toBe("x");
    });
    it("keeps the typed text when the save keeps failing across a reopen", async () => {
        vi.mocked(enterFloat).mockImplementation(async () => {
            globalStore.set(floatModeAtom, true);
        });
        write.mockRejectedValue(new Error("permission denied"));
        read.mockResolvedValue("old");
        editScratch("x");
        closeFloatNote();
        await vi.advanceTimersByTimeAsync(0);
        await openFloatNote(model);
        expect(globalStore.get(scratchBodyAtom)).toBe("x");
        expect(globalStore.get(scratchErrorAtom)).not.toBeNull();
    });
    it("waits for the close's write before reading", async () => {
        const order: string[] = [];
        let landed!: () => void;
        write.mockImplementation(
            () =>
                new Promise<void>((r) => {
                    landed = () => {
                        order.push("write");
                        r();
                    };
                })
        );
        read.mockImplementation(async () => {
            order.push("read");
            return "x";
        });
        editScratch("x");
        closeFloatNote();
        const loading = loadScratch();
        await vi.advanceTimersByTimeAsync(0);
        expect(read).not.toHaveBeenCalled();
        landed();
        await loading;
        expect(order).toEqual(["write", "read"]);
    });
});

describe("loadScratch", () => {
    it("does not overwrite an edit made while it was reading", async () => {
        let resolve!: (s: string) => void;
        read.mockReturnValue(new Promise<string>((r) => (resolve = r)));
        const loading = loadScratch();
        editScratch("new");
        resolve("old");
        await loading;
        expect(globalStore.get(scratchBodyAtom)).toBe("new");
    });
    it("does not overwrite an edit made while it waited for a write", async () => {
        let release!: () => void;
        write.mockReturnValueOnce(new Promise<void>((r) => (release = r)));
        read.mockResolvedValue("old");
        editScratch("a");
        closeFloatNote();
        const loading = loadScratch();
        editScratch("typed");
        // the edit's save has started, so nothing is pending when the read returns
        await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS);
        release();
        await loading;
        expect(globalStore.get(scratchBodyAtom)).toBe("typed");
    });
    it("sets the body from the read", async () => {
        read.mockResolvedValue("hello");
        await loadScratch();
        expect(globalStore.get(scratchBodyAtom)).toBe("hello");
    });
});

const model = { id: "m" } as unknown as AgentsViewModel;

describe("openFloatNote", () => {
    it("reads the note each time and enters Float when not floating", async () => {
        vi.mocked(enterFloat).mockImplementation(async () => {
            globalStore.set(floatModeAtom, true);
        });
        await openFloatNote(model);
        expect(globalStore.get(floatNoteOpenAtom)).toBe(true);
        closeFloatNote();
        await openFloatNote(model);
        expect(globalStore.get(floatNoteOpenAtom)).toBe(true);
        expect(read).toHaveBeenCalledTimes(2);
        // the second open found Float already on
        expect(enterFloat).toHaveBeenCalledTimes(1);
    });
    it("leaves the note closed when enterFloat does not float", async () => {
        vi.mocked(enterFloat).mockResolvedValue(undefined);
        await openFloatNote(model);
        expect(globalStore.get(floatNoteOpenAtom)).toBe(false);
    });
});

describe("toggleFloatNote", () => {
    it("goes back to the terminal from the open note", async () => {
        globalStore.set(floatModeAtom, true);
        globalStore.set(floatNoteOpenAtom, true);
        await toggleFloatNote(model);
        expect(globalStore.get(floatNoteOpenAtom)).toBe(false);
        expect(enterFloat).not.toHaveBeenCalled();
    });
    it("opens the note from a terminal", async () => {
        globalStore.set(floatModeAtom, true);
        await toggleFloatNote(model);
        expect(globalStore.get(floatNoteOpenAtom)).toBe(true);
    });
});
