// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ChatItem } from "./chatmodel";
import { chatTurns, countAfterRead, LAST_LINE_PX, turnsRead, unreadRuleLabel, unreadTurns } from "./unreadturns";

const you = (key: string): ChatItem => ({ kind: "you", key, text: "go on" });
const command = (key: string, cmd: string, more: Partial<Extract<ChatItem, { command: string }>> = {}): ChatItem => ({
    kind: "you",
    key,
    command: cmd,
    ...more,
});
const sent = (key: string): ChatItem => ({ kind: "sent", key, from: "cockpit", header: "Task", lines: [] });
const agent = (key: string): ChatItem => ({ kind: "agent", key, parts: [] });
const notification = (key: string): ChatItem =>
    ({ kind: "marker", key, item: { kind: "notification", summary: "done", status: "completed" } }) as ChatItem;
const compaction = (key: string): ChatItem =>
    ({ kind: "marker", key, item: { kind: "compaction", trigger: "auto" } }) as ChatItem;

describe("chatTurns", () => {
    it("runs a turn from your message to the agent's last item before the next message", () => {
        const items = [you("y1"), agent("a1"), compaction("c1"), agent("a2"), you("y2"), agent("a3")];
        expect(chatTurns(items)).toEqual([
            { start: "y1", end: "a2" },
            { start: "y2", end: "a3" },
        ]);
    });

    it("starts a turn at a message arcterm typed and at a finished task that woke the agent", () => {
        const items = [sent("s1"), agent("a1"), notification("n1"), agent("a2")];
        expect(chatTurns(items)).toEqual([
            { start: "s1", end: "a1" },
            { start: "n1", end: "a2" },
        ]);
    });

    it("takes a skill or slash command as a start, but not a `!` command, a /btw or a panel", () => {
        const items = [
            command("k1", "/review PR #4"),
            agent("a1"),
            command("b1", "! git status"),
            command("t1", "/config", { terminal: true }),
            command("w1", "/btw why", { btw: { question: "why", answer: "because" } as never }),
            agent("a2"),
        ];
        expect(chatTurns(items)).toEqual([{ start: "k1", end: "a2" }]);
    });

    it("leaves out a stretch with no reply, and what the window holds before its first start", () => {
        const items = [agent("a0"), you("y1"), command("m1", "/model sonnet"), you("y2"), agent("a1")];
        expect(chatTurns(items)).toEqual([{ start: "y2", end: "a1" }]);
    });
});

describe("unreadTurns", () => {
    const turns = [
        { start: "y1", end: "a1" },
        { start: "y2", end: "a2" },
        { start: "y3", end: "a3" },
    ];

    it("is the last `count` turns, clamped to the turns found", () => {
        expect(unreadTurns(turns, 2).map((t) => t.start)).toEqual(["y2", "y3"]);
        expect(unreadTurns(turns, 7).map((t) => t.start)).toEqual(["y1", "y2", "y3"]);
        expect(unreadTurns(turns, 0)).toEqual([]);
    });
});

describe("turnsRead", () => {
    const unread = [
        { start: "y1", end: "a1" },
        { start: "y2", end: "a2" },
        { start: "y3", end: "a3" },
    ];
    const bottoms: Record<string, number | null> = { a1: 300, a2: 900, a3: null };
    const endBottom = (key: string) => bottoms[key] ?? null;

    it("counts each turn whose last line is in the view or above it", () => {
        expect(turnsRead(unread, endBottom, 500, false)).toBe(1);
        expect(turnsRead(unread, endBottom, 900, false)).toBe(2);
    });

    it("counts a turn once its last line has entered, not only once its whole item is in", () => {
        expect(turnsRead(unread, endBottom, 900 - LAST_LINE_PX, false)).toBe(2);
        expect(turnsRead(unread, endBottom, 900 - LAST_LINE_PX - 1, false)).toBe(1);
    });

    it("does not count a turn whose end is not drawn, and counts all of them at the end", () => {
        expect(turnsRead(unread, endBottom, 10_000, false)).toBe(2);
        expect(turnsRead(unread, endBottom, 0, true)).toBe(3);
    });
});

describe("countAfterRead", () => {
    it("drops the count by the turns read", () => {
        expect(countAfterRead(3, 3, 1)).toBe(2);
        expect(countAfterRead(3, 3, 0)).toBe(3);
    });

    it("is 0 once every turn found is read, the leftover the wakes made going with them", () => {
        expect(countAfterRead(3, 3, 3)).toBe(0);
        expect(countAfterRead(5, 2, 2)).toBe(0);
        expect(countAfterRead(5, 2, 1)).toBe(4);
        expect(countAfterRead(2, 0, 0)).toBe(0);
    });
});

describe("unreadRuleLabel", () => {
    it("follows the conversation's language", () => {
        expect(unreadRuleLabel(3, true)).toBe("3 lượt mới");
        expect(unreadRuleLabel(3, false)).toBe("3 new turns");
        expect(unreadRuleLabel(1, false)).toBe("1 new turn");
    });
});
