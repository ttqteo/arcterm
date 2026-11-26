// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ChatItem } from "./chatmodel";
import { stepsPartKey } from "./chatsteplist";
import {
    isAnchorList,
    judgeCounts,
    judgeRowsOf,
    newlyAgreed,
    olderCounts,
    pairBlockKey,
    pairCardOf,
    parseJudgeMarks,
    parsePairItems,
    placePairLists,
    waitingCount,
    waitingLabel,
    type PairBlockItem,
} from "./pairblocks";

const pairBlock = (...lines: string[]) => ["```arc-pair", ...lines, "```"].join("\n");

const agent = (n: number, ...texts: string[]): ChatItem => ({
    kind: "agent",
    key: `agent:${n}`,
    parts: texts.map((text) => ({ kind: "prose", text })),
});

const serverItem = (num: number, kind: string, text: string, over: Partial<PairItem> = {}): PairItem => ({
    num,
    kind,
    text,
    note: "",
    chips: [],
    msgid: "",
    reopenedby: "",
    newby: "",
    answer: "",
    ...over,
});
const decided = (d: Partial<PairDecided> = {}): PairDecided => ({ asks: [], agreed: [], open: [], ...d });
const view = (d: PairDecided, judges = 1): PairView =>
    ({ id: "pair1", decided: d, judges: Array.from({ length: judges }, (_, i) => ({ tab: `judge${i}` })) }) as any;

describe("parsePairItems", () => {
    // the same lines as pkg/agentpair/blocks_test.go TestWorkerBlockEachLineForm
    it("reads each line form as the server does", () => {
        const body = [
            "D1 Lock the threshold before the pilot",
            "O2 Take pilot cases outside the test split — the judge's second point",
            "A3 Is a 50% threshold fine? -- the only decision left [Yes, 50% | No, keep 70%]",
            "D4 Em dash and double dash — first note -- second",
            "- O5 a bullet before the item",
            "d6: lower case and a colon",
            "A7 asks with one chip [Yes]",
            "A8 a bracket that holds no chip [ ]",
            "D9 a trailing bracket on a D item [kept in the text]",
        ].join("\n");
        const it = (num: number, kind: PairBlockItem["kind"], text: string, note = "", chips: string[] = []) => ({
            num,
            kind,
            text,
            note,
            chips,
        });
        expect(parsePairItems(body)).toEqual([
            it(1, "agreed", "Lock the threshold before the pilot"),
            it(2, "open", "Take pilot cases outside the test split", "the judge's second point"),
            it(3, "asks", "Is a 50% threshold fine?", "the only decision left", ["Yes, 50%", "No, keep 70%"]),
            it(4, "agreed", "Em dash and double dash", "first note -- second"),
            it(5, "open", "a bullet before the item"),
            it(6, "agreed", "lower case and a colon"),
            it(7, "asks", "asks with one chip", "", ["Yes"]),
            it(8, "asks", "a bracket that holds no chip [ ]"),
            it(9, "agreed", "a trailing bracket on a D item [kept in the text]"),
        ]);
    });

    it("skips a line that does not parse", () => {
        const body = [
            "D1 first",
            "a line of prose the agent slipped in",
            "D2first with no space",
            "X3 an unknown letter",
            "D0 number zero is not an item",
            "D99999999999999999999999 a number that overflows",
            "D 4 a space inside the label",
            "O5 last",
        ].join("\n");
        expect(parsePairItems(body).map((i) => i.num)).toEqual([1, 5]);
        expect(parsePairItems("just words\r\nmore words")).toEqual([]);
    });
});

describe("parseJudgeMarks", () => {
    it("reads reopen, new and no new points in any case", () => {
        const body = [
            "reopen D2: the pilot split leaks",
            "- REOPEN 4",
            "Reopen d5 :  spaced",
            "new: the oracle needs a second seed",
            "NEW : another",
            "No new points.",
            "reopen D0: zero is no item",
            "a line of prose",
        ].join("\n");
        expect(parseJudgeMarks(body)).toEqual({
            reopen: [
                { num: 2, why: "the pilot split leaks" },
                { num: 4, why: "" },
                { num: 5, why: "spaced" },
            ],
            new: ["the oracle needs a second seed", "another"],
            noNewPoints: true,
            summary: "",
        });
        expect(parseJudgeMarks("")).toEqual({ reopen: [], new: [], noNewPoints: false, summary: "" });
    });

    it("reads the last summary line, in any case, as pkg/agentpair's JudgeMarks does", () => {
        const body = [
            "summary: the first draft",
            "- SUMMARY :   Both agree on D1 and D2; A5 waits on you.   ",
            "no new points",
        ].join("\n");
        expect(parseJudgeMarks(body)).toEqual({
            reopen: [],
            new: [],
            noNewPoints: true,
            summary: "Both agree on D1 and D2; A5 waits on you.",
        });
        expect(parseJudgeMarks("a summary line\r\nsummary: with CRLF\r\n").summary).toBe("with CRLF");
    });

    it("skips a line that is no summary", () => {
        for (const line of ["summary:", "summary of the pair", "the summary: not at the start", "my summary: x"]) {
            expect(parseJudgeMarks(line).summary).toBe("");
        }
    });
});

describe("newlyAgreed", () => {
    const prev = parsePairItems("D1 a\nO2 b\nA3 c");
    it("names the D items the previous list did not agree", () => {
        expect(newlyAgreed(prev, parsePairItems("D1 a\nD2 b\nD4 d\nA3 c"))).toEqual(["D2", "D4"]);
        expect(newlyAgreed(prev, prev)).toEqual([]);
    });
    it("is empty with no previous list", () => {
        expect(newlyAgreed(null, prev)).toEqual([]);
    });
});

describe("placePairLists", () => {
    it("keys every list by its part, the last as the newest, each with the list before it", () => {
        const first = pairBlock("D1 a", "O2 b");
        const second = pairBlock("D1 a", "D2 b");
        const items: ChatItem[] = [
            agent(0, `Reply.\n\n${first}`),
            { kind: "you", key: "you:1", text: "go on" },
            agent(2, "prose with no list", `Next.\n\n${second}`),
        ];
        const out = placePairLists(items);
        const k1 = pairBlockKey(stepsPartKey("agent:0", 0), parsePairItems("D1 a\nO2 b"));
        const k2 = pairBlockKey(stepsPartKey("agent:2", 1), parsePairItems("D1 a\nD2 b"));
        expect([...out.keys()]).toEqual([k1, k2]);
        expect(out.get(k1)).toEqual({ latest: false, previous: null });
        expect(out.get(k2)).toEqual({ latest: true, previous: parsePairItems("D1 a\nO2 b") });
    });

    it("leaves out a fence still open in a reply being written, and one that lists nothing", () => {
        const items: ChatItem[] = [
            agent(0, pairBlock("D1 a")),
            agent(1, pairBlock("just words")),
            { kind: "agent", key: "agent:2", parts: [{ kind: "prose", text: "```arc-pair\nD1 a\nD2 b", live: true }] },
        ];
        const out = placePairLists(items);
        expect([...out.values()]).toEqual([{ latest: true, previous: null }]);
    });
});

describe("pairCardOf", () => {
    const items = parsePairItems(
        ["D1 one", "D2 two — why", "O3 three", "A4 four [Yes | No]", "A5 five [Go]"].join("\n")
    );

    it("is the fence as written with no pair view", () => {
        const card = pairCardOf(items, null);
        expect(card.current).toBe(false);
        expect(card.agreed.map((r) => r.label)).toEqual(["D1", "D2"]);
        expect(card.open.map((r) => r.label)).toEqual(["O3"]);
        expect(card.asks.map((r) => [r.label, r.chips, r.item])).toEqual([
            ["A4", ["Yes", "No"], null],
            ["A5", ["Go"], null],
        ]);
        expect(waitingCount(card)).toBe(2);
    });

    it("overlays the server's view on its anchor list: a reopen, a new point and an answer", () => {
        const d = decided({
            agreed: [serverItem(1, "agreed", "one")],
            open: [
                serverItem(2, "open", "two", { note: "why", reopenedby: "abcdef0123456789" }),
                serverItem(3, "open", "three"),
                serverItem(0, "open", "a judge's point", { newby: "judge0" }),
            ],
            asks: [
                serverItem(4, "asks", "four", { chips: ["Yes", "No"], answer: "Yes" }),
                serverItem(5, "asks", "five", { chips: ["Go"] }),
            ],
        });
        expect(isAnchorList(items, d)).toBe(true);
        const card = pairCardOf(items, view(d));
        expect(card.current).toBe(true);
        expect(card.agreed.map((r) => r.label)).toEqual(["D1"]);
        expect(card.open.map((r) => [r.label, r.note])).toEqual([
            ["D2", "reopened by judge abcdef01"],
            ["O3", ""],
            ["", "judge's new point"],
        ]);
        expect(card.asks.map((r) => [r.label, r.answer, r.item?.num])).toEqual([
            ["A4", "Yes", 4],
            ["A5", "", 5],
        ]);
        expect(waitingCount(card)).toBe(1);
    });

    it("is read-only when the server's anchor is another list", () => {
        const older = decided({ agreed: [serverItem(1, "agreed", "one")], asks: [serverItem(4, "asks", "four")] });
        expect(isAnchorList(items, older)).toBe(false);
        expect(pairCardOf(items, view(older)).current).toBe(false);
        // a list with no A item is told from the anchor by its other items too
        const noAsks = parsePairItems("D1 one\nO2 two");
        expect(isAnchorList(noAsks, decided({ agreed: [serverItem(1, "agreed", "one")] }))).toBe(false);
    });
});

describe("counts", () => {
    it("words the waits and an older list's counts", () => {
        expect(waitingLabel(1)).toBe("1 waits on you");
        expect(waitingLabel(3)).toBe("3 wait on you");
        expect(olderCounts(parsePairItems("D1 a\nO2 b\nA3 c\nA4 d"))).toBe("1 agreed · 1 open · 2 wait on you");
        expect(olderCounts(parsePairItems("D1 a"))).toBe("1 agreed · 0 open");
    });
});

describe("judgeRowsOf", () => {
    const marks = parseJudgeMarks("reopen D4: not checked\nreopen 9: gone\nnew: a point\nnew: another");

    it("names each reopened item as the pair's newest list has it", () => {
        const d = decided({ open: [serverItem(4, "open", "the cell is empty", { reopenedby: "j" })] });
        expect(judgeRowsOf(marks, d)).toEqual([
            { key: "r0", kind: "reopen", tag: "Reopens D4", text: "not checked", sub: "D4 · the cell is empty" },
            { key: "r1", kind: "reopen", tag: "Reopens D9", text: "gone", sub: "" },
            { key: "n0", kind: "new", tag: "New point", text: "a point", sub: "" },
            { key: "n1", kind: "new", tag: "New point", text: "another", sub: "" },
        ]);
        expect(judgeCounts(marks)).toBe("2 reopened · 2 new points");
    });

    it("leaves the item line out without a pair view, and draws nothing for no new points", () => {
        expect(judgeRowsOf(marks, null)[0].sub).toBe("");
        expect(judgeRowsOf(parseJudgeMarks("no new points"), null)).toEqual([]);
        expect(judgeCounts(parseJudgeMarks("new: one"))).toBe("1 new point");
    });
});
