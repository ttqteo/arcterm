// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    LOST_BASH_KEEP_MS,
    LOST_BASH_MAX,
    LOST_BASH_NOTE,
    keepLostBash,
    lostBashOf,
    lostBashToDraw,
    pruneLostBash,
    withLostBash,
    type LostBash,
} from "./chatlostbash";
import { chatItems } from "./chatmodel";

const S = "C:/Users/x/.claude/projects/p/abc.jsonl";

// the transcript as it stood when `! task install` went: you asked, the agent answered
const before: AgentEntry[] = [
    { kind: "user", text: "build it", uuid: "u1" },
    { kind: "action", verb: "Bash", target: "task tauri:build" },
    { kind: "message", text: "Built. Type `! task install`.", uuid: "m1" },
];
// after the restart: Claude Code never wrote the command, and your next message came
const after: AgentEntry[] = [...before, { kind: "user", text: "it ran, check it", uuid: "u2" }];

describe("lostBashOf", () => {
    it("keeps a `! cmd` with the last record before it and how often the transcript held it", () => {
        expect(lostBashOf(S, "! task install", before, 1000)).toEqual({
            session: S,
            text: "! task install",
            sentAt: 1000,
            seen: 0,
            after: "m1",
        });
    });

    it("keeps nothing for a message, a /command, a bare ! or a session with no transcript", () => {
        expect(lostBashOf(S, "task install", before, 1)).toBeNull();
        expect(lostBashOf(S, "/usage", before, 1)).toBeNull();
        expect(lostBashOf(S, "!", before, 1)).toBeNull();
        expect(lostBashOf("", "! ls", before, 1)).toBeNull();
    });

    it("keeps nothing when the transcript has no record to place it after", () => {
        expect(lostBashOf(S, "! ls", [], 1)).toBeNull();
    });
});

describe("withLostBash", () => {
    const rec = lostBashOf(S, "! task install", before, 1000)!;

    it("draws the command after the reply it was sent after, before your next message, with the note", () => {
        const out = withLostBash(chatItems(after), [rec]);
        expect(out.map((i) => i.kind)).toEqual(["you", "agent", "you", "you"]);
        expect(out[2]).toEqual({
            kind: "you",
            key: "you:lost:1000",
            command: "! task install",
            lost: LOST_BASH_NOTE,
        });
        expect(out[3]).toMatchObject({ kind: "you", text: "it ran, check it" });
    });

    it("draws several in the order they were sent", () => {
        const second: LostBash = { ...rec, text: "! task install", sentAt: 2000 };
        const out = withLostBash(chatItems(after), [second, rec]);
        expect(out.slice(2, 4).map((i) => i.key)).toEqual(["you:lost:1000", "you:lost:2000"]);
    });

    it("leaves out one whose record is not drawn, and answers the items as they were with nothing to add", () => {
        const items = chatItems(after);
        expect(withLostBash(items, [{ ...rec, after: "gone" }])).toBe(items);
        expect(withLostBash(items, [])).toBe(items);
    });

    it("places one sent after a message of yours right after that message", () => {
        const items = chatItems([{ kind: "user", text: "hi", uuid: "u9" }]);
        const out = withLostBash(items, [{ ...rec, after: "u9" }]);
        expect(out.map((i) => i.key)).toEqual([items[0].key, "you:lost:1000"]);
    });
});

describe("lostBashToDraw", () => {
    const rec = lostBashOf(S, "! task install", before, 1000)!;

    it("draws one sent before the page loaded that the transcript still lacks", () => {
        expect(lostBashToDraw([rec], S, after, 5000)).toEqual([rec]);
    });

    it("draws none sent since the page loaded (its pending bubble shows), of another session, or that landed", () => {
        expect(lostBashToDraw([rec], S, after, 500)).toEqual([]);
        expect(lostBashToDraw([rec], "other.jsonl", after, 5000)).toEqual([]);
        const ran: AgentEntry[] = [...before, { kind: "command", name: "!", args: "task install" }];
        expect(lostBashToDraw([rec], S, ran, 5000)).toEqual([]);
    });

    it("still draws a second run of the same command when only the first one landed", () => {
        const ran: AgentEntry[] = [...before, { kind: "command", name: "!", args: "task install" }];
        const again = lostBashOf(S, "! task install", ran, 3000)!;
        expect(again.seen).toBe(1);
        expect(lostBashToDraw([again], S, ran, 5000)).toEqual([again]);
    });
});

describe("pruneLostBash", () => {
    const rec = lostBashOf(S, "! task install", before, 1000)!;
    const ran: AgentEntry[] = [...before, { kind: "command", name: "!", args: "task install" }];

    it("drops a record once its command landed in the transcript", () => {
        expect(pruneLostBash([rec], S, ran, 2000)).toEqual([]);
    });

    it("keeps one still missing, one of another session, and answers the list itself when nothing goes", () => {
        const kept = [rec, { ...rec, session: "other.jsonl" }];
        expect(pruneLostBash(kept, S, after, 2000)).toBe(kept);
    });

    it("keeps a landed-looking one when its record is not in the transcript shown (an earlier stretch)", () => {
        const kept = [{ ...rec, after: "not-loaded" }];
        expect(pruneLostBash(kept, S, ran, 2000)).toBe(kept);
    });

    it("drops any record past the keep time", () => {
        expect(pruneLostBash([{ ...rec, session: "other.jsonl" }], S, after, 1000 + LOST_BASH_KEEP_MS)).toEqual([]);
    });
});

describe("keepLostBash", () => {
    it("adds newest last and drops the oldest past the cap", () => {
        const rec = lostBashOf(S, "! ls", before, 0)!;
        let kept: LostBash[] = [];
        for (let i = 0; i < LOST_BASH_MAX + 2; i++) {
            kept = keepLostBash(kept, { ...rec, sentAt: i });
        }
        expect(kept).toHaveLength(LOST_BASH_MAX);
        expect(kept[0].sentAt).toBe(2);
        expect(kept.at(-1)!.sentAt).toBe(LOST_BASH_MAX + 1);
    });
});
