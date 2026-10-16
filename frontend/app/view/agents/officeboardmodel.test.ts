// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AttentionRunRow } from "@/app/view/jarvis/attentionrun";
import type { StripRow } from "./needsyoustripmodel";
import { boardCall, boardItems, boardPage, boardTabs, boardWords } from "./officeboardmodel";

const row = (over: Partial<StripRow> = {}): StripRow => ({
    key: "k1",
    kindLabel: "Plan to review",
    tone: "asking",
    source: "Jarvis as graph",
    text: "4 proposed",
    why: "An agent proposed these chunks.",
    waitingSince: 0,
    act: { label: "Open", kind: "open" },
    secondAct: null,
    run: {} as AttentionRunRow,
    open: { kind: "effort", effortId: "e1" },
    learnId: null,
    ...over,
});

describe("boardItems", () => {
    it("is the row's act alone when the act is Open", () => {
        expect(boardItems(row({}), false).map((i) => [i.id, i.label])).toEqual([["board:act", "Open"]]);
    });
    it("is the act, the second act, then Open, as the strip's buttons", () => {
        const r = row({
            act: { label: "Start now", kind: "start-queued" },
            secondAct: { label: "Remove", kind: "remove-queued" },
            open: { kind: "channel", channelId: "c", runId: "r" },
        });
        expect(boardItems(r, false).map((i) => i.label)).toEqual(["Start now", "Remove", "Open"]);
    });
    it("leaves Open out when the row opens nothing", () => {
        const r = row({ act: { label: "Approve", kind: "approve-dag" }, open: null });
        expect(boardItems(r, false).map((i) => i.label)).toEqual(["Approve"]);
    });
    it("is empty when the row's only act is Open and it opens nothing", () => {
        expect(boardItems(row({ open: null }), false)).toEqual([]);
    });
    it("is Accept, Dismiss and a ruled-off Why for a learned rule, with no Edit", () => {
        const r = row({ kindLabel: "Learned rule", learnId: "l1", why: "“never stage files”" });
        const items = boardItems(r, false);
        expect(items.map((i) => i.id)).toEqual(["board:accept", "board:dismiss", "board:why"]);
        expect(items[2]).toMatchObject({ label: "Why", rule: true });
        expect(boardItems(r, true)[2].checked).toBe(true);
    });
    it("drops Why for a learned rule with no words behind it", () => {
        const r = row({ kindLabel: "Learned rule", learnId: "l1", why: "" });
        expect(boardItems(r, false).map((i) => i.id)).toEqual(["board:accept", "board:dismiss"]);
    });
    it("dims every item while the row's call is in flight", () => {
        const r = row({ act: { label: "Approve", kind: "approve-dag" }, open: null });
        expect(boardItems(r, false, true).every((i) => i.dim)).toBe(true);
    });
});

describe("boardPage", () => {
    it("clamps the page to the rows there are", () => {
        expect(boardPage(5, 3)).toBe(2);
        expect(boardPage(-1, 3)).toBe(0);
        expect(boardPage(0, 0)).toBe(-1);
    });
});

describe("boardTabs", () => {
    it("is the page's kind and which of how many, only with two rows or more", () => {
        const rows = [row({}), row({ kindLabel: "Run to land" })];
        expect(boardTabs(rows, 1)).toEqual({ head: "Run to land", at: 1, of: 2 });
        expect(boardTabs([row({})], 0)).toBeUndefined();
    });
});

describe("boardWords", () => {
    it("titles the page with its kind and source and shows the why, except a learned rule's until Why", () => {
        expect(boardWords(row({}), false)).toEqual({
            title: "Plan to review · Jarvis as graph",
            text: "4 proposed",
            why: "An agent proposed these chunks.",
            quote: undefined,
        });
        const learn = row({ kindLabel: "Learned rule", learnId: "l1", why: "“never stage files”" });
        expect(boardWords(learn, false).quote).toBeUndefined();
        expect(boardWords(learn, false).why).toBe("");
        expect(boardWords(learn, true).quote).toBe("“never stage files”");
    });
    it("titles the page with just its kind when the source is empty", () => {
        expect(boardWords(row({ source: "" }), false).title).toBe("Plan to review");
    });
});

describe("boardCall", () => {
    it("maps each ▶ item to the strip handler it runs", () => {
        const r = row({
            act: { label: "Start now", kind: "start-queued" },
            secondAct: { label: "Remove", kind: "remove-queued" },
        });
        expect(boardCall(r, "board:act")).toEqual({ kind: "act", act: r.act });
        expect(boardCall(r, "board:act2")).toEqual({ kind: "act", act: r.secondAct });
        expect(boardCall(r, "board:open")).toEqual({ kind: "open" });
        expect(boardCall(r, "board:accept")).toEqual({ kind: "learn", accept: true });
        expect(boardCall(r, "board:dismiss")).toEqual({ kind: "learn", accept: false });
        expect(boardCall(r, "board:why")).toEqual({ kind: "why" });
    });
    it("is null for a second act the row lacks and for another desk's item", () => {
        expect(boardCall(row({}), "board:act2")).toBeNull();
        expect(boardCall(row({}), "reply")).toBeNull();
    });
});
