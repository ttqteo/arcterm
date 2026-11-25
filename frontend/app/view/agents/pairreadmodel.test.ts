// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pairHistoryMatches, pairReadHeader, pairStateWords, pairTranscripts } from "./pairreadmodel";

const side = (tab: string, name: string, session?: string, harness = "claude"): PairSide => ({
    tab,
    name,
    harness,
    ...(session != null ? { session } : {}),
});

// 25 November, local time, as the header shows it
const at = (hour: number, minute: number) => new Date(2026, 10, 25, hour, minute).getTime();

const info = (over: Partial<PairInfo> = {}): PairInfo => ({
    id: "p1",
    project: "D:\\work\\mit\\mit-thesis",
    worker: side("worker-tab-0001", "Plan oracle", "w-session"),
    judges: [side("4c6ba858-0000-4000-8000-000000000000", "judge", "j-session")],
    state: "ended",
    stopreason: "",
    owed: false,
    messagecount: 4,
    lastts: 0,
    updatedts: at(14, 32),
    ...over,
});

const view = (over: Partial<PairView> = {}): PairView => ({
    ...info(),
    holdheavy: true,
    tokencap: 3_000_000,
    tokens: 1_234_000,
    note: "",
    createdts: 0,
    messages: [],
    decided: { asks: [], agreed: [], open: [] },
    ...over,
});

describe("pairStateWords", () => {
    it("says why a stopped pair stopped", () => {
        const words = (stopreason: string) => pairStateWords({ state: "stopped", stopreason });
        expect(words("settled")).toBe("both sides settled");
        expect(words("token-cap")).toBe("token cap reached");
        expect(words("no-new-points")).toBe("no new points");
        expect(words("judges-gone")).toBe("judges gone");
    });

    it("says an ended pair ended and a relaying one still relays", () => {
        expect(pairStateWords({ state: "ended", stopreason: "" })).toBe("ended");
        expect(pairStateWords({ state: "relaying", stopreason: "" })).toBe("still relaying");
    });

    it("keeps the reason of a pair that stopped and was ended after", () => {
        expect(pairStateWords({ state: "ended", stopreason: "token-cap" })).toBe("token cap reached");
    });

    it("says stopped for a stopped pair whose reason it does not know", () => {
        expect(pairStateWords({ state: "stopped", stopreason: "" })).toBe("stopped");
        expect(pairStateWords({ state: "stopped", stopreason: "something-new" })).toBe("stopped");
    });

    it("adds the sync to a synced pair's words, whatever they are", () => {
        expect(pairStateWords({ state: "stopped", stopreason: "settled", synced: true })).toBe(
            "both sides settled · as of the last sync"
        );
        expect(pairStateWords({ state: "relaying", stopreason: "", synced: true })).toBe(
            "still relaying · as of the last sync"
        );
        expect(pairStateWords({ state: "ended", stopreason: "", synced: false })).toBe("ended");
    });
});

describe("pairReadHeader", () => {
    it("names the worker and its judge, and dates an ended pair", () => {
        expect(pairReadHeader(view())).toEqual({
            title: "Plan oracle with judge 4c6ba858",
            line: "Ended 25/11 14:32 · ended · 1.2M tokens",
        });
    });

    it("dates a stopped pair with why it stopped, and says it is as of the last sync", () => {
        const stopped = view({ state: "stopped", stopreason: "settled", synced: true, tokens: 38_400 });
        expect(pairReadHeader(stopped).line).toBe(
            "Stopped 25/11 14:32 · both sides settled · as of the last sync · 38k tokens"
        );
    });

    it("says a relaying pair has been relaying since its last save", () => {
        const relaying = view({ state: "relaying", updatedts: at(9, 5), tokens: 0 });
        expect(pairReadHeader(relaying).line).toBe("Relaying since 25/11 09:05 · still relaying · 0 tokens");
    });

    it("counts the judges when there are several", () => {
        const two = view({
            judges: [side("aaaaaaaa-1", "one", "s1"), side("bbbbbbbb-2", "two", "s2")],
        });
        expect(pairReadHeader(two).title).toBe("Plan oracle with 2 judges");
    });
});

describe("pairTranscripts", () => {
    it("links the worker and each judge by <harness>:<session>", () => {
        const two = view({
            judges: [side("aaaaaaaa-1", "one", "s1"), side("bbbbbbbb-2", "two", "s2", "pi")],
        });
        expect(pairTranscripts(two)).toEqual([
            { label: "Plan oracle", sel: "claude:w-session" },
            { label: "Judge aaaaaaaa", sel: "claude:s1" },
            { label: "Judge bbbbbbbb", sel: "pi:s2" },
        ]);
    });

    it("leaves out a side that has no session id", () => {
        const partial = view({
            worker: side("worker-tab-0001", "Plan oracle"),
            judges: [side("aaaaaaaa-1", "one"), side("bbbbbbbb-2", "two", "s2")],
        });
        expect(pairTranscripts(partial)).toEqual([{ label: "Judge bbbbbbbb", sel: "claude:s2" }]);
        expect(pairTranscripts(view({ worker: side("w", "w"), judges: [side("j", "j")] }))).toEqual([]);
    });
});

describe("pairHistoryMatches", () => {
    const pair = info();

    it("finds a pair by its worker's name, a judge's short id or its project, without case", () => {
        expect(pairHistoryMatches(pair, "plan ORACLE")).toBe(true);
        expect(pairHistoryMatches(pair, "4c6ba8")).toBe(true);
        expect(pairHistoryMatches(pair, "mit-thesis")).toBe(true);
    });

    it("matches the whole query, trimmed, and an empty one matches every pair", () => {
        expect(pairHistoryMatches(pair, "  plan  ")).toBe(true);
        expect(pairHistoryMatches(pair, "plan nothing")).toBe(false);
        expect(pairHistoryMatches(pair, "")).toBe(true);
        expect(pairHistoryMatches(pair, "   ")).toBe(true);
    });

    it("reads a judge's short id and no more of its tab", () => {
        expect(pairHistoryMatches(pair, "0000-4000")).toBe(false);
    });

    it("leaves out a pair that holds none of it", () => {
        expect(pairHistoryMatches(pair, "council")).toBe(false);
        expect(pairHistoryMatches(info({ judges: [] }), "4c6ba858")).toBe(false);
    });
});
