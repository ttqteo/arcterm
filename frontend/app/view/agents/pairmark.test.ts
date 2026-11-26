// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ChatItem } from "./chatmodel";
import { agentPairIds, markWords, pairMarks, replyBody, type PairMarkLine } from "./pairmark";

const fence = (lang: string, ...lines: string[]) => "```" + lang + "\n" + lines.join("\n") + "\n```";
const pairBlock = (...lines: string[]) => fence("arc-pair", ...lines);
const judgeBlock = (...lines: string[]) => fence("arc-judge", ...lines);

describe("replyBody", () => {
    // the cases of pkg/agentpair/blocks_test.go TestBodyTakesOutTheFencesAndTheQuoteLine, text half
    const cases: [string, string, string][] = [
        ["nothing to take", "Just prose.\nTwo lines.", "Just prose.\nTwo lines."],
        ["the worker's block", "Done.\n\n" + pairBlock("D1 x"), "Done."],
        ["the judge's marks", "Finding.\n\n" + judgeBlock("no new points"), "Finding."],
        ["a quote line", "> Is 50% fine?\n\nYes, it is.", "Yes, it is."],
        ["a quote line without a space", ">Is 50% fine?\nYes.", "Yes."],
        [
            "a quote line after a blank line and before a block",
            "\n\n> the line\nAnswer\n" + pairBlock("D1 x"),
            "Answer",
        ],
        ["only the first quote line", "> first\n> second\nBody", "> second\nBody"],
        ["a quote that is not leading stays", "Body\n> a quote inside", "Body\n> a quote inside"],
        ["a block first and then a quote", pairBlock("D1 x") + "\n> the line\nBody", "Body"],
        ["both fences", "> q\nText\n" + judgeBlock("new: a") + "\n" + pairBlock("D1 x"), "Text"],
        [
            "only the last fence of a name",
            pairBlock("D1 an example") + "\nprose\n" + pairBlock("D1 real"),
            pairBlock("D1 an example") + "\nprose",
        ],
        [
            "a nested fence stays",
            "````md\n" + pairBlock("D1 x") + "\n````\nafter",
            "````md\n" + pairBlock("D1 x") + "\n````\nafter",
        ],
        ["an open fence is dropped to the end", "Text\n```arc-pair\nD1 half", "Text"],
        ["another fence stays", "```go\nx := 1\n```\nText", "```go\nx := 1\n```\nText"],
        ["an indented first line keeps its indent", "    code\nmore", "    code\nmore"],
        ["windows line ends", "> q\r\nText\r\n" + pairBlock("D1 x"), "Text"],
        ["a tilde fence", "Text\n~~~arc-judge\nno new points\n~~~", "Text"],
        ["nothing left", pairBlock("D1 x"), ""],
    ];
    it.each(cases)("%s", (_name, raw, text) => {
        expect(replyBody(raw)).toBe(text);
    });

    it("leaves a reply with neither a fence nor a quote line as it is, bar the blank lines around it", () => {
        expect(replyBody("\n\nPlain reply.\n\n")).toBe("Plain reply.");
        expect(replyBody("Plain reply.")).toBe("Plain reply.");
    });
});

// ---- fixtures ----

const at = (hour: number, minute: number, second = 0) => new Date(2026, 10, 26, hour, minute, second).getTime();

const agentItem = (key: string, ...texts: string[]): ChatItem => ({
    kind: "agent",
    key,
    parts: texts.map((text) => ({ kind: "prose" as const, text })),
});
const youItem = (key: string, text: string): ChatItem => ({ kind: "you", key, text });
const sentItem = (key: string): ChatItem => ({
    kind: "sent",
    key,
    from: "cockpit",
    header: "message · from arcterm pair",
    lines: [],
});

const msg = (id: string, from: string, text: string, ts: number): PairMessage => ({
    id,
    from,
    tab: "",
    ts,
    text,
    quote: "",
    replyto: "",
    to: "",
    held: [],
});

const WORKER = "61483cd6-5c1e-4b2a-9d3f-1a2b3c4d5e6f";

function view(id: string, extra: Partial<PairView> = {}): PairView {
    return {
        id,
        project: "arcterm",
        worker: { tab: WORKER, name: "fix-relay-hold", harness: "claude" },
        judges: [{ tab: "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6", name: "Judge", harness: "claude" }],
        state: "relaying",
        stopreason: "",
        owed: false,
        messagecount: 0,
        lastts: 0,
        updatedts: 0,
        holdheavy: true,
        tokencap: 3_000_000,
        tokens: 0,
        note: "",
        createdts: 0,
        messages: [],
        decided: { asks: [], agreed: [], open: [] },
        ...extra,
    };
}

// the conversation the tests share: an old reply, a message, the reply a round starts from, a relayed prompt, a newer reply
const A = "Plan for the hold.";
const B = "Resume now counts the cap from the press.";
const C = "Split holdHeavy out of the relay.";
const D = "Tests pass.";
const items: ChatItem[] = [
    agentItem("agent:1", A),
    youItem("you:2", "ok, now Resume"),
    agentItem("agent:3", B),
    sentItem("sent:4"),
    agentItem("agent:5", C),
    agentItem("agent:6", D),
];

describe("pairMarks", () => {
    it("marks a live pair on the reply it started from, with its bar down to the last item", () => {
        const live = view("p1", {
            createdts: at(13, 41),
            messages: [msg("m1", "worker", B, at(13, 40)), msg("m2", "judge", "reopen O2", at(13, 44))],
        });
        const marks = pairMarks(items, [live]);
        expect([...marks.lines.keys()]).toEqual(["agent:3"]);
        expect(marks.lines.get("agent:3")).toEqual([
            { pairId: "p1", state: "live", startTs: at(13, 41), endTs: 0, agreed: 0, open: 0 },
        ]);
        expect([...marks.bars.keys()]).toEqual(["agent:3", "sent:4", "agent:5", "agent:6"]);
        for (const bar of marks.bars.values()) {
            expect(bar).toEqual({ pairId: "p1", ended: false });
        }
    });

    it("reads a pair as reading until a judge message follows the first one", () => {
        const first = msg("m1", "worker", B, at(13, 40));
        const reading = view("p1", { createdts: at(13, 41), messages: [first] });
        expect(pairMarks(items, [reading]).lines.get("agent:3")?.[0].state).toBe("reading");
        // a person's message is not a judge's answer
        const said = view("p1", { createdts: at(13, 41), messages: [first, msg("m2", "person", "go on", at(13, 42))] });
        expect(pairMarks(items, [said]).lines.get("agent:3")?.[0].state).toBe("reading");
        const answered = view("p1", { createdts: at(13, 41), messages: [first, msg("m2", "judge", "ok", at(13, 43))] });
        expect(pairMarks(items, [answered]).lines.get("agent:3")?.[0].state).toBe("live");
    });

    it("stops an ended pair's bar at the item of its last worker message", () => {
        const ended = view("p1", {
            state: "ended",
            createdts: at(13, 41),
            lastts: at(13, 52),
            messages: [
                msg("m1", "worker", B, at(13, 40)),
                msg("m2", "judge", "reopen O2", at(13, 44)),
                msg("m3", "worker", C, at(13, 50)),
                msg("m4", "judge", "no new points", at(13, 52)),
            ],
        });
        const marks = pairMarks(items, [ended]);
        expect(marks.lines.get("agent:3")?.[0].state).toBe("ended");
        // the judge's last message is not the worker's: the bar ends at C, not at the judge's answer or at the bottom
        expect([...marks.bars.keys()]).toEqual(["agent:3", "sent:4", "agent:5"]);
        for (const bar of marks.bars.values()) {
            expect(bar).toEqual({ pairId: "p1", ended: true });
        }
    });

    it("covers only the first reply of an ended pair whose last worker message is not in the items", () => {
        const ended = view("p1", {
            state: "ended",
            createdts: at(13, 41),
            messages: [msg("m1", "worker", B, at(13, 40)), msg("m3", "worker", "a reply not loaded", at(13, 50))],
        });
        const marks = pairMarks(items, [ended]);
        expect([...marks.bars.keys()]).toEqual(["agent:3"]);
        expect(marks.lines.get("agent:3")?.[0].state).toBe("ended");
    });

    it("covers only the first reply of an ended pair that has one worker message", () => {
        const ended = view("p1", { state: "ended", messages: [msg("m1", "worker", B, at(13, 40))] });
        expect([...pairMarks(items, [ended]).bars.keys()]).toEqual(["agent:3"]);
    });

    it("gives a reply that started two rounds both lines, the older round first", () => {
        const first = view("p1", {
            state: "ended",
            createdts: at(13, 41),
            messages: [msg("m1", "worker", B, at(13, 40))],
        });
        const second = view("p2", {
            createdts: at(14, 5),
            messages: [msg("m1", "worker", B, at(13, 40)), msg("m2", "judge", "ok", at(14, 8))],
        });
        // whichever way they are listed
        for (const pairs of [
            [first, second],
            [second, first],
        ]) {
            const lines = pairMarks(items, pairs).lines.get("agent:3");
            expect(lines?.map((l) => [l.pairId, l.state])).toEqual([
                ["p1", "ended"],
                ["p2", "live"],
            ]);
        }
    });

    it("draws an item's bar for the newer of two rounds that cover it", () => {
        const older = view("p1", {
            state: "ended",
            createdts: at(13, 0),
            messages: [msg("m1", "worker", A, at(12, 59)), msg("m2", "worker", C, at(13, 30))],
        });
        const newer = view("p2", {
            createdts: at(13, 41),
            messages: [msg("m1", "worker", B, at(13, 40)), msg("m2", "judge", "ok", at(13, 44))],
        });
        for (const pairs of [
            [older, newer],
            [newer, older],
        ]) {
            const bars = pairMarks(items, pairs).bars;
            expect([...bars.entries()].map(([key, bar]) => [key, bar.pairId, bar.ended])).toEqual([
                ["agent:1", "p1", true],
                ["you:2", "p1", true],
                ["agent:3", "p2", false],
                ["sent:4", "p2", false],
                ["agent:5", "p2", false],
                ["agent:6", "p2", false],
            ]);
        }
    });

    it("marks nothing for a pair whose first worker message is not in the items", () => {
        const gone = view("p1", {
            createdts: at(13, 41),
            messages: [msg("m1", "worker", "an older session's reply", 1)],
        });
        const marks = pairMarks(items, [gone]);
        expect(marks.lines.size).toBe(0);
        expect(marks.bars.size).toBe(0);
    });

    it("marks nothing for a pair with no worker message, or one whose text is empty", () => {
        const none = view("p1", { messages: [msg("m1", "judge", B, at(13, 40))] });
        const empty = view("p2", { messages: [msg("m1", "worker", "", at(13, 40))] });
        const noMessages = view("p3", { messages: [] });
        const marks = pairMarks([agentItem("agent:1", "")], [none, empty, noMessages]);
        expect(marks.lines.size).toBe(0);
        expect(marks.bars.size).toBe(0);
        expect(pairMarks(items, []).lines.size).toBe(0);
    });

    it("takes the line's times and counts from the view", () => {
        const view1 = view("p1", {
            state: "ended",
            // the round started well after the reply it judges
            createdts: at(13, 40),
            lastts: at(13, 52),
            messages: [msg("m1", "worker", B, at(9, 5)), msg("m2", "judge", "ok", at(13, 52))],
            decided: {
                asks: [],
                agreed: [pairItem(1), pairItem(2), pairItem(3)],
                open: [pairItem(4)],
            },
        });
        const line = pairMarks(items, [view1]).lines.get("agent:3")?.[0];
        expect(line).toEqual({
            pairId: "p1",
            state: "ended",
            startTs: at(13, 40),
            endTs: at(13, 52),
            agreed: 3,
            open: 1,
        });
        // not the first worker message's own time
        expect(line?.startTs).not.toBe(at(9, 5));
    });

    it("matches the reply as the pair shows it: the fences and the quote line taken out", () => {
        const raw =
            "> the question\nResume now counts the cap.\n\n" + pairBlock("D1 x") + "\n" + judgeBlock("no new points");
        const fenced: ChatItem[] = [agentItem("agent:1", "Intro."), agentItem("agent:2", raw)];
        const v = view("p1", { messages: [msg("m1", "worker", "Resume now counts the cap.", at(13, 40))] });
        expect([...pairMarks(fenced, [v]).lines.keys()]).toEqual(["agent:2"]);
    });

    it("matches a prose part among the parts of an item, and only a prose part of an agent item", () => {
        const parts: ChatItem[] = [
            // the same words typed by the person, and a work part, are not a reply
            youItem("you:1", B),
            {
                kind: "agent",
                key: "agent:2",
                parts: [
                    { kind: "prose", text: "Reading the code first." },
                    { kind: "prose", text: B },
                ],
            },
        ];
        const v = view("p1", { messages: [msg("m1", "worker", B, at(13, 40))] });
        expect([...pairMarks(parts, [v]).lines.keys()]).toEqual(["agent:2"]);
    });

    it("takes the later reply when two say the same words", () => {
        const twice: ChatItem[] = [
            agentItem("agent:1", "Done."),
            youItem("you:2", "more"),
            agentItem("agent:3", "Done."),
        ];
        const v = view("p1", { messages: [msg("m1", "worker", "Done.", at(13, 40))] });
        expect([...pairMarks(twice, [v]).lines.keys()]).toEqual(["agent:3"]);
    });
});

describe("agentPairIds", () => {
    const info = (id: string, tab: string): PairInfo => {
        const { messages: _m, decided: _d, ...rest } = view(id, { worker: { tab, name: "w", harness: "claude" } });
        return rest as PairInfo;
    };

    it("lists the agent's own pairs among the active ones and the history, each once", () => {
        const live = [info("p1", WORKER), info("p2", "another-worker")];
        const history = [info("p1", WORKER), info("p0", WORKER), info("p9", "another-worker")];
        expect(agentPairIds(WORKER, live, history)).toEqual(["p1", "p0"]);
    });

    it("lists the active ones before the history is read", () => {
        expect(agentPairIds(WORKER, [info("p1", WORKER)], null)).toEqual(["p1"]);
        expect(agentPairIds(WORKER, [], undefined)).toEqual([]);
    });

    it("leaves out a pair the agent only judges", () => {
        const judging: PairInfo = {
            ...info("p3", "another-worker"),
            judges: [{ tab: WORKER, name: "j", harness: "claude" }],
        };
        expect(agentPairIds(WORKER, [judging], [judging])).toEqual([]);
    });
});

function pairItem(num: number): PairItem {
    return {
        num,
        kind: "agreed",
        text: `item ${num}`,
        note: "",
        chips: [],
        msgid: "",
        reopenedby: "",
        newby: "",
        answer: "",
    };
}

describe("markWords", () => {
    const line = (extra: Partial<PairMarkLine>): PairMarkLine => ({
        pairId: "p1",
        state: "live",
        startTs: at(13, 40),
        endTs: at(13, 52),
        agreed: 3,
        open: 0,
        ...extra,
    });

    it("says the judge is reading, with the seconds since the round started", () => {
        const reading = line({ state: "reading" });
        expect(markWords(reading, false, at(13, 40, 38))).toEqual({
            text: "The judge is reading this reply · 38 s",
            action: "Open pair",
        });
        expect(markWords(reading, true, at(13, 40, 38))).toEqual({
            text: "Judge đang chấm reply này · 38 s",
            action: "Open pair",
        });
        expect(markWords(reading, false, at(13, 40, 0)).text).toBe("The judge is reading this reply · 0 s");
        expect(markWords(reading, false, at(13, 41, 5)).text).toBe("The judge is reading this reply · 65 s");
    });

    it("counts the seconds from the round's start, never below 0", () => {
        // a clock a little behind the server's
        expect(markWords(line({ state: "reading" }), false, at(13, 39, 58)).text).toBe(
            "The judge is reading this reply · 0 s"
        );
    });

    it("says where a live round starts", () => {
        expect(markWords(line({ state: "live" }), false, at(14, 0))).toEqual({
            text: "⚖ The judge round starts here",
            action: "Open pair",
        });
        expect(markWords(line({ state: "live" }), true, at(14, 0))).toEqual({
            text: "⚖ Vòng judge bắt đầu ở đây",
            action: "Open pair",
        });
    });

    it("sums an ended round up with its times and counts, and has no action of its own", () => {
        const ended = line({ state: "ended" });
        expect(markWords(ended, false, at(15, 0))).toEqual({
            text: "⚖ Judge round 13:40–13:52 · 3 agreed, 0 open",
            action: "",
        });
        expect(markWords(ended, true, at(15, 0))).toEqual({
            text: "⚖ Vòng judge 13:40–13:52 · 3 chốt, 0 còn mở",
            action: "",
        });
        expect(
            markWords(line({ state: "ended", startTs: at(9, 5), endTs: at(23, 9), agreed: 0, open: 2 }), false, 0).text
        ).toBe("⚖ Judge round 09:05–23:09 · 0 agreed, 2 open");
    });
});
