// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    PEEK_EMPTY,
    PEEK_OLDER_EDGE_PX,
    PEEK_READING_DELAY_MS,
    PEEK_READING_OLDER,
    PEEK_START,
    createPeekLoader,
    peekCacheKey,
    peekCursor,
    peekMeta,
    peekOlderBegin,
    peekOlderFailed,
    peekOlderLoaded,
    peekOlderStart,
    peekOlderWanted,
    peekView,
    resumeStepShows,
    type PeekOutcome,
    type PeekResult,
} from "./launcherpeek";

function session(id: string, extra: Partial<SessionInfo> = {}): SessionInfo {
    return {
        id,
        runtime: "claude",
        projectpath: "D:\\p",
        projectname: "p",
        branch: "main",
        task: "a task",
        model: "claude-opus-5-5",
        tokenstotal: 412_000,
        lastactivets: 1_000,
        resumecommand: "",
        transcriptpath: `C:\\t\\${id}.jsonl`,
        ...extra,
    };
}

const result = (n: number, capped = false, before = 0, prefix = "m"): PeekResult => ({
    messages: Array.from({ length: n }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        text: `${prefix}${i}`,
        ts: i,
    })),
    capped,
    before,
    answered: false,
});

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("resumeStepShows", () => {
    it("shows for Claude Code once a past session is picked, until you go back", () => {
        expect(resumeStepShows(true, "claude", "resume", true)).toBe(true);
        expect(resumeStepShows(false, "claude", "resume", true)).toBe(false);
    });
    it("New session keeps the three columns", () => {
        expect(resumeStepShows(true, "claude", "resume", false)).toBe(false);
    });
    it("never for another agent, nor without a session list (Home, no sessions yet, a tool)", () => {
        expect(resumeStepShows(true, "pi", "resume", true)).toBe(false);
        expect(resumeStepShows(true, "codex", "resume", true)).toBe(false);
        expect(resumeStepShows(true, "claude", null, true)).toBe(false);
        expect(resumeStepShows(true, "claude", "tools", true)).toBe(false);
    });
});

describe("peekCacheKey", () => {
    it("is the transcript path plus the last activity, so a session that moved on reads again", () => {
        const a = session("a");
        expect(peekCacheKey(a)).toBe(peekCacheKey({ ...a }));
        expect(peekCacheKey(a)).not.toBe(peekCacheKey({ ...a, lastactivets: 2_000 }));
        expect(peekCacheKey(a)).not.toBe(peekCacheKey(session("b")));
    });
});

describe("createPeekLoader", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("waits until the pick has been still: holding ↓ across 9 sessions fetches once", async () => {
        const fetch = vi.fn(async (s: SessionInfo) => result(2));
        const loader = createPeekLoader({ fetch });
        const seen: string[] = [];
        for (let i = 0; i < 9; i++) {
            const id = `s${i}`;
            loader.request(session(id), () => seen.push(id));
            await vi.advanceTimersByTimeAsync(40);
        }
        expect(fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(150);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0].id).toBe("s8");
        expect(seen).toEqual(["s8"]);
    });

    it("drops a read a newer pick overtook before its fetch resolved", async () => {
        const first = deferred<PeekResult>();
        const second = deferred<PeekResult>();
        const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const loader = createPeekLoader({ fetch });
        const got: [string, PeekOutcome][] = [];
        loader.request(session("a"), (o) => got.push(["a", o]));
        await vi.advanceTimersByTimeAsync(150);
        loader.request(session("b"), (o) => got.push(["b", o]));
        await vi.advanceTimersByTimeAsync(150);
        expect(fetch).toHaveBeenCalledTimes(2);
        second.resolve(result(3));
        first.resolve(result(1));
        await vi.runAllTimersAsync();
        expect(got).toEqual([["b", { ok: true, result: result(3) }]]);
    });

    it("answers a cached session at once with no fetch", async () => {
        const fetch = vi.fn(async () => result(4));
        const loader = createPeekLoader({ fetch });
        loader.request(session("a"), () => {});
        await vi.advanceTimersByTimeAsync(150);
        expect(fetch).toHaveBeenCalledTimes(1);
        const got: PeekOutcome[] = [];
        loader.request(session("a"), (o) => got.push(o));
        expect(got).toEqual([{ ok: true, result: result(4) }]);
        await vi.advanceTimersByTimeAsync(500);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("reads again once the session has moved on", async () => {
        const fetch = vi.fn(async () => result(4));
        const loader = createPeekLoader({ fetch });
        loader.request(session("a"), () => {});
        await vi.advanceTimersByTimeAsync(150);
        loader.request(session("a", { lastactivets: 9_000 }), () => {});
        await vi.advanceTimersByTimeAsync(150);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("never caches an error, and says what it was", async () => {
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new Error("open C:\\t\\a.jsonl: no such file"))
            .mockResolvedValueOnce(result(1));
        const loader = createPeekLoader({ fetch });
        const got: PeekOutcome[] = [];
        loader.request(session("a"), (o) => got.push(o));
        await vi.advanceTimersByTimeAsync(150);
        expect(got).toEqual([{ ok: false, error: "open C:\\t\\a.jsonl: no such file" }]);
        loader.request(session("a"), (o) => got.push(o));
        await vi.advanceTimersByTimeAsync(150);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(got[1]).toEqual({ ok: true, result: result(1) });
    });

    it("evicts the oldest entry past the cache limit of 20", async () => {
        const fetch = vi.fn(async () => result(1));
        const loader = createPeekLoader({ fetch });
        for (let i = 0; i < 21; i++) {
            loader.request(session(`s${i}`), () => {});
            await vi.advanceTimersByTimeAsync(150);
        }
        expect(fetch).toHaveBeenCalledTimes(21);
        // s1 is still cached; s0, the oldest, was evicted
        loader.request(session("s1"), () => {});
        await vi.advanceTimersByTimeAsync(150);
        expect(fetch).toHaveBeenCalledTimes(21);
        loader.request(session("s0"), () => {});
        await vi.advanceTimersByTimeAsync(150);
        expect(fetch).toHaveBeenCalledTimes(22);
    });

    it("dispose drops the cache and every pending callback", async () => {
        const pending = deferred<PeekResult>();
        const fetch = vi.fn().mockResolvedValueOnce(result(2)).mockReturnValueOnce(pending.promise);
        const loader = createPeekLoader({ fetch });
        loader.request(session("a"), () => {});
        await vi.advanceTimersByTimeAsync(150);
        const got: PeekOutcome[] = [];
        loader.request(session("b"), (o) => got.push(o));
        await vi.advanceTimersByTimeAsync(150);
        loader.request(session("c"), (o) => got.push(o));
        loader.dispose();
        pending.resolve(result(5));
        await vi.runAllTimersAsync();
        expect(got).toEqual([]);
        expect(fetch).toHaveBeenCalledTimes(2);
        // a fresh loader for the next opening starts with nothing cached
        const next = createPeekLoader({ fetch: vi.fn(async () => result(1)) });
        const again: PeekOutcome[] = [];
        next.request(session("a"), (o) => again.push(o));
        expect(again).toEqual([]);
    });

    it("cancel drops the pending read but keeps the cache", async () => {
        const fetch = vi.fn(async () => result(2));
        const loader = createPeekLoader({ fetch });
        loader.request(session("a"), () => {});
        await vi.advanceTimersByTimeAsync(150);
        const got: PeekOutcome[] = [];
        loader.request(session("b"), (o) => got.push(o));
        loader.cancel();
        await vi.advanceTimersByTimeAsync(500);
        expect(got).toEqual([]);
        expect(fetch).toHaveBeenCalledTimes(1);
        loader.request(session("a"), (o) => got.push(o));
        expect(got).toEqual([{ ok: true, result: result(2) }]);
    });

    it("takes injected timers", () => {
        const timers: (() => void)[] = [];
        const fetch = vi.fn(async () => result(1));
        const loader = createPeekLoader({
            fetch,
            debounceMs: 10,
            setTimeout: (fn) => timers.push(fn),
            clearTimeout: () => {},
        });
        loader.request(session("a"), () => {});
        expect(fetch).not.toHaveBeenCalled();
        timers[0]();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe("peekView", () => {
    it("loading shows nothing for the first 150 ms, then Reading…", () => {
        expect(peekView({ status: "loading", since: 1_000 }, 1_000)).toMatchObject({
            state: "loading",
            showReading: false,
        });
        expect(peekView({ status: "loading", since: 1_000 }, 1_000 + PEEK_READING_DELAY_MS - 1).showReading).toBe(
            false
        );
        expect(peekView({ status: "loading", since: 1_000 }, 1_000 + PEEK_READING_DELAY_MS)).toMatchObject({
            state: "loading",
            showReading: true,
            messages: [],
        });
    });
    it("ready shows the messages, oldest first, with no note", () => {
        const r = result(5);
        expect(peekView({ status: "done", result: r }, 0)).toEqual({
            state: "ready",
            showReading: false,
            messages: r.messages,
            top: null,
            line: null,
            error: null,
        });
        expect(peekView({ status: "done", result: result(2) }, 0)).toMatchObject({ state: "ready", top: null });
    });
    it("empty says the session has no messages yet", () => {
        expect(peekView({ status: "done", result: result(0) }, 0)).toMatchObject({
            state: "empty",
            line: PEEK_EMPTY,
            messages: [],
        });
        expect(PEEK_EMPTY).toBe("This session has no messages yet.");
    });
    it("capped with none found reads on, never says the session is empty", () => {
        const r = result(0, true, 4096);
        expect(peekView({ status: "done", result: r }, 0, peekOlderStart(r))).toMatchObject({
            state: "capped",
            top: PEEK_READING_OLDER,
            line: null,
            messages: [],
        });
    });
    it("older pages go above the first read's messages, with the line for the page on its way, its error or the start", () => {
        const first = result(2, false, 900);
        let o = peekOlderStart(first);
        expect(peekView({ status: "done", result: first }, 0, o).top).toBeNull();
        o = peekOlderBegin(o);
        expect(peekView({ status: "done", result: first }, 0, o).top).toBe(PEEK_READING_OLDER);
        o = peekOlderLoaded(o, result(2, false, 400, "old"));
        let v = peekView({ status: "done", result: first }, 0, o);
        expect(v.messages.map((m) => m.text)).toEqual(["old0", "old1", "m0", "m1"]);
        expect(v.top).toBeNull();
        o = peekOlderFailed(peekOlderBegin(o), "gone");
        expect(peekView({ status: "done", result: first }, 0, o).top).toBe("Can't read older messages: gone");
        o = peekOlderLoaded(peekOlderBegin(o), result(1, false, 0, "start"));
        v = peekView({ status: "done", result: first }, 0, o);
        expect(v.messages.map((m) => m.text)).toEqual(["start0", "old0", "old1", "m0", "m1"]);
        expect(v.top).toBe(PEEK_START);
        // a session read whole in its first read says nothing about its start
        expect(peekView({ status: "done", result: result(3) }, 0, peekOlderStart(result(3))).top).toBeNull();
    });
    it("an error shows the real error text", () => {
        expect(peekView({ status: "error", error: "permission denied" }, 0)).toMatchObject({
            state: "error",
            error: "permission denied",
            messages: [],
        });
    });
});

describe("older pages", () => {
    it("a cursor only while there is text before the page", () => {
        expect(peekCursor({ before: 0, answered: true })).toBeNull();
        expect(peekCursor({ before: 12, answered: true })).toEqual({ before: 12, answered: true });
    });
    it("reads the next page near the top, or when the messages do not fill the pane", () => {
        const o = peekOlderStart(result(5, false, 1000));
        const tall = { client: 300, height: 900 };
        expect(peekOlderWanted(o, { top: 600, ...tall })).toBe(false);
        expect(peekOlderWanted(o, { top: PEEK_OLDER_EDGE_PX, ...tall })).toBe(true);
        expect(peekOlderWanted(o, { top: 0, client: 300, height: 300 })).toBe(true);
        // not while one is on its way, after one failed, or once the start is reached
        expect(peekOlderWanted(peekOlderBegin(o), { top: 0, ...tall })).toBe(false);
        expect(peekOlderWanted(peekOlderFailed(o, "x"), { top: 0, ...tall })).toBe(false);
        expect(peekOlderWanted(peekOlderStart(result(5)), { top: 0, ...tall })).toBe(false);
        expect(peekOlderWanted(peekOlderStart(null), { top: 0, ...tall })).toBe(false);
    });
    it("a loaded page hands on its own cursor", () => {
        const o = peekOlderLoaded(peekOlderBegin(peekOlderStart(result(5, false, 1000))), {
            ...result(10, false, 300),
            answered: true,
        });
        expect(o).toMatchObject({ cursor: { before: 300, answered: true }, loading: false, error: null });
        expect(o.messages).toHaveLength(10);
    });
});

describe("peekMeta", () => {
    it("joins age, model, branch and tokens", () => {
        const now = 1_000 + 3 * 3_600_000;
        expect(peekMeta(session("a"), now)).toBe("3h ago · opus 5.5 · main · 412k tokens");
    });
    it("a fresh session says just now, never ago ago", () => {
        const meta = peekMeta(session("a"), 1_000 + 10_000);
        expect(meta.startsWith("just now · ")).toBe(true);
        expect(meta).not.toContain("ago ago");
    });
    it("leaves empty parts out", () => {
        expect(peekMeta(session("a", { model: "", branch: "", tokenstotal: 0 }), 1_000)).toBe("just now");
    });
});
