// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    archivedSession,
    closedEntry,
    nextToReopen,
    pushClosed,
    RECENTLY_CLOSED_MAX,
    sessionById,
    type ClosedAgent,
} from "./recentlyclosed";

const c = (transcriptPath: string, name = transcriptPath): ClosedAgent => ({ transcriptPath, name, closedAt: 1 });

describe("closedEntry", () => {
    it("keeps an agent's conversation", () => {
        expect(closedEntry({ name: "Lumen", kind: "agent", transcriptPath: "/t/a.jsonl" }, 5)).toEqual({
            transcriptPath: "/t/a.jsonl",
            name: "Lumen",
            closedAt: 5,
        });
    });

    it("skips a terminal and an agent with no transcript yet", () => {
        expect(closedEntry({ name: "sh", kind: "terminal", transcriptPath: "/t/a.jsonl" }, 5)).toBeNull();
        expect(closedEntry({ name: "booting", kind: "agent" }, 5)).toBeNull();
    });
});

describe("pushClosed", () => {
    it("puts the newest on top and caps the stack", () => {
        let stack: ClosedAgent[] = [];
        for (let i = 0; i < RECENTLY_CLOSED_MAX + 2; i++) {
            stack = pushClosed(stack, [c(`/t/${i}`)]);
        }
        expect(stack).toHaveLength(RECENTLY_CLOSED_MAX);
        expect(stack[0].transcriptPath).toBe(`/t/${RECENTLY_CLOSED_MAX + 1}`);
    });

    it("moves a conversation already on it to the top, matching paths either way", () => {
        const stack = pushClosed([c("/t/b"), c("C:\\T\\A")], [c("c:/t/a", "again")]);
        expect(stack.map((x) => x.name)).toEqual(["again", "/t/b"]);
    });
});

describe("nextToReopen", () => {
    it("takes the newest", () => {
        expect(nextToReopen([c("/t/a"), c("/t/b")], [])).toEqual({ entry: c("/t/a"), rest: [c("/t/b")] });
    });

    it("drops one a tab holds again on the way", () => {
        expect(nextToReopen([c("/t/a"), c("/t/b")], [{ transcriptPath: "/T/A" }])).toEqual({
            entry: c("/t/b"),
            rest: [],
        });
    });

    it("has nothing when every one is open again", () => {
        expect(nextToReopen([c("/t/a")], [{ transcriptPath: "/t/a" }])).toEqual({ rest: [] });
        expect(nextToReopen([], [])).toEqual({ rest: [] });
    });
});

describe("archivedSession", () => {
    it("finds the scanned session by its transcript, matching paths either way", () => {
        const s = { id: "1", transcriptpath: "C:\\T\\a.jsonl" } as SessionActivity;
        expect(archivedSession([s], "c:/t/A.jsonl")).toBe(s);
        expect(archivedSession([s], "/t/b.jsonl")).toBeUndefined();
        expect(archivedSession(null, "/t/a.jsonl")).toBeUndefined();
    });

    it("finds a session synced from another computer, whose path there differs from this disk's", () => {
        const here = { id: "2", transcriptpath: "C:\\u\\.claude\\projects\\d--thesis\\953f.jsonl" } as SessionActivity;
        const other = { id: "3", transcriptpath: "C:\\u\\.claude\\projects\\d--thesis\\aaaa.jsonl" } as SessionActivity;
        expect(archivedSession([other, here], "/Users/me/.claude/projects/-Users-me-thesis/953f.jsonl")).toBe(here);
    });
});

describe("sessionById", () => {
    const a = { id: "c0781a87-db5e-4b73-8913-4ca9eb9a8f2c", runtime: "claude" } as SessionActivity;
    const b = { id: "c0781b00-0000-0000-0000-000000000000", runtime: "claude" } as SessionActivity;
    const p = { id: "4a6bddd7-0000-0000-0000-000000000000", runtime: "pi" } as SessionActivity;

    it("finds a session by its full id, ignoring case", () => {
        expect(sessionById([a, b, p], "C0781A87-DB5E-4B73-8913-4CA9EB9A8F2C")).toEqual({ session: a });
    });

    it("finds one by a unique prefix, as wsh agents takes a tab", () => {
        expect(sessionById([a, b, p], "4a6b")).toEqual({ session: p });
        expect(sessionById([a, b, p], "c0781a")).toEqual({ session: a });
    });

    it("says when a prefix names more than one, or none", () => {
        expect(sessionById([a, b, p], "c078")).toEqual({ error: 'more than one conversation starts with "c078"' });
        expect(sessionById([a, b, p], "ffff")).toEqual({ error: 'no conversation "ffff" in Conversation History' });
        expect(sessionById(null, "c078")).toEqual({ error: 'no conversation "c078" in Conversation History' });
    });

    it("takes a full id over a longer id it prefixes", () => {
        const short = { id: "abc", runtime: "pi" } as SessionActivity;
        const long = { id: "abcd", runtime: "claude" } as SessionActivity;
        expect(sessionById([long, short], "abc")).toEqual({ session: short });
    });
});
