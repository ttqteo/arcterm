// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    archivedSession,
    closedEntry,
    nextToReopen,
    pushClosed,
    RECENTLY_CLOSED_MAX,
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
});
