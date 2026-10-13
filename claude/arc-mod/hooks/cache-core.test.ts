import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "./cache-core";
import { cacheMissNotice, transcriptEntries } from "./cache-core";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 8, 9, minute)).toISOString();

const prompt = (text = "go on"): TranscriptEntry => ({ type: "user", message: { content: text } });

// a request whose whole prompt is `read` from cache plus `written` to it
function request(id: string, minute: number, read: number, written: number, model = OPUS): TranscriptEntry {
    return {
        type: "assistant",
        timestamp: at(minute),
        message: {
            id,
            model,
            usage: { input_tokens: 0, cache_read_input_tokens: read, cache_creation_input_tokens: written },
        },
    };
}

describe("cacheMissNotice", () => {
    it("names the idle time when the cache window had passed", () => {
        const entries = [prompt(), request("a", 0, 0, 100_000), prompt(), request("b", 12, 15_000, 85_000)];
        expect(cacheMissNotice(entries)).toEqual("Cache miss: 85k re-billed, 12m idle");
    });

    it("names a model switch, even past the cache window", () => {
        const entries = [prompt(), request("a", 0, 0, 212_000), prompt(), request("b", 12, 0, 212_000, SONNET)];
        expect(cacheMissNotice(entries)).toEqual("Cache miss: 212k re-billed, model switch");
    });

    it("names no cause when there is neither", () => {
        const entries = [prompt(), request("a", 0, 0, 100_000), request("b", 1, 69_000, 31_000)];
        expect(cacheMissNotice(entries)).toEqual("Cache miss: 31k re-billed");
    });

    it("gives several misses in a turn as one notice of their count and total", () => {
        const entries = [
            prompt(),
            request("a", 0, 0, 100_000),
            prompt(),
            request("b", 12, 15_000, 85_000),
            request("c", 13, 45_000, 55_000, SONNET),
        ];
        expect(cacheMissNotice(entries)).toEqual("2 cache misses: 140k re-billed");
        expect(cacheMissNotice([...entries, request("d", 14, 70_000, 30_000, SONNET)])).toEqual(
            "3 cache misses: 170k re-billed"
        );
    });

    it("formats a million tokens and over as the script does", () => {
        const entries = [prompt(), request("a", 0, 0, 1_240_000), request("b", 1, 0, 1_240_000)];
        expect(cacheMissNotice(entries)).toEqual("Cache miss: 1.2M re-billed");
    });

    it("sends nothing for a miss under 20,000 tokens", () => {
        const entries = [prompt(), request("a", 0, 0, 100_000), request("b", 1, 80_001, 19_999)];
        expect(cacheMissNotice(entries)).toBeNull();
        expect(
            cacheMissNotice([prompt(), request("a", 0, 0, 100_000), request("b", 1, 80_000, 20_000)])
        ).not.toBeNull();
    });

    it("does not report an earlier turn's miss again after a new prompt", () => {
        const missed = [prompt(), request("a", 0, 0, 100_000), request("b", 1, 0, 100_000)];
        expect(cacheMissNotice(missed)).not.toBeNull();
        expect(cacheMissNotice([...missed, prompt(), request("c", 2, 100_000, 500)])).toBeNull();
    });

    it("keeps the turn open across a tool result, a meta row and a compact summary", () => {
        const entries: TranscriptEntry[] = [
            prompt(),
            request("a", 0, 0, 100_000),
            request("b", 1, 0, 100_000),
            { type: "user", message: { content: [{ type: "tool_result" }] } },
            { type: "user", isMeta: true, message: { content: "a skill's text" } },
            request("c", 2, 100_000, 500),
        ];
        expect(cacheMissNotice(entries)).toEqual("Cache miss: 100k re-billed");
    });

    it("starts the comparison over at a compaction boundary", () => {
        const before = [prompt(), request("a", 0, 0, 100_000)];
        const after = request("b", 1, 0, 50_000);
        expect(cacheMissNotice([...before, after])).not.toBeNull();
        expect(cacheMissNotice([...before, { type: "system", subtype: "compact_boundary" }, after])).toBeNull();
    });

    it("counts a response written as several lines once", () => {
        const entries = [
            prompt(),
            request("a", 0, 0, 100_000),
            request("b", 1, 0, 100_000),
            request("b", 1, 0, 100_000),
        ];
        expect(cacheMissNotice(entries)).toEqual("Cache miss: 100k re-billed");
    });

    it("ignores sidechain and synthetic-model entries", () => {
        const entries = [
            prompt(),
            request("a", 0, 0, 100_000),
            { ...request("s", 1, 0, 100_000), isSidechain: true },
            request("x", 1, 0, 100_000, "<synthetic>"),
            request("b", 2, 100_000, 500),
        ];
        expect(cacheMissNotice(entries)).toBeNull();
    });

    it("counts a request with no cache figures only once caching has been seen", () => {
        const uncached = (id: string, minute: number): TranscriptEntry => ({
            type: "assistant",
            timestamp: at(minute),
            message: { id, model: OPUS, usage: { input_tokens: 100_000 } },
        });
        expect(cacheMissNotice([prompt(), uncached("a", 0), uncached("b", 1)])).toBeNull();
        expect(cacheMissNotice([prompt(), request("a", 0, 0, 100_000), uncached("b", 1)])).toEqual(
            "Cache miss: 100k re-billed"
        );
    });

    it("holds the cache window at an hour once a 1-hour cache write is seen", () => {
        const hourWrite = request("a", 0, 0, 100_000);
        hourWrite.message.usage.cache_creation = { ephemeral_1h_input_tokens: 100_000 };
        const entries = [prompt(), hourWrite, prompt(), request("b", 12, 15_000, 85_000)];
        expect(cacheMissNotice(entries)).toEqual("Cache miss: 85k re-billed");
    });
});

describe("transcriptEntries", () => {
    it("drops blank lines and a half-written last line", () => {
        const text = `${JSON.stringify(prompt())}\n\n${JSON.stringify(request("a", 0, 0, 10))}\n{"type":"assis`;
        expect(transcriptEntries(text)).toEqual([prompt(), request("a", 0, 0, 10)]);
    });
});
