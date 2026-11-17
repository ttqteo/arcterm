// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { IDLE_GRACE_MS, type AgentEntry } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import { endsInQuestion, lastQuestion, sidecarNeeds, type NeedsInput } from "./sidecarneeds";
import type { SidecarTile, SidecarTileState } from "./sidecartypes";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const say = (text: string): AgentEntry => ({ kind: "message", text });
const you = (text: string): AgentEntry => ({ kind: "user", text });
const act = (verb: string, target: string): AgentEntry => ({ kind: "action", verb, target, outcome: "ok" });

function tile(id: string, state: SidecarTileState, over: Partial<SidecarTile> = {}): SidecarTile {
    return { id, name: `agent-${id}`, runtime: "Claude · opus", state, messages: [], ...over };
}

function item(over: Partial<AttentionItem>): AttentionItem {
    return {
        kind: "dag-gate",
        key: "k",
        source: "ship it",
        text: "approve t-1",
        action: "Review",
        phaseidx: 0,
        waitingsince: NOW - 10 * MIN,
        ...over,
    } as AttentionItem;
}

function input(over: Partial<NeedsInput> = {}): NeedsInput {
    return { tiles: [], entriesById: {}, jarvis: [], now: NOW, ...over };
}

describe("endsInQuestion", () => {
    it("returns the last sentence when the text ends in a question mark", () => {
        expect(endsInQuestion("Done. Bạn chọn (a) hay (b)?")).toBe("Bạn chọn (a) hay (b)?");
    });

    it("counts a full-width question mark", () => {
        expect(endsInQuestion("終わりました。どちらにしますか？")).toBe("どちらにしますか？");
    });

    it("ignores trailing markdown and quotes", () => {
        expect(endsInQuestion("All green. Should I merge it?**")).toBe("Should I merge it?");
        expect(endsInQuestion("All green. Is that ok?`")).toBe("Is that ok?");
        expect(endsInQuestion("All green. (Is that ok?')")).toBe("(Is that ok?");
        expect(endsInQuestion('All green. Is that ok?"')).toBe("Is that ok?");
    });

    it("is null when the text does not end in a question", () => {
        expect(endsInQuestion("Done.")).toBeNull();
        expect(endsInQuestion("Why? Because.")).toBeNull();
    });

    it("is null for a question mark inside a trailing code fence", () => {
        expect(endsInQuestion("```\nx?\n```")).toBeNull();
        expect(endsInQuestion("Look at this.\n```\nwhy?\n```")).toBeNull();
    });

    it("is null for empty text", () => {
        expect(endsInQuestion("")).toBeNull();
    });

    it("cuts the sentence at the last full stop, bang, question mark, ideographic stop or newline", () => {
        expect(endsInQuestion("First part! Second part?")).toBe("Second part?");
        expect(endsInQuestion("Is it? Really?")).toBe("Really?");
        expect(endsInQuestion("Line one\nline two ok?")).toBe("line two ok?");
        expect(endsInQuestion("OK。Tiếp tục không?")).toBe("Tiếp tục không?");
    });

    it("keeps the whole text when it has no earlier boundary", () => {
        expect(endsInQuestion("  Want me to continue?  ")).toBe("Want me to continue?");
    });
});

describe("lastQuestion", () => {
    it("reads the last message's question", () => {
        expect(lastQuestion([say("Working on it."), say("Merge now?")])).toBe("Merge now?");
    });

    it("is null when the person wrote after the message", () => {
        expect(lastQuestion([say("Merge now?"), you("yes")])).toBeNull();
    });

    it("is null with no message", () => {
        expect(lastQuestion([])).toBeNull();
        expect(lastQuestion([act("Read", "a.ts")])).toBeNull();
    });

    it("is not cancelled by an action after the message", () => {
        expect(lastQuestion([say("Merge now?"), act("Bash", "git status")])).toBe("Merge now?");
    });

    it("looks only at the last message", () => {
        expect(lastQuestion([say("Merge now?"), say("Merged.")])).toBeNull();
    });
});

describe("sidecarNeeds", () => {
    it("makes an ask row from an asking tile", () => {
        const t = tile("a1", "asking", {
            since: NOW - 3 * MIN,
            sent: true,
            ask: { question: "Which one?", options: ["A", "B"], answerable: true, key: "ask-1" },
        });
        expect(sidecarNeeds(input({ tiles: [t] }))).toEqual([
            {
                key: "ask:a1",
                kind: "ask",
                id: "a1",
                who: "agent-a1",
                since: NOW - 3 * MIN,
                text: "Which one?",
                options: ["A", "B"],
                answerable: true,
                askKey: "ask-1",
                sent: true,
            },
        ]);
    });

    it("leaves askKey and sent off an ask that has neither", () => {
        const t = tile("a1", "asking", { since: NOW - MIN, ask: { question: "Q?", options: [], answerable: false } });
        const [n] = sidecarNeeds(input({ tiles: [t] }));
        expect(n).not.toHaveProperty("askKey");
        expect(n).not.toHaveProperty("sent");
    });

    it("makes a question row from a review tile whose last message asks", () => {
        const t = tile("r1", "review", { since: NOW - 4 * MIN });
        const needs = sidecarNeeds(input({ tiles: [t], entriesById: { r1: [say("Done. Merge it?")] } }));
        expect(needs).toEqual([
            { key: "q:r1", kind: "question", id: "r1", who: "agent-r1", since: NOW - 4 * MIN, text: "Merge it?" },
        ]);
    });

    it("gives a review tile with no question no row", () => {
        const t = tile("r1", "review", { since: NOW - MIN });
        expect(sidecarNeeds(input({ tiles: [t], entriesById: { r1: [say("Done.")] } }))).toEqual([]);
        expect(sidecarNeeds(input({ tiles: [t] }))).toEqual([]);
    });

    it("gives an idle tile a question row only within the grace", () => {
        const entries = { i1: [say("Merge it?")] };
        const within = tile("i1", "idle", { since: NOW - IDLE_GRACE_MS });
        const past = tile("i1", "idle", { since: NOW - IDLE_GRACE_MS - 1 });
        expect(sidecarNeeds(input({ tiles: [within], entriesById: entries })).map((n) => n.key)).toEqual(["q:i1"]);
        expect(sidecarNeeds(input({ tiles: [past], entriesById: entries }))).toEqual([]);
        // 6 minutes old: well past the 5-minute grace
        const sixMin = tile("i1", "idle", { since: NOW - 6 * MIN });
        expect(sidecarNeeds(input({ tiles: [sixMin], entriesById: entries }))).toEqual([]);
    });

    it("counts an idle tile with no since as within the grace", () => {
        const t = tile("i1", "idle");
        const needs = sidecarNeeds(input({ tiles: [t], entriesById: { i1: [say("Merge it?")] } }));
        expect(needs).toEqual([
            { key: "q:i1", kind: "question", id: "i1", who: "agent-i1", since: NOW, text: "Merge it?" },
        ]);
    });

    it("never gives an asking tile a second, question row", () => {
        const t = tile("a1", "asking", {
            since: NOW - MIN,
            ask: { question: "Which?", options: ["A"], answerable: true, key: "k1" },
        });
        const needs = sidecarNeeds(input({ tiles: [t], entriesById: { a1: [say("Merge it?")] } }));
        expect(needs.map((n) => n.key)).toEqual(["ask:a1"]);
    });

    it("never gives an asleep or working tile a row", () => {
        const entries = { s1: [say("Merge it?")], w1: [say("Merge it?")] };
        const tiles = [tile("s1", "asleep", { since: NOW - MIN }), tile("w1", "working", { since: NOW - MIN })];
        expect(sidecarNeeds(input({ tiles, entriesById: entries }))).toEqual([]);
    });

    it("makes a jarvis row from an attention item", () => {
        const n = sidecarNeeds(
            input({
                jarvis: [
                    item({
                        key: "g1",
                        kind: "dag-gate",
                        channelname: "Ship it",
                        source: "fallback",
                        text: "Approve t-2",
                    }),
                ],
            })
        );
        expect(n).toEqual([
            { key: "g1", kind: "jarvis", who: "Ship it", since: NOW - 10 * MIN, text: "Approve t-2", word: "gate" },
        ]);
    });

    it("names a jarvis row by its source when it has no channel name", () => {
        const [n] = sidecarNeeds(input({ jarvis: [item({ key: "g1", channelname: "", source: "Release run" })] }));
        expect(n.who).toBe("Release run");
    });

    it("marks failed exactly for run-unverified and a retryable dag-blocked", () => {
        const needs = sidecarNeeds(
            input({
                jarvis: [
                    item({ key: "u", kind: "run-unverified", waitingsince: NOW - 9 * MIN }),
                    item({ key: "br", kind: "dag-blocked", retry: true, waitingsince: NOW - 8 * MIN }),
                    item({ key: "b", kind: "dag-blocked", waitingsince: NOW - 7 * MIN }),
                    item({ key: "g", kind: "dag-gate", waitingsince: NOW - 6 * MIN }),
                    item({ key: "h", kind: "run-land-held", waitingsince: NOW - 5 * MIN }),
                    item({ key: "d", kind: "chunk-due", waitingsince: NOW - 4 * MIN }),
                ],
            })
        );
        const by = Object.fromEntries(needs.map((n) => [n.key, n]));
        expect(by.u.failed).toBe(true);
        expect(by.br.failed).toBe(true);
        expect(by.b.failed).toBeUndefined();
        expect(by.g.failed).toBeUndefined();
        expect(by.h.failed).toBeUndefined();
        expect(by.d.failed).toBeUndefined();
        expect(by.u.word).toBe("unverified");
        expect(by.br.word).toBe("failed");
        expect(by.b.word).toBe("blocked");
        expect(by.d.word).toBe("due");
    });

    it("skips items of kind ask", () => {
        const needs = sidecarNeeds(
            input({ jarvis: [item({ key: "x", kind: "ask" }), item({ key: "y", kind: "dag-gate" })] })
        );
        expect(needs.map((n) => n.key)).toEqual(["y"]);
    });

    it("sorts the whole list oldest first", () => {
        const tiles = [
            tile("a1", "asking", { since: NOW - 2 * MIN, ask: { question: "Q?", options: [], answerable: false } }),
            tile("r1", "review", { since: NOW - 30 * MIN }),
        ];
        const needs = sidecarNeeds(
            input({
                tiles,
                entriesById: { r1: [say("Merge it?")] },
                jarvis: [item({ key: "g1", waitingsince: NOW - 10 * MIN })],
            })
        );
        expect(needs.map((n) => n.key)).toEqual(["q:r1", "g1", "ask:a1"]);
    });

    it("keeps source order (asks, questions, jarvis) when ages tie", () => {
        const at = NOW - 5 * MIN;
        const tiles = [
            tile("r1", "review", { since: at }),
            tile("a1", "asking", { since: at, ask: { question: "Q?", options: [], answerable: false } }),
        ];
        const needs = sidecarNeeds(
            input({
                tiles,
                entriesById: { r1: [say("Merge it?")] },
                jarvis: [item({ key: "g1", waitingsince: at })],
            })
        );
        expect(needs.map((n) => n.key)).toEqual(["ask:a1", "q:r1", "g1"]);
    });

    it("gives a tile with no since the current time, so it sorts after those that waited longer", () => {
        const tiles = [
            tile("a1", "asking", { ask: { question: "Q?", options: [], answerable: false } }),
            tile("a2", "asking", { since: NOW - MIN, ask: { question: "Q?", options: [], answerable: false } }),
        ];
        const needs = sidecarNeeds(input({ tiles }));
        expect(needs.map((n) => [n.key, n.since])).toEqual([
            ["ask:a2", NOW - MIN],
            ["ask:a1", NOW],
        ]);
    });
});
