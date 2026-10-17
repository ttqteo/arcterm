import { describe, expect, it } from "vitest";
import { GiB, MEM_CHUNK, MIN_FREE_GB, memCap, memDelta, parseArgs, parseLog, percentile, redReasons, summarize, tallyLog } from "./termflood.mjs";

describe("summarize", () => {
    it("takes percentiles over successful samples only and counts failures", () => {
        const samples = [10, 20, 30, 40, 2500].map((ms) => ({ ms, ok: true }));
        samples.push({ ms: 10_000, ok: false });
        expect(summarize(samples)).toEqual({ n: 6, failed: 1, p50: 30, p95: 2500, max: 2500 });
    });

    it("has no percentiles when nothing succeeded", () => {
        expect(summarize([{ ms: 5, ok: false }])).toEqual({ n: 1, failed: 1, p50: null, p95: null, max: null });
        expect(percentile([], 50)).toBeNull();
    });
});

describe("parseLog", () => {
    it("stamps lines with their local time and drops continuation lines", () => {
        const entries = parseLog("2026-10-16 00:04:46.076 [wavesrv] a\n\tgoroutine 1\r\n2026-10-16 00:04:47.000 [tauri] b\n");
        expect(entries.map((e) => e.line)).toEqual(["2026-10-16 00:04:46.076 [wavesrv] a", "2026-10-16 00:04:47.000 [tauri] b"]);
        expect(entries[1].ts - entries[0].ts).toBe(924);
        expect(entries[0].ts).toBe(new Date(2026, 9, 16, 0, 4, 46, 76).getTime());
    });
});

describe("tallyLog", () => {
    const L = (s) => ({ ts: 0, line: `2026-10-16 00:00:00.000 [wavesrv] ${s}` });

    it("counts dropped appends, deadlines and failed flushes, and keeps the highest backlog", () => {
        const t = tallyLog([
            L("error appending to blockfile: error appending to blockfile: error getting file: context deadline exceeded"),
            L("filestore flush: 1/1 entries flushed, err:<nil>"),
            L("filestore flush: 0/2 entries flushed, err:context deadline exceeded"),
            L("[router] backlog for linkid=5 reached 100 messages"),
            L("[router] backlog for linkid=5 cleared (highwater mark was 412 messages)"),
            L("[router] backlog for linkid=7 cleared, link gone (highwater mark was 20 messages)"),
        ]);
        expect(t).toEqual({ appendErrors: 1, deadlineExceeded: 2, flushErrors: 1, backlogMax: 412 });
    });
});

describe("redReasons", () => {
    const quiet = { appendErrors: 0, deadlineExceeded: 0, flushErrors: 0, backlogMax: 12 };

    it("is green under the 2s line with nothing dropped", () => {
        expect(redReasons({ n: 3, failed: 0, max: 2000 }, quiet)).toEqual([]);
    });

    it("names a slow round-trip, a failed snapshot and a dropped append", () => {
        const r = redReasons({ n: 3, failed: 1, max: 2001 }, { ...quiet, appendErrors: 2 });
        expect(r).toHaveLength(3);
        expect(r.join(";")).toMatch(/2001ms.*1 resmon.*2 terminal append/);
    });
});

describe("parseArgs", () => {
    it("defaults to one unseen tab at the incident's rate with no load, and 4 GB left free under load", () => {
        expect(parseArgs([])).toEqual({ rate: 180, secs: 60, port: 9222, view: 0, tabs: 1, load: 0, free: 4 });
        expect(parseArgs(["--load", "1", "--free", "6", "--tabs", "12"])).toMatchObject({ load: 1, free: 6, tabs: 12 });
    });

    it("rejects unknown flags, missing values and a free target under the floor", () => {
        expect(() => parseArgs(["--loud", "1"])).toThrow(/bad argument/);
        expect(() => parseArgs(["--load"])).toThrow(/bad argument/);
        expect(() => parseArgs(["--free", String(MIN_FREE_GB - 0.5)])).toThrow(/never leaves less than 2 GB/);
        expect(parseArgs(["--free", String(MIN_FREE_GB)]).free).toBe(MIN_FREE_GB);
    });
});

describe("memDelta", () => {
    const cap = 28 * GiB;
    const target = 4 * GiB;
    const step = (free, chunks) => memDelta({ free, held: chunks * MEM_CHUNK, cap, target });

    it("takes one chunk at a time while a chunk still fits above the target", () => {
        expect(step(20 * GiB, 0)).toBe(1);
        expect(step(target + MEM_CHUNK, 10)).toBe(1);
    });

    it("holds inside the band between the target and one chunk above it", () => {
        expect(step(target, 10)).toBe(0);
        expect(step(target + MEM_CHUNK - 1, 10)).toBe(0);
    });

    it("releases enough chunks to get back to the target when something else takes memory", () => {
        expect(step(target - 1, 10)).toBe(-1);
        expect(step(target - 3 * MEM_CHUNK, 10)).toBe(-3);
        expect(step(target - 3 * MEM_CHUNK - 1, 10)).toBe(-4);
    });

    it("never releases more than it holds, and holds nothing back when it holds nothing", () => {
        expect(step(GiB, 2)).toBe(-2);
        expect(step(GiB, 0)).toBe(0);
    });

    it("never holds more than the cap, however much reads as free", () => {
        const max = cap / MEM_CHUNK;
        expect(step(20 * GiB, max - 1)).toBe(1);
        expect(step(20 * GiB, max)).toBe(0);
    });
});

describe("memCap", () => {
    it("leaves the target in RAM when commit has room", () => {
        expect(memCap({ total: 32 * GiB, target: 4 * GiB, commitFree: 40 * GiB })).toBe(28 * GiB);
    });

    it("leaves the floor of commit when commit is the tighter limit", () => {
        expect(memCap({ total: 32 * GiB, target: 4 * GiB, commitFree: 5 * GiB })).toBe((5 - MIN_FREE_GB) * GiB);
        expect(memCap({ total: 32 * GiB, target: 4 * GiB, commitFree: GiB })).toBe(0);
    });
});
