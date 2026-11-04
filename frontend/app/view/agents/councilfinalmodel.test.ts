// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { postedAt } from "./councildiscussionmodel";
import { finalProposal, messageMarkdown } from "./councilfinalmodel";

const experts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

const T0 = new Date(2026, 10, 4, 14, 32, 0).getTime();

const prop = (id: string, author: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `title ${id}`,
    argument: `argument ${id}.`,
    ts: T0,
    ...extra,
});

const reply = (id: string, proposalid: string, author: string, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid,
    author,
    text: `text ${id}`,
    round: 2,
    ts: T0 + 60_000,
    ...extra,
});

const council = (extra: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "D:\\code\\arc",
    feature: "Rail apps",
    experts,
    state: "done",
    round: 3,
    proposals: [prop("P1", "ux"), prop("P2", "ram", { withdrawn: true })],
    replies: [
        reply("r1", "", "ram", { text: "An answer in the channel." }),
        reply("r2", "P1", "ux", { text: "A reply in the thread." }),
    ],
    tokens: 0,
    calls: 0,
    created: T0,
    updated: T0,
    started: T0,
    ...extra,
});

describe("messageMarkdown", () => {
    // the cases Go's MessageMarkdown test uses too (pkg/council/markdown_test.go): the two must write one text
    it("gives a reply its text, trimmed", () => {
        const c = council({
            replies: [reply("r3", "P1", "ux", { text: "  | A | B |\n|---|---|\n| 1 | 2 |\n" })],
        });
        expect(messageMarkdown(c, "r3")).toBe("| A | B |\n|---|---|\n| 1 | 2 |");
    });

    it("gives an idea its title as a heading and its argument", () => {
        const c = council({
            proposals: [prop("P1", "ux", { title: "Cache the tree", argument: "Keep it in memory." })],
        });
        expect(messageMarkdown(c, "P1")).toBe("## Cache the tree\n\nKeep it in memory.");
    });

    it("lists an idea's evidence one line per item, a weak one saying so and why", () => {
        const c = council({
            proposals: [
                prop("P2", "ux", {
                    title: "Pin rail apps",
                    argument: "Settings, not localStorage.",
                    evidence: [
                        { ref: "a.ts:12" },
                        { ref: "b.go:40", weak: true, note: "no test" },
                        { ref: "c.go:7", weak: true },
                        { ref: "", weak: true, note: "about 3 s" },
                        { ref: "", weak: true },
                    ],
                }),
            ],
        });
        expect(messageMarkdown(c, "P2")).toBe(
            "## Pin rail apps\n\nSettings, not localStorage.\n\n- a.ts:12\n- b.go:40 (weak: no test)\n- c.go:7 (weak)\n- weak: about 3 s\n- weak"
        );
    });

    it("leaves out a Review idea's runs and check label, and an evidence item's quote, cite, note on the cite and region", () => {
        const c = council({
            proposals: [
                prop("P3", "ux", {
                    title: "Fix the race",
                    argument: "Lock the map.",
                    evidence: [
                        {
                            ref: "x.go:9",
                            quote: "m[k] = v",
                            cite: "ok",
                            citenote: "found it",
                            region: { image: "s.png", crop: "c.png", x: 1, y: 2, w: 3, h: 4 },
                        },
                    ],
                    runs: [{ command: "go test -race", expect: "no race" }],
                    label: "ran",
                }),
            ],
        });
        expect(messageMarkdown(c, "P3")).toBe("## Fix the race\n\nLock the map.\n\n- x.go:9");
    });

    it("trims an idea's argument and has no trailing newline", () => {
        const c = council({ proposals: [prop("P1", "ux", { title: "T", argument: "\n  A.  \n\n" })] });
        expect(messageMarkdown(c, "P1")).toBe("## T\n\nA.");
    });

    // Go's TestMessageMarkdownOfEmptyWords pins the same two
    it("gives an idea with no argument its heading alone, with no stray blank lines", () => {
        const c = council({ proposals: [prop("P1", "ux", { title: "Cache the tree", argument: "  \n" })] });
        expect(messageMarkdown(c, "P1")).toBe("## Cache the tree");
    });

    it("puts an idea's evidence straight under its heading when it has no argument", () => {
        const c = council({
            proposals: [prop("P1", "ux", { title: "Cache the tree", argument: "", evidence: [{ ref: "a.ts:12" }] })],
        });
        expect(messageMarkdown(c, "P1")).toBe("## Cache the tree\n\n- a.ts:12");
    });

    it("gives a reply with no words an empty text, still found", () => {
        const c = council({ replies: [reply("r3", "P1", "ux", { text: "" })] });
        expect(messageMarkdown(c, "r3")).toBe("");
    });

    it("writes an unsent idea or reply too: wavesrv refuses to pin one, the text does not look", () => {
        const c = council({
            proposals: [prop("P1", "ux", { draft: "held" })],
            replies: [reply("r3", "P1", "ux", { draft: "held", text: "Held." })],
        });
        expect(messageMarkdown(c, "P1")).toBe("## title P1\n\nargument P1.");
        expect(messageMarkdown(c, "r3")).toBe("Held.");
    });

    it("is null for an id the council lacks", () => {
        expect(messageMarkdown(council(), "P9")).toBeNull();
        expect(messageMarkdown(council(), "")).toBeNull();
    });
});

describe("finalProposal", () => {
    it("is null with nothing pinned", () => {
        expect(finalProposal(council())).toBeNull();
        expect(finalProposal(council({ finalpick: "" }))).toBeNull();
    });

    it("is null for an id the council lacks", () => {
        expect(finalProposal(council({ finalpick: "P9" }))).toBeNull();
        expect(finalProposal(council({ finalpick: "r9" }))).toBeNull();
    });

    it("gives a pinned channel reply, which sits under no idea", () => {
        const c = council({ finalpick: "r1" });
        expect(finalProposal(c)).toEqual({
            id: "r1",
            kind: "reply",
            seatName: "RAM",
            at: postedAt(c, T0 + 60_000).at,
            markdown: "An answer in the channel.",
            threadOf: null,
        });
        expect(finalProposal(c)?.at).toMatch(/^\d\d:\d\d$/);
    });

    it("gives a pinned thread reply the idea its thread belongs to", () => {
        const c = council({ finalpick: "r2" });
        expect(finalProposal(c)).toEqual({
            id: "r2",
            kind: "reply",
            seatName: "UX",
            at: postedAt(c, T0 + 60_000).at,
            markdown: "A reply in the thread.",
            threadOf: "P1",
        });
    });

    it("gives a pinned idea, which has no thread above it", () => {
        const c = council({ finalpick: "P1" });
        expect(finalProposal(c)).toEqual({
            id: "P1",
            kind: "idea",
            seatName: "UX",
            at: postedAt(c, T0).at,
            markdown: "## title P1\n\nargument P1.",
            threadOf: null,
        });
    });

    it("gives a withdrawn idea too", () => {
        const c = council({ finalpick: "P2" });
        expect(finalProposal(c)).toMatchObject({ id: "P2", kind: "idea", seatName: "RAM", threadOf: null });
    });

    it("names a chat seat by the label the chat uses for it", () => {
        const chat: CouncilExpert = { id: "chat", name: "arc", brief: "", model: "", agent: "0976023f-aaaa" };
        const c = council({
            experts: [...experts, chat],
            replies: [reply("r5", "P1", "chat", { text: "From a live chat." })],
            finalpick: "r5",
        });
        expect(finalProposal(c)?.seatName).toBe("arc · 0976023f");
    });

    it("leaves the time empty for a message with none", () => {
        const c = council({ replies: [reply("r6", "", "ux", { ts: 0 })], finalpick: "r6" });
        expect(finalProposal(c)?.at).toBe("");
    });
});
