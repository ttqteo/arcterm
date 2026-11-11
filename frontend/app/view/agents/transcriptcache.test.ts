import { describe, expect, it } from "vitest";
import { TranscriptCache } from "./transcriptcache";

describe("TranscriptCache", () => {
    it("gives back what was put under the same path and runtime, and nothing for another", () => {
        const c = new TranscriptCache<{ n: number }>(3);
        c.put("/t/a.jsonl", "claude", { n: 1 });
        expect(c.get("/t/a.jsonl", "claude")).toEqual({ n: 1 });
        expect(c.get("/t/a.jsonl", "pi")).toBeUndefined();
        expect(c.get("/t/b.jsonl", "claude")).toBeUndefined();
    });

    it("keeps the newest put for a path", () => {
        const c = new TranscriptCache<{ n: number }>(3);
        c.put("/t/a.jsonl", undefined, { n: 1 });
        c.put("/t/a.jsonl", undefined, { n: 2 });
        expect(c.get("/t/a.jsonl", undefined)).toEqual({ n: 2 });
    });

    it("drops the least recently used past its size, a get counting as a use", () => {
        const c = new TranscriptCache<number>(2);
        c.put("a", undefined, 1);
        c.put("b", undefined, 2);
        c.get("a", undefined);
        c.put("c", undefined, 3);
        expect(c.get("a", undefined)).toBe(1);
        expect(c.get("b", undefined)).toBeUndefined();
        expect(c.get("c", undefined)).toBe(3);
    });

    it("keeps nothing for an empty path", () => {
        const c = new TranscriptCache<number>(2);
        c.put("", undefined, 1);
        expect(c.get("", undefined)).toBeUndefined();
    });
});
