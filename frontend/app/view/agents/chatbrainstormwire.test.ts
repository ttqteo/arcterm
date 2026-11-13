// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import type { ChatCard, PairedAnswer, QuestionCard } from "./chatbrainstorm";
import {
    answerMessages,
    answeredText,
    boxAnswerRecord,
    boxPlaceholderOverride,
    pairedHidden,
} from "./chatbrainstormwire";
import type { ChatItem } from "./chatmodel";

function card(over: Partial<QuestionCard> = {}): QuestionCard {
    return {
        kind: "question",
        state: "waiting",
        n: 2,
        part: "Motion",
        question: "How should it move?",
        why: null,
        options: [
            { label: "Fade", detail: "" },
            { label: "Spring", detail: "" },
            { label: "Both", detail: "" },
        ],
        pick: null,
        pickLabel: "Agent's pick",
        read: null,
        multi: false,
        openText: false,
        weighing: null,
        boards: 0,
        reasons: false,
        decided: [],
        ...over,
    };
}

// every card kind but the question: the box answers none of them
const OTHER_CARDS: ChatCard[] = [
    { kind: "confirm", state: "waiting", line: "", action: "check", guesses: 0, rows: [], yours: [] },
    {
        kind: "check",
        state: "waiting",
        stage: "asking",
        pending: null,
        reason: null,
        question: {
            n: 1,
            total: 1,
            part: "Motion",
            question: "Which?",
            why: null,
            options: [{ label: "Fade", detail: "" }],
            pick: null,
        },
        calls: [],
        spec: [],
        rows: [],
        approveBlocker: null,
    },
    { kind: "run", state: "waiting", runId: "run-1" },
];

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
            typed: true,
        });
    });

    it("marks what the box sent as typed: its ✓ row says You replied, not You picked", () => {
        expect(boxAnswerRecord(card(), "t", "keep it as 2.2?", [], now)?.typed).toBe(true);
    });

    it("records while the judge weighs, an answer in words", () => {
        expect(
            boxAnswerRecord(card({ state: "weighing", options: [] }), "t", "go with the second", [], now)
        ).toMatchObject({
            n: 2,
            text: "go with the second",
            seen: 0,
            typed: true,
        });
    });

    it("records nothing when no question waits: none attached, a card of another kind, or an agent that exited", () => {
        expect(boxAnswerRecord(null, "t", "Fade", [], now)).toBeNull();
        for (const other of OTHER_CARDS) {
            expect(boxAnswerRecord(other, "t", "Fade", [], now)).toBeNull();
        }
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

    it("is null with no card, a card of another kind (the box keeps its own words), or an agent that exited", () => {
        expect(boxPlaceholderOverride(null)).toBeNull();
        for (const other of OTHER_CARDS) {
            expect(boxPlaceholderOverride(other)).toBeNull();
        }
        expect(boxPlaceholderOverride(card({ state: "static" }))).toBeNull();
    });
});

describe("pairedHidden", () => {
    const paired = (over: Partial<PairedAnswer>): PairedAnswer => ({
        n: 0,
        part: "",
        text: "x",
        kind: "action",
        ...over,
    });
    const none = new Set<string>();

    it("hides an action line whatever the runs are doing", () => {
        expect(pairedHidden(paired({ kind: "action", text: "brainstorm: confirm" }), none)).toBe(true);
        expect(pairedHidden(paired({ kind: "action" }), new Set(["run-1"]))).toBe(true);
    });

    it("hides the line that started a run while the run is live, and draws it once the run is over", () => {
        const started = paired({ kind: "run", runId: "run-1", text: "brainstorm: run run-1" });
        expect(pairedHidden(started, none)).toBe(true);
        expect(pairedHidden(started, new Set(["run-2"]))).toBe(true);
        expect(pairedHidden(started, new Set(["run-1"]))).toBe(false);
    });

    it("hides a run line that names no run: there is nothing to draw", () => {
        expect(pairedHidden(paired({ kind: "run" }), new Set(["run-1"]))).toBe(true);
    });

    it("hides the line a verdict card sent: the card folds into its own ✓ row, where it was", () => {
        const sent = paired({
            kind: "verdict",
            verdictKey: "verdict:3",
            verdictOutcome: "fix",
            fixed: 2,
            text: "Fix these review findings:",
        });
        expect(pairedHidden(sent, none)).toBe(true);
        expect(pairedHidden(sent, new Set(["run-1"]))).toBe(true);
    });

    it("draws an answer, a builder answer and the design and builder steps", () => {
        for (const kind of ["answer", "builder-answer", "design", "builder"] as const) {
            expect(pairedHidden(paired({ kind, n: 1 }), none)).toBe(false);
        }
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
