// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { placeUnderSessions } from "./historyplace";
import type { LiveSession } from "./sessionsarchivestore";

const sess = (over: Partial<LiveSession>) =>
    ({
        id: "s",
        runtime: "claude",
        projectpath: "D:\\p",
        task: "A session",
        lastactivets: 0,
        transcriptpath: "",
        live: false,
        events: [],
        ...over,
    }) as LiveSession;

describe("placeUnderSessions", () => {
    const s1 = sess({ id: "s1", transcriptpath: "/t/s1.jsonl" });
    const s2 = sess({ id: "s2", runtime: "codex", transcriptpath: "/t/s2.jsonl" });

    it("places an item under the session whose id it names, keyed by the session's key", () => {
        const { owned, loose } = placeUnderSessions([s1, s2], [{ item: "a", sessionId: "s2" }]);
        expect([...owned.keys()]).toEqual(["codex:s2"]);
        expect(owned.get("codex:s2")).toEqual({ owner: s2, items: ["a"] });
        expect(loose).toEqual([]);
    });

    it("places an item under the session whose transcript it names, across slash and case spellings", () => {
        const win = sess({ id: "w", transcriptpath: "C:\\Users\\Me\\s1.jsonl" });
        const posix = sess({ id: "p", transcriptpath: "/Users/me/S2.jsonl" });
        const { owned, loose } = placeUnderSessions(
            [win, posix],
            [
                { item: "a", transcript: "c:/users/me/s1.jsonl" },
                { item: "b", transcript: "/users/me/s2.jsonl" },
                { item: "c", transcript: "C:\\Users\\Me\\s1.jsonl" },
            ]
        );
        expect(owned.get("claude:w")).toEqual({ owner: win, items: ["a", "c"] });
        expect(owned.get("claude:p")).toEqual({ owner: posix, items: ["b"] });
        expect(loose).toEqual([]);
    });

    it("keeps the items of one owner in the order given", () => {
        const { owned } = placeUnderSessions(
            [s1],
            [
                { item: "late", sessionId: "s1" },
                { item: "early", transcript: "/t/s1.jsonl" },
                { item: "last", sessionId: "s1" },
            ]
        );
        expect(owned.get("claude:s1")?.items).toEqual(["late", "early", "last"]);
    });

    it("leaves an item whose session is not listed loose, named", () => {
        const { owned, loose } = placeUnderSessions(
            [s1],
            [
                { item: "by id", sessionId: "gone" },
                { item: "by transcript", transcript: "/t/gone.jsonl" },
            ]
        );
        expect(owned.size).toBe(0);
        expect(loose).toEqual([
            { item: "by id", named: true },
            { item: "by transcript", named: true },
        ]);
    });

    it("leaves an item that names no session loose, not named", () => {
        const { owned, loose } = placeUnderSessions(
            [s1],
            [{ item: "none" }, { item: "blank", sessionId: "", transcript: "" }]
        );
        expect(owned.size).toBe(0);
        expect(loose).toEqual([
            { item: "none", named: false },
            { item: "blank", named: false },
        ]);
    });

    it("does not match an empty transcript path to a session that has none", () => {
        const bare = sess({ id: "bare", transcriptpath: "" });
        const { owned, loose } = placeUnderSessions([bare], [{ item: "a", transcript: "" }]);
        expect(owned.size).toBe(0);
        expect(loose).toEqual([{ item: "a", named: false }]);
    });

    it("falls back to the transcript when the id names no listed session", () => {
        const { owned, loose } = placeUnderSessions(
            [s1],
            [{ item: "a", sessionId: "gone", transcript: "/t/s1.jsonl" }]
        );
        expect(owned.get("claude:s1")?.items).toEqual(["a"]);
        expect(loose).toEqual([]);
    });
});
