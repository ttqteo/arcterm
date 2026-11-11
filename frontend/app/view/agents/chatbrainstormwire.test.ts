// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import type { OpenQuestion, QuestionCard } from "./chatbrainstorm";
import { answerMessages, answeredText, boxAnswerRecord, boxPlaceholderOverride } from "./chatbrainstormwire";
import type { ChatItem } from "./chatmodel";

function card(over: Partial<QuestionCard> = {}): QuestionCard {
    return {
        state: "waiting",
        n: 2,
        part: "Motion",
        question: "How should it move?",
        why: null,
        options: [{ label: "Fade" }, { label: "Spring" }, { label: "Both" }],
        pick: null,
        pickLabel: "Agent's pick",
        read: null,
        multi: false,
        openText: false,
        weighing: null,
        boards: 0,
        reasons: false,
        ...over,
    } as QuestionCard;
}

const user = (text: string): AgentEntry => ({ kind: "user", text });

describe("answerMessages", () => {
    it("takes your plain messages, by the key of the row, in order", () => {
        const items: ChatItem[] = [
            { kind: "you", key: "you:0", text: "start" },
            { kind: "agent", key: "agent:1", parts: [{ kind: "prose", text: "which one?" }] },
            { kind: "you", key: "you:2", text: "Fade" },
        ];
        expect(answerMessages(items)).toEqual([
            { key: "you:0", text: "start" },
            { key: "you:2", text: "Fade" },
        ]);
    });

    it("leaves out commands, sent cards and markers", () => {
        const items: ChatItem[] = [
            { kind: "you", key: "you:0", command: "/clear" },
            { kind: "sent", key: "sent:1", from: "run", header: "run prompt", lines: [] },
            { kind: "marker", key: "marker:2", item: { kind: "interrupted" } as never },
        ];
        expect(answerMessages(items)).toEqual([]);
    });

    it("reads a message the harness wrapped whole as a paste as its body, as userTextCount counts it", () => {
        const wrapped = "<pasted_content>\nFade\nthen scale\n</pasted_content>";
        const items: ChatItem[] = [{ kind: "you", key: "you:3", text: wrapped }];
        expect(answerMessages(items)).toEqual([{ key: "you:3", text: "Fade\nthen scale" }]);
    });
});

describe("boxAnswerRecord", () => {
    const now = 5000;

    it("records a message sent while the question waits: its n and part, the text sent, now, and how many were there", () => {
        const entries = [user("Fade"), { kind: "message", text: "ok?" } as AgentEntry];
        expect(boxAnswerRecord(card(), "chat-redesign", "Fade", entries, now)).toEqual({
            topic: "chat-redesign",
            n: 2,
            part: "Motion",
            text: "Fade",
            sentAt: now,
            seen: 1,
        });
    });

    it("records while the judge weighs, an answer in words", () => {
        expect(
            boxAnswerRecord(card({ state: "weighing", options: [] }), "t", "go with the second", [], now)
        ).toMatchObject({
            n: 2,
            text: "go with the second",
            seen: 0,
        });
    });

    it("records nothing when no question waits: none attached, a pointer, or an agent that exited", () => {
        const pointer: OpenQuestion = {
            state: "pointer",
            phase: "check",
            line: "The builder check runs in the Brainstorm tab.",
        };
        expect(boxAnswerRecord(null, "t", "Fade", [], now)).toBeNull();
        expect(boxAnswerRecord(pointer, "t", "Fade", [], now)).toBeNull();
        expect(boxAnswerRecord(card({ state: "static" }), "t", "Fade", [], now)).toBeNull();
    });

    it("records no slash command and no bash-mode command, nor an empty message", () => {
        expect(boxAnswerRecord(card(), "t", "/usage", [], now)).toBeNull();
        expect(boxAnswerRecord(card(), "t", "  /model opus", [], now)).toBeNull();
        expect(boxAnswerRecord(card(), "t", "! ls", [], now)).toBeNull();
        expect(boxAnswerRecord(card(), "t", "!ls", [], now)).toBeNull();
        expect(boxAnswerRecord(card(), "t", "   ", [], now)).toBeNull();
    });
});

describe("boxPlaceholderOverride", () => {
    it("is the question's placeholder while it waits or weighs", () => {
        expect(boxPlaceholderOverride(card())).toBe("Answer question 2 in your own words, or pick A–C above");
        expect(boxPlaceholderOverride(card({ state: "weighing", options: [] }))).toBe(
            "Answer question 2 in your own words"
        );
    });

    it("is null with no question, a pointer, or an agent that exited", () => {
        expect(boxPlaceholderOverride(null)).toBeNull();
        expect(boxPlaceholderOverride({ state: "pointer", phase: "run", line: "x" })).toBeNull();
        expect(boxPlaceholderOverride(card({ state: "static" }))).toBeNull();
    });
});

describe("answeredText", () => {
    it("is the answer as sent", () => {
        expect(answeredText("Fade + Spring")).toBe("Fade + Spring");
    });

    it("leaves the attachments block out of the ✓ row", () => {
        const sent = "Fade\n\nAttachments (read these files):\n- C:\\a\\b.png";
        expect(answeredText(sent)).toBe("Fade");
    });

    it("falls back to the whole text when it is nothing but attachments", () => {
        const sent = "Attachments (read these files):\n- C:\\a\\b.png";
        expect(answeredText(sent)).not.toBe("");
    });
});
