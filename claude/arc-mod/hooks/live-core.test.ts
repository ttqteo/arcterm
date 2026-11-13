import { describe, expect, it } from "vitest";
import { LIVE_WRITE_MS, LiveGather, liveFile, serialWriter } from "./live-core";

describe("liveFile", () => {
    it("names the session's file under ~/.arc/live", () => {
        expect(liveFile("/Users/me/", "391cd109-b8f6")).toBe("/Users/me/.arc/live/391cd109-b8f6.json");
        expect(liveFile("C:\\Users\\me", "abc_1")).toBe("C:\\Users\\me/.arc/live/abc_1.json");
    });

    it("is null with no home or an id that is no file name", () => {
        expect(liveFile(undefined, "abc")).toBeNull();
        expect(liveFile("", "abc")).toBeNull();
        expect(liveFile("/h", "../x")).toBeNull();
        expect(liveFile("/h", "")).toBeNull();
    });
});

describe("LiveGather", () => {
    it("joins each block's chunks, in block order, and skips empty chunks", () => {
        const g = new LiveGather("turn-1", 2);
        g.add("thinking", 0, "");
        g.add("text", 2, "and then");
        g.add("text", 1, "Hel");
        g.add("text", 1, "lo");
        expect(JSON.parse(g.payload(false, 1000))).toEqual({
            v: 1,
            turn: "turn-1",
            step: 2,
            blocks: [
                { index: 1, kind: "text", text: "Hello" },
                { index: 2, kind: "text", text: "and then" },
            ],
            done: false,
            at: 1000,
        });
    });

    it("has nothing to write for a step that only called tools", () => {
        const g = new LiveGather("t", 0);
        g.add("thinking", 0, "");
        expect(g.hasText()).toBe(false);
        expect(g.due(10_000)).toBe(false);
    });

    it("is due at once, then again LIVE_WRITE_MS after the last write", () => {
        const g = new LiveGather("t", 0);
        g.add("text", 0, "a");
        expect(g.due(5000)).toBe(true);
        g.payload(false, 5000);
        g.add("text", 0, "b");
        expect(g.due(5000 + LIVE_WRITE_MS - 1)).toBe(false);
        expect(g.due(5000 + LIVE_WRITE_MS)).toBe(true);
    });

    it("owes a trailing write for text that came after the last write, however long no chunk follows", () => {
        const g = new LiveGather("t", 0);
        expect(g.flushIn(0)).toBeNull();
        g.add("text", 0, "Writ");
        g.payload(false, 5000);
        expect(g.flushIn(5010)).toBeNull();
        // the rest of the text lands inside the window, then only a tool call's input streams
        g.add("text", 0, "ing the tests.");
        expect(g.due(5040)).toBe(false);
        expect(g.flushIn(5040)).toBe(LIVE_WRITE_MS - 40);
        expect(g.flushIn(5000 + LIVE_WRITE_MS + 500)).toBe(0);
        g.payload(false, 5000 + LIVE_WRITE_MS);
        expect(g.flushIn(5000 + LIVE_WRITE_MS)).toBeNull();
    });

    it("is not due again with nothing new since the last write", () => {
        const g = new LiveGather("t", 0);
        g.add("text", 0, "a");
        g.payload(false, 5000);
        expect(g.due(5000 + LIVE_WRITE_MS)).toBe(false);
    });
});

describe("serialWriter", () => {
    it("writes one at a time and ends with the last text, skipping the ones replaced while waiting", async () => {
        const written: string[] = [];
        let release: () => void = () => undefined;
        const w = serialWriter(
            (text) =>
                new Promise<void>((resolve) => {
                    written.push(text);
                    release = resolve;
                }),
            () => undefined
        );
        w.write("1");
        w.write("2");
        w.write("3");
        expect(written).toEqual(["1"]);
        release();
        await Promise.resolve();
        await Promise.resolve();
        expect(written).toEqual(["1", "3"]);
        release();
        await w.idle();
        expect(written).toEqual(["1", "3"]);
    });

    it("stops after a failed write and reports it once", async () => {
        const errors: unknown[] = [];
        let calls = 0;
        const w = serialWriter(
            async () => {
                calls++;
                throw new Error("EACCES");
            },
            (err) => errors.push(err)
        );
        w.write("a");
        await w.idle();
        w.write("b");
        await w.idle();
        expect(calls).toBe(1);
        expect(errors).toHaveLength(1);
    });
});
