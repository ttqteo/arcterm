// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import { parseSentStore } from "./chatbrainstorm";
import {
    commitDoneLine,
    commitHead,
    commitLine,
    commitMode,
    commitRecord,
    parseCommitBlock,
    splitCardBlocks,
    type CommitSuggestion,
} from "./chatcommit";
import { withLiveReply } from "./chatlive";
import { agentWentOn, chatItems, type ChatItem } from "./chatmodel";
import { VERDICT_TOPIC } from "./chatverdict";

const MESSAGE =
    "[SIEM-1746][ingest] Drop lagging partitions before rebalance\n\nRebalance waited on partitions that had already fallen behind.";
const FILES = ["services/ingest/rebalance.go", "services/ingest/rebalance_test.go"];
const BODY = `${MESSAGE}\n---\n${FILES.join("\n")}`;
const BLOCK = "```arc-commit\n" + BODY + "\n```";
const SUGGESTION: CommitSuggestion = { message: MESSAGE, files: FILES };

const you = (text: string): AgentEntry => ({ kind: "user", text });
const says = (text: string): AgentEntry => ({ kind: "message", text });

function agentParts(items: ChatItem[], at = 1) {
    const item = items[at];
    if (item?.kind !== "agent") {
        throw new Error(`item ${at} is ${item?.kind}, not an agent group`);
    }
    return item.parts;
}

describe("parseCommitBlock", () => {
    it("reads the message, the separator and one path per line", () => {
        expect(parseCommitBlock(BODY)).toEqual(SUGGESTION);
    });

    it("strips a leading `- `, trims paths and drops blank and repeated ones", () => {
        expect(parseCommitBlock("msg\n---\n- a.go\n\n  b.go  \n- a.go\n")).toEqual({
            message: "msg",
            files: ["a.go", "b.go"],
        });
    });

    it("drops the blank lines around the message and keeps the inner ones", () => {
        expect(parseCommitBlock("\n\nsubject\n\nbody\n\n---\na")).toEqual({ message: "subject\n\nbody", files: ["a"] });
    });

    it("takes the last --- as the separator, so a message may hold one", () => {
        expect(parseCommitBlock("subject\n---\nmore body\n---\na.go")).toEqual({
            message: "subject\n---\nmore body",
            files: ["a.go"],
        });
    });

    it("reads CRLF line ends", () => {
        expect(parseCommitBlock("msg\r\n---\r\na.go\r\n")).toEqual({ message: "msg", files: ["a.go"] });
    });

    it("refuses a block with no separator, an empty message or no files", () => {
        expect(parseCommitBlock("msg\na.go")).toBeNull();
        expect(parseCommitBlock("\n  \n---\na.go")).toBeNull();
        expect(parseCommitBlock("msg\n---\n\n- \n")).toBeNull();
    });
});

describe("splitCardBlocks", () => {
    it("cuts a commit block out of the prose around it", () => {
        expect(splitCardBlocks(`Ready to commit.\n\n${BLOCK}\n\nCommit?`)).toEqual([
            { kind: "prose", text: "Ready to commit." },
            { kind: "commit", commit: SUGGESTION },
            { kind: "prose", text: "Commit?" },
        ]);
    });

    it("cuts a review block and a commit block in one pass", () => {
        const review = '```arc-review\n{"kind":"code","pass":true}\n```';
        expect(splitCardBlocks(`${review}\n\n${BLOCK}`).map((p) => p.kind)).toEqual(["verdict", "commit"]);
    });

    it("leaves a broken commit block in the prose, where it draws as code", () => {
        const broken = "Look:\n\n```arc-commit\njust a message\n```";
        expect(splitCardBlocks(broken)).toEqual([{ kind: "prose", text: broken }]);
    });
});

describe("commitLine", () => {
    it("names the instruction, the message in a fence, then the files", () => {
        expect(commitLine("subject\n\nbody", ["a.go", "b.go"])).toBe(
            [
                "Commit exactly these files with exactly this message, unchanged:",
                "",
                "```",
                "subject\n\nbody",
                "```",
                "",
                "- a.go",
                "- b.go",
            ].join("\n")
        );
    });

    it("fences a message holding backticks with a longer fence", () => {
        const line = commitLine("use ```code``` here", ["a"]);
        expect(line).toContain("\n````\nuse ```code``` here\n````\n");
    });
});

describe("commitMode", () => {
    const base = { last: true, live: true, working: false, nextIsYou: false, record: null, c: SUGGESTION };

    it("waits on you while it is the last part of a live, idle agent", () => {
        expect(commitMode(base)).toEqual({ mode: "waiting" });
    });

    it("shows working while the agent works, and static once it exited", () => {
        expect(commitMode({ ...base, working: true })).toEqual({ mode: "working" });
        expect(commitMode({ ...base, live: false })).toEqual({ mode: "static" });
    });

    it("folds once sent, with the files that went, whatever else holds", () => {
        expect(commitMode({ ...base, last: false, nextIsYou: true, record: { files: 1 } })).toEqual({
            mode: "folded",
            outcome: { kind: "sent", files: 1 },
        });
    });

    it("folds when it is no longer the last part: you replied, or the agent went on", () => {
        expect(commitMode({ ...base, last: false, nextIsYou: true })).toEqual({
            mode: "folded",
            outcome: { kind: "replied" },
        });
        expect(commitMode({ ...base, last: false })).toEqual({ mode: "folded", outcome: { kind: "moved-on" } });
    });
});

describe("the card's words", () => {
    it("counts the files in the head and the ✓ row", () => {
        expect(commitHead(1)).toBe("Commit suggestion · 1 file");
        expect(commitDoneLine(SUGGESTION, { kind: "sent", files: 1 })).toBe("Commit suggestion · 1 file — Commit sent");
        expect(commitDoneLine(SUGGESTION, { kind: "replied" })).toBe("Commit suggestion · 2 files — You replied");
        expect(commitDoneLine(SUGGESTION, { kind: "moved-on" })).toBe("Commit suggestion · 2 files");
        expect(commitDoneLine(SUGGESTION, null)).toBe("Commit suggestion · 2 files");
    });
});

describe("commitRecord", () => {
    it("is a verdict record under the verdict topic that survives the store's read", () => {
        const r = commitRecord("commit:4", 1, "line", 0, 1000);
        expect(r).toMatchObject({
            topic: VERDICT_TOPIC,
            kind: "verdict",
            verdictKey: "commit:4",
            verdictOutcome: "commit",
            files: 1,
        });
        expect(parseSentStore(JSON.stringify({ a: [r] }))).toEqual({ a: [r] });
    });
});

describe("chatItems with an arc-commit block", () => {
    it("cuts the reply into prose, commit, prose, keyed by its message", () => {
        const parts = agentParts(chatItems([you("ship it"), says(`Ready.\n\n${BLOCK}\n\nCommit?`)]));
        expect(parts.map((p) => p.kind)).toEqual(["prose", "commit", "prose"]);
        expect(parts[1]).toEqual({ kind: "commit", key: "commit:1", commit: SUGGESTION });
    });

    it("keeps each kind's key its own beside a verdict in the same reply", () => {
        const review = '```arc-review\n{"kind":"code","pass":false,"findings":[{"summary":"x"}]}\n```';
        const parts = agentParts(chatItems([you("x"), says(`${review}\n\n${BLOCK}`)]));
        expect(parts.map((p) => ("key" in p ? p.key : p.kind))).toEqual(["verdict:1", "commit:1"]);
    });

    it("waits while only the reply's own closing words follow, and folds once the agent went on", () => {
        const entries = [you("x"), says(`${BLOCK}\n\nCommit?`)];
        expect(agentWentOn(entries, agentParts(chatItems(entries)), 0)).toBe(false);
        const later = [...entries, says("Committed on my own.")];
        expect(agentWentOn(later, agentParts(chatItems(later)), 0)).toBe(true);
    });

    it("holds the live reply once the transcript cut it around the card", () => {
        const text = `Ready.\n\n${BLOCK}\n\nCommit?`;
        const entries = [you("x"), says(text)];
        const items = chatItems(entries);
        expect(withLiveReply(items, [text], entries.length)).toBe(items);
    });
});
