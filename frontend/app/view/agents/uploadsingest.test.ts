import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createTemp: vi.fn(async (file: File) => `/tmp/${file.name}`),
    paste: vi.fn((_blockId: string, _text: string) => true),
    focus: vi.fn(),
    toast: vi.fn(),
    thumb: vi.fn(async (_blob: Blob) => "data:image/png;base64,THUMB"),
}));

vi.mock("@/app/view/term/termutil", () => ({ createTempFileFromFile: mocks.createTemp }));
vi.mock("@/app/view/term/termpaste", () => ({ pasteIntoTerm: mocks.paste, focusTerm: mocks.focus }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: mocks.toast }));
vi.mock("./uploadthumb", () => ({ makeThumbnail: mocks.thumb }));

import { MAX_UPLOAD_LABEL, UploadError } from "./uploadfile";
import { ingestFiles } from "./uploadsingest";
import { uploadsAtom, uploadsMapAtom, uploadThumbsAtom } from "./uploadsstore";

const BLOCK = "blk-1";
let errorSpy: { mockRestore(): void };
// ingestFiles keeps a module-level clock of the next free paste slot, which outlives a test: every test starts its fake
// clock well past anything the one before reserved
let clock = 1_800_000_000_000;
const file = (name: string, type = "") => new File([new Uint8Array([1])], name, { type });

// the 150 ms gap between pastes is a real timer; run it on the fake clock
async function drop(...args: Parameters<typeof ingestFiles>) {
    const done = ingestFiles(...args);
    await vi.runAllTimersAsync();
    await done;
}

beforeEach(() => {
    vi.useFakeTimers();
    clock += 60_000;
    vi.setSystemTime(clock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    globalStore.set(uploadsMapAtom, {});
    globalStore.set(uploadThumbsAtom, {});
});

afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
    for (const m of [mocks.createTemp, mocks.paste, mocks.focus, mocks.toast, mocks.thumb]) {
        m.mockClear();
    }
    mocks.createTemp.mockImplementation(async (f: File) => `/tmp/${f.name}`);
    mocks.paste.mockImplementation(() => true);
});

describe("ingestFiles", () => {
    it("pastes each file on its own, 150 ms apart, records it and then focuses the terminal", async () => {
        const times: number[] = [];
        mocks.paste.mockImplementation(() => {
            times.push(Date.now());
            return true;
        });
        await drop(BLOCK, [file("a.txt"), file("b c.png", "image/png")], []);

        expect(mocks.paste.mock.calls).toEqual([
            [BLOCK, "/tmp/a.txt "],
            [BLOCK, '"/tmp/b c.png" '],
        ]);
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(150);
        const records = globalStore.get(uploadsAtom(BLOCK));
        expect(records.map((r) => [r.name, r.kind, r.source])).toEqual([
            ["b c.png", "image", "drop"],
            ["a.txt", "file", "drop"],
        ]);
        // only the image is decoded for a thumbnail
        expect(mocks.thumb).toHaveBeenCalledTimes(1);
        expect(globalStore.get(uploadThumbsAtom)).toEqual({ "/tmp/b c.png": "data:image/png;base64,THUMB" });
        expect(mocks.focus).toHaveBeenCalledWith(BLOCK);
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it("records nothing and leaves the rest of the drop alone when the terminal cannot take a paste", async () => {
        mocks.paste.mockImplementation(() => false);
        await drop(BLOCK, [file("a.txt"), file("b.txt")], []);

        expect(mocks.createTemp).toHaveBeenCalledTimes(1);
        expect(mocks.paste).toHaveBeenCalledTimes(1);
        expect(globalStore.get(uploadsAtom(BLOCK))).toEqual([]);
        expect(mocks.focus).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast.mock.calls[0][0]).toEqual({
            title: "No terminal to insert into",
            message: "This agent's terminal is not open or not ready for input. Try again in a moment.",
            level: "warn",
        });
    });

    it("keeps what already went in when the terminal stops taking pastes partway", async () => {
        mocks.paste.mockImplementationOnce(() => true).mockImplementationOnce(() => false);
        await drop(BLOCK, [file("a.txt"), file("b.txt"), file("c.txt")], []);

        expect(mocks.createTemp).toHaveBeenCalledTimes(2);
        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["a.txt"]);
        expect(mocks.focus).toHaveBeenCalledWith(BLOCK);
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast.mock.calls[0][0]).toMatchObject({ title: "No terminal to insert into", level: "warn" });
    });

    it("keeps pastes 150 ms apart when two drops are in flight at once", async () => {
        const times: number[] = [];
        mocks.paste.mockImplementation(() => {
            times.push(Date.now());
            return true;
        });
        const first = ingestFiles(BLOCK, [file("a.txt")], []);
        const second = ingestFiles("blk-2", [file("b.txt")], []);
        await vi.runAllTimersAsync();
        await Promise.all([first, second]);

        expect(times).toHaveLength(2);
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(150);
    });

    it("turns a paste that throws into the failed-copy toast and goes on with the next file", async () => {
        mocks.paste.mockImplementationOnce(() => {
            throw new Error("terminal disposed");
        });
        await drop(BLOCK, [file("a.txt"), file("b.txt")], []);

        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["b.txt"]);
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast.mock.calls[0][0]).toMatchObject({
            title: "Couldn't add “a.txt”",
            message: "Copying it to a temporary file failed.",
            level: "warn",
        });
    });

    it("does not paste or record a path the terminal would receive as a different file", async () => {
        mocks.createTemp.mockImplementationOnce(async () => "/tmp/odd\x7fname.txt");
        await drop(BLOCK, [file("odd\x7fname.txt"), file("b.txt")], []);

        expect(mocks.paste.mock.calls).toEqual([[BLOCK, "/tmp/b.txt "]]);
        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["b.txt"]);
        expect(mocks.toast.mock.calls[0][0]).toMatchObject({ title: expect.stringContaining("odd") });
    });

    it("names what the drop refused and what the copy refused in one toast, and takes the rest", async () => {
        mocks.createTemp.mockImplementationOnce(async (f: File) => {
            throw new UploadError("too-large", f.name);
        });
        await drop(BLOCK, [file("big.bin"), file("ok.txt")], [{ name: "dir", code: "directory" }]);

        expect(mocks.paste.mock.calls).toEqual([[BLOCK, "/tmp/ok.txt "]]);
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        const toast = mocks.toast.mock.calls[0][0];
        expect(toast.title).toBe("2 items weren't added");
        expect(toast.message).toContain(`1 over ${MAX_UPLOAD_LABEL}, 1 folder`);
    });

    it("does not focus the terminal when nothing went in", async () => {
        await drop(BLOCK, [], [{ name: "dir", code: "directory" }]);

        expect(mocks.paste).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledTimes(1);
    });
});
