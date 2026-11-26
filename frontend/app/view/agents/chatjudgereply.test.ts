// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { judgeReplyParts } from "./chatjudgereply";
import type { AgentPart, ChatItem } from "./chatmodel";

type Prose = Extract<AgentPart, { kind: "prose" }>;

const prose = (text: string, extra: Partial<Prose> = {}): AgentPart => ({ kind: "prose", text, ...extra });
const work = (): AgentPart =>
    ({ kind: "work", work: { calls: [], files: [] } }) as unknown as Extract<AgentPart, { kind: "work" }>;
const turn = (key: string, parts: AgentPart[]): ChatItem => ({ kind: "agent", key, parts });
const you = (key: string, text: string): ChatItem => ({ kind: "you", key, text });

const CLAUDE = { harness: "claude", ownTranscript: true } as const;
const PI = { harness: "pi", ownTranscript: true } as const;

const entries = (m: Map<string, string>) => [...m.entries()];

describe("judgeReplyParts: claude", () => {
    it("gives each finished turn its last prose part, paired with that part's record uuid", () => {
        const items = [
            you("you:0", "plan it"),
            turn("agent:1", [prose("First reply.", { uuid: "u-1" })]),
            you("you:2", "now do it"),
            turn("agent:3", [prose("Second reply.", { uuid: "u-2" })]),
        ];
        expect(entries(judgeReplyParts(items, CLAUDE))).toStrictEqual([
            ["agent:1#0", "u-1"],
            ["agent:3#0", "u-2"],
        ]);
    });

    it("keys a part by its index among the item's parts, work parts counted", () => {
        const items = [turn("agent:1", [prose("A", { uuid: "u-a" }), work(), prose("B", { uuid: "u-b" }), work()])];
        expect(entries(judgeReplyParts(items, CLAUDE))).toStrictEqual([["agent:1#2", "u-b"]]);
    });

    it("leaves the earlier prose of a tool-split turn without one: only the turn's last prose part is its reply", () => {
        const items = [
            turn("agent:1", [prose("Looking at it.", { uuid: "u-1" }), work(), prose("Done.", { uuid: "u-2" })]),
        ];
        const parts = judgeReplyParts(items, CLAUDE);
        expect(parts.has("agent:1#0")).toBe(false);
        expect(parts.get("agent:1#2")).toBe("u-2");
    });

    it("gives a part with no uuid nothing, and does not fall back to an earlier part of the turn", () => {
        const items = [turn("agent:1", [prose("Earlier.", { uuid: "u-1" }), work(), prose("No record id.")])];
        expect(judgeReplyParts(items, CLAUDE).size).toBe(0);
    });

    it("gives a turn with no prose nothing", () => {
        expect(judgeReplyParts([turn("agent:1", [work()])], CLAUDE).size).toBe(0);
    });

    it("gives a live part nothing: a reply still being written is not a reply yet", () => {
        const items = [turn("agent:1", [prose("Still writing", { live: true })])];
        expect(judgeReplyParts(items, CLAUDE).size).toBe(0);
    });

    it("takes the last finished part while a later one is live: the reply so far is the one the transcript holds", () => {
        const items = [turn("agent:1", [prose("Said.", { uuid: "u-1" }), work(), prose("Writing", { live: true })])];
        expect(entries(judgeReplyParts(items, CLAUDE))).toStrictEqual([["agent:1#0", "u-1"]]);
    });

    it("gives nothing when Chat does not show the agent's own transcript (a fork still showing its source)", () => {
        const items = [turn("agent:1", [prose("From the source session.", { uuid: "u-1" })])];
        expect(judgeReplyParts(items, { harness: "claude", ownTranscript: false }).size).toBe(0);
    });

    it("ignores messages, markers and the other items", () => {
        const items: ChatItem[] = [
            you("you:0", "hi"),
            { kind: "marker", key: "marker:1", item: { kind: "interrupted", dropped: 0 } } as unknown as ChatItem,
        ];
        expect(judgeReplyParts(items, CLAUDE).size).toBe(0);
    });
});

describe("judgeReplyParts: pi", () => {
    it("gives only the latest agent item's last prose part, with an empty from: pi's parts have no record id", () => {
        const items = [
            turn("agent:1", [prose("Older reply.")]),
            you("you:2", "again"),
            turn("agent:3", [prose("Newest reply.")]),
        ];
        expect(entries(judgeReplyParts(items, PI))).toStrictEqual([["agent:3#0", ""]]);
    });

    it("counts the latest agent item even when a message of yours follows it", () => {
        const items = [turn("agent:1", [prose("Reply.")]), you("you:2", "and then?")];
        expect(entries(judgeReplyParts(items, PI))).toStrictEqual([["agent:1#0", ""]]);
    });

    it("does not take a pi part's uuid for a from, though one is there", () => {
        const items = [turn("agent:1", [prose("Reply.", { uuid: "u-1" })])];
        expect(entries(judgeReplyParts(items, PI))).toStrictEqual([["agent:1#0", ""]]);
    });

    it("gives a live part nothing", () => {
        const items = [turn("agent:1", [prose("Writing", { live: true })])];
        expect(judgeReplyParts(items, PI).size).toBe(0);
    });

    it("does not reach back to an older turn when the latest holds no finished prose", () => {
        const items = [turn("agent:1", [prose("Older.")]), you("you:2", "go"), turn("agent:3", [work()])];
        expect(judgeReplyParts(items, PI).size).toBe(0);
    });

    it("gives nothing when Chat does not show the agent's own transcript", () => {
        const items = [turn("agent:1", [prose("Reply.")])];
        expect(judgeReplyParts(items, { harness: "pi", ownTranscript: false }).size).toBe(0);
    });
});
