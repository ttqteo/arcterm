import { beforeEach, describe, expect, it, vi } from "vitest";
import { maybeCaptureThumb, THUMB_W, thumbPath, type ThumbIO } from "./canvasthumb";

const EL = {} as HTMLElement;
const RECT = { left: 10, top: 20, width: 600, height: 375 };

type Fake = ThumbIO & { calls: string[]; written: { path: string; bytes: number[] }[]; scaled: number[] };

function fakeIO(over: Partial<ThumbIO> = {}): Fake {
    const io: Fake = {
        calls: [],
        written: [],
        scaled: [],
        thumbTime: async () => 0,
        boardRect: () => RECT,
        capture: async () => {
            io.calls.push("capture");
            return new Blob([new Uint8Array([1])], { type: "image/png" });
        },
        crop: async (png) => {
            io.calls.push("crop");
            return png;
        },
        scale: async (_png, width) => {
            io.calls.push("scale");
            io.scaled.push(width);
            return new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" });
        },
        write: async (path, bytes) => {
            io.calls.push("write");
            io.written.push({ path, bytes: [...bytes] });
        },
        ...over,
    };
    return io;
}

// the module remembers a topic once its preview is written, so every test takes its own topic folder
let n = 0;
const topicDir = () => `/p/.superpowers/design/topic-${++n}`;

describe("thumbPath", () => {
    it("keeps the folder's own separator and trailing slash", () => {
        expect(thumbPath("D:\\p\\.superpowers\\design\\t")).toBe("D:\\p\\.superpowers\\design\\t\\thumb.png");
        expect(thumbPath("/p/.superpowers/design/t")).toBe("/p/.superpowers/design/t/thumb.png");
        expect(thumbPath("/p/design/t/")).toBe("/p/design/t/thumb.png");
    });
});

describe("maybeCaptureThumb", () => {
    // a swallowed failure is logged at debug level; the test run does not need the stack
    beforeEach(() => {
        vi.spyOn(console, "debug").mockImplementation(() => {});
    });

    it("writes the preview when there is none", async () => {
        const io = fakeIO();
        const dir = topicDir();
        await maybeCaptureThumb(io, { topicDir: dir, boardEl: EL, modts: 1000 });
        expect(io.calls).toEqual(["capture", "crop", "scale", "write"]);
        expect(io.scaled).toEqual([THUMB_W]);
        expect(io.written).toEqual([{ path: `${dir}/thumb.png`, bytes: [7, 8, 9] }]);
    });

    it("writes it when the board changed after the preview", async () => {
        const io = fakeIO({ thumbTime: async () => 500 });
        await maybeCaptureThumb(io, { topicDir: topicDir(), boardEl: EL, modts: 1000 });
        expect(io.written).toHaveLength(1);
    });

    it("skips when the preview is as new as the board", async () => {
        const io = fakeIO({ thumbTime: async () => 1000 });
        await maybeCaptureThumb(io, { topicDir: topicDir(), boardEl: EL, modts: 1000 });
        expect(io.calls).toEqual([]);
    });

    it("skips the second call for a topic it already captured", async () => {
        const io = fakeIO();
        const dir = topicDir();
        await maybeCaptureThumb(io, { topicDir: dir, boardEl: EL, modts: 1000 });
        await maybeCaptureThumb(io, { topicDir: dir, boardEl: EL, modts: 2000 });
        expect(io.written).toHaveLength(1);
    });

    it("skips a call that arrives while the first is still under way", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => (release = r));
        const io = fakeIO({ capture: async () => (await gate, new Blob([new Uint8Array([1])])) });
        const dir = topicDir();
        const first = maybeCaptureThumb(io, { topicDir: dir, boardEl: EL, modts: 1000 });
        await maybeCaptureThumb(io, { topicDir: dir, boardEl: EL, modts: 1000 });
        release();
        await first;
        expect(io.written).toHaveLength(1);
    });

    it("writes nothing when the capture throws, and tries again on a later call", async () => {
        let fail = true;
        const io = fakeIO({
            capture: async () => {
                if (fail) {
                    throw new Error("window capture is Windows-only");
                }
                return new Blob([new Uint8Array([1])]);
            },
        });
        const dir = topicDir();
        await expect(maybeCaptureThumb(io, { topicDir: dir, boardEl: EL, modts: 1000 })).resolves.toBeUndefined();
        expect(io.written).toEqual([]);
        fail = false;
        await maybeCaptureThumb(io, { topicDir: dir, boardEl: EL, modts: 1000 });
        expect(io.written).toHaveLength(1);
    });

    it("writes nothing when the board is not on screen", async () => {
        for (const rect of [null, { left: 0, top: 0, width: 0, height: 300 }]) {
            const io = fakeIO({ boardRect: () => rect });
            await maybeCaptureThumb(io, { topicDir: topicDir(), boardEl: EL, modts: 1000 });
            expect(io.calls).toEqual([]);
        }
    });

    it("writes nothing when the preview cannot be read", async () => {
        const io = fakeIO({
            thumbTime: async () => {
                throw new Error("no rpc");
            },
        });
        await maybeCaptureThumb(io, { topicDir: topicDir(), boardEl: EL, modts: 1000 });
        expect(io.calls).toEqual([]);
    });
});
