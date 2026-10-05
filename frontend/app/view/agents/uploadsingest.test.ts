import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createTemp: vi.fn(async (file: File) => `/tmp/${file.name}`),
    paste: vi.fn((_blockId: string, _text: string) => true),
    focus: vi.fn(),
    toast: vi.fn(),
    thumb: vi.fn(async (_blob: Blob) => "data:image/png;base64,THUMB"),
    fetch: vi.fn(),
    cancelBody: vi.fn(async () => {}),
    open: vi.fn(),
}));

vi.mock("@/app/view/term/termutil", () => ({ createTempFileFromFile: mocks.createTemp }));
vi.mock("@/app/view/term/termpaste", () => ({ pasteIntoTerm: mocks.paste, focusTerm: mocks.focus }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: mocks.toast }));
vi.mock("./uploadthumb", () => ({ makeThumbnail: mocks.thumb }));
vi.mock("@/util/fetchutil", () => ({ fetch: mocks.fetch }));
vi.mock("@/util/endpoints", () => ({ getWebServerEndpoint: () => "http://127.0.0.1:1" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import { MAX_UPLOAD_LABEL, THUMB_SOURCE_LIMIT_BYTES, UploadError } from "./uploadfile";
import { attachPaths, ingestFiles, pickAndAttach } from "./uploadsingest";
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

async function attach(...args: Parameters<typeof attachPaths>) {
    const done = attachPaths(...args);
    await vi.runAllTimersAsync();
    await done;
}

// what wavesrv answers for a local file; the length header is absent when `length` is left out
function fileResponse(length?: number, ok = true) {
    return {
        ok,
        headers: { get: (name: string) => (name === "content-length" && length != null ? String(length) : null) },
        blob: async () => new Blob([new Uint8Array([1])]),
        body: { cancel: mocks.cancelBody },
    };
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
    for (const m of [
        mocks.createTemp,
        mocks.paste,
        mocks.focus,
        mocks.toast,
        mocks.thumb,
        mocks.fetch,
        mocks.cancelBody,
        mocks.open,
    ]) {
        m.mockReset();
    }
    mocks.createTemp.mockImplementation(async (f: File) => `/tmp/${f.name}`);
    mocks.paste.mockImplementation(() => true);
    mocks.thumb.mockImplementation(async () => "data:image/png;base64,THUMB");
    mocks.cancelBody.mockImplementation(async () => {});
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

describe("attachPaths", () => {
    it("pastes each real path on its own, 150 ms apart, records it as attached and then focuses the terminal", async () => {
        const times: number[] = [];
        mocks.paste.mockImplementation(() => {
            times.push(Date.now());
            return true;
        });
        mocks.fetch.mockResolvedValue(fileResponse(1000));
        await attach(BLOCK, ["C:\\x\\a.txt", "C:\\x\\b c.png"]);

        expect(mocks.paste.mock.calls).toEqual([
            [BLOCK, "C:\\x\\a.txt "],
            [BLOCK, '"C:\\x\\b c.png" '],
        ]);
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(150);
        // nothing is copied, so the real path is what is recorded
        expect(mocks.createTemp).not.toHaveBeenCalled();
        const records = globalStore.get(uploadsAtom(BLOCK));
        expect(records.map((r) => [r.name, r.path, r.kind, r.source])).toEqual([
            ["b c.png", "C:\\x\\b c.png", "image", "attach"],
            ["a.txt", "C:\\x\\a.txt", "file", "attach"],
        ]);
        // once, after the last paste
        expect(mocks.focus).toHaveBeenCalledTimes(1);
        expect(mocks.focus).toHaveBeenCalledWith(BLOCK);
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it("reads an attached image back through wavesrv for its thumbnail, and only an image", async () => {
        mocks.fetch.mockResolvedValue(fileResponse(1000));
        await attach(BLOCK, ["C:\\x\\a.txt", "C:\\x\\b c.png"]);

        expect(mocks.fetch).toHaveBeenCalledTimes(1);
        expect(mocks.fetch.mock.calls[0][0]).toBe(
            `http://127.0.0.1:1/wave/stream-local-file?path=${encodeURIComponent("C:\\x\\b c.png")}`
        );
        expect(globalStore.get(uploadThumbsAtom)).toEqual({ "C:\\x\\b c.png": "data:image/png;base64,THUMB" });
    });

    it("pastes a path before it reads the picture of that file", async () => {
        const order: string[] = [];
        mocks.paste.mockImplementation(() => {
            order.push("paste");
            return true;
        });
        mocks.fetch.mockImplementation(async () => {
            order.push("fetch");
            return fileResponse(1000);
        });
        await attach(BLOCK, ["C:\\x\\a.png"]);

        expect(order).toEqual(["paste", "fetch"]);
    });

    it("records an image with the generic icon when its picture cannot be read", async () => {
        mocks.fetch.mockRejectedValue(new Error("connection refused"));
        await attach(BLOCK, ["C:\\x\\a.png"]);

        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["a.png"]);
        expect(globalStore.get(uploadThumbsAtom)).toEqual({});
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it("does not decode a file the server reports as missing or over the thumbnail limit", async () => {
        mocks.fetch
            .mockResolvedValueOnce(fileResponse(undefined, false))
            .mockResolvedValueOnce(fileResponse(THUMB_SOURCE_LIMIT_BYTES + 1));
        await attach(BLOCK, ["C:\\x\\gone.png", "C:\\x\\huge.png"]);

        expect(mocks.thumb).not.toHaveBeenCalled();
        // the unread body is let go
        expect(mocks.cancelBody).toHaveBeenCalledTimes(2);
        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["huge.png", "gone.png"]);
    });

    it("gives up on a picture that never comes and records the file without it", async () => {
        mocks.fetch.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
                })
        );
        await attach(BLOCK, ["C:\\x\\a.png"]);

        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["a.png"]);
        expect(globalStore.get(uploadThumbsAtom)).toEqual({});
    });

    it("pastes a path given twice once", async () => {
        await attach(BLOCK, ["C:\\x\\a.txt", "C:\\x\\a.txt"]);

        expect(mocks.paste).toHaveBeenCalledTimes(1);
        expect(globalStore.get(uploadsAtom(BLOCK))).toHaveLength(1);
    });

    it("records nothing and leaves the rest alone when the terminal cannot take a paste", async () => {
        mocks.paste.mockImplementation(() => false);
        await attach(BLOCK, ["C:\\x\\a.txt", "C:\\x\\b.txt"]);

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
        await attach(BLOCK, ["C:\\x\\a.txt", "C:\\x\\b.txt", "C:\\x\\c.txt"]);

        expect(mocks.paste).toHaveBeenCalledTimes(2);
        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["a.txt"]);
        expect(mocks.focus).toHaveBeenCalledWith(BLOCK);
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast.mock.calls[0][0]).toMatchObject({ title: "No terminal to insert into", level: "warn" });
    });

    it("turns a paste that throws into a toast naming the file and goes on with the next one", async () => {
        mocks.paste.mockImplementationOnce(() => {
            throw new Error("terminal disposed");
        });
        await attach(BLOCK, ["C:\\x\\a.txt", "C:\\x\\b.txt"]);

        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["b.txt"]);
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast.mock.calls[0][0]).toEqual({
            title: "Couldn't attach “a.txt”",
            message: "Its path can't be pasted into the terminal.",
            level: "warn",
        });
    });

    it("does not paste or record a path the terminal would receive as a different file", async () => {
        await attach(BLOCK, ["/x/odd\x7fname.txt", "/x/b.txt"]);

        expect(mocks.paste.mock.calls).toEqual([[BLOCK, "/x/b.txt "]]);
        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["b.txt"]);
        expect(mocks.toast.mock.calls[0][0]).toMatchObject({ title: expect.stringContaining("odd") });
    });

    it("names several refused files in one toast", async () => {
        mocks.paste.mockImplementation(() => {
            throw new Error("terminal disposed");
        });
        await attach(BLOCK, ["/x/a.txt", "/x/b.txt"]);

        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast.mock.calls[0][0]).toEqual({
            title: "2 files weren't attached",
            message: "Their paths can't be pasted into the terminal.",
            level: "warn",
        });
    });

    it("does nothing for no paths", async () => {
        await attach(BLOCK, []);

        expect(mocks.paste).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
    });
});

describe("pickAndAttach", () => {
    async function pick() {
        const done = pickAndAttach(BLOCK);
        // the dialog is a dynamic import, which takes real time the first time; the paste gap after it is a fake timer
        await vi.dynamicImportSettled();
        await vi.runAllTimersAsync();
        await done;
    }

    it("asks for several files and attaches what was picked", async () => {
        mocks.open.mockResolvedValue(["C:\\x\\a.txt", "C:\\x\\b.txt"]);
        await pick();

        expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, directory: false }));
        expect(mocks.paste).toHaveBeenCalledTimes(2);
        expect(globalStore.get(uploadsAtom(BLOCK)).map((r) => r.name)).toEqual(["b.txt", "a.txt"]);
    });

    it("attaches a single path the dialog returns as a string", async () => {
        mocks.open.mockResolvedValue("C:\\x\\a.txt");
        await pick();

        expect(mocks.paste.mock.calls).toEqual([[BLOCK, "C:\\x\\a.txt "]]);
    });

    it("does nothing when the dialog is cancelled", async () => {
        mocks.open.mockResolvedValue(null);
        await pick();

        expect(mocks.paste).not.toHaveBeenCalled();
        expect(mocks.focus).not.toHaveBeenCalled();
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it("opens one dialog when Attach is clicked twice before the first one closes", async () => {
        let close!: (picked: string[]) => void;
        mocks.open.mockReturnValue(
            new Promise<string[]>((resolve) => {
                close = resolve;
            })
        );
        const first = pickAndAttach(BLOCK);
        await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
        const second = pickAndAttach(BLOCK);
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.open).toHaveBeenCalledTimes(1);

        close(["C:\\x\\a.txt"]);
        await vi.runAllTimersAsync();
        await Promise.all([first, second]);
        expect(mocks.paste).toHaveBeenCalledTimes(1);

        // the dialog is free again once it has closed
        mocks.open.mockResolvedValue(null);
        await pick();
        expect(mocks.open).toHaveBeenCalledTimes(2);
    });

    it("tells the user when the dialog cannot open", async () => {
        mocks.open.mockRejectedValue(new Error("not allowed"));
        await pick();

        expect(mocks.paste).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast.mock.calls[0][0]).toMatchObject({
            title: "Couldn't open the file picker",
            level: "error",
        });
    });
});
