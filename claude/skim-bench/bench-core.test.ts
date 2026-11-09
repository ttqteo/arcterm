import { describe, expect, it } from "vitest";
import {
    drawn,
    failureKinds,
    isKept,
    problems,
    regressions,
    score,
    scrub,
    summarize,
    type Baseline,
    type Case,
} from "./bench-core";

const fold = (text: string) => ({ text, isFull: false, ratio: 0.3 });
const reply = (...lines: string[]) => lines.join("\n");
const none = { reply: "", marks: [], mustKeep: [] };

describe("score", () => {
    it("fails criterion 1 on an item left as its bold label", () => {
        const s = score(none, fold("Verdict.\n\n- **What they do:**\n- **Two.** Has text."));
        expect(s.criteria[1]).toBe(false);
        expect(s.why).toContain("1: bare label - **What they do:**");
    });

    it("fails criteria 2 and 3 on a must-keep unit the fold lost, and keeps one shown whole", () => {
        const c = {
            reply: "",
            marks: [],
            mustKeep: [
                { text: "The test still flakes.", criterion: 2 as const },
                { text: "Option (a) keeps the cache.", criterion: 3 as const },
            ],
        };
        const s = score(c, fold("Done.\n\n**Found not fixed:**\nThe test   still **flakes**."));
        expect(s.criteria[2]).toBe(true);
        expect(s.criteria[3]).toBe(false);
        expect(s.kept).toBe(1);
    });

    it("fails criterion 3 on a sentence ending in a colon with nothing after it, and on an empty heading", () => {
        expect(score(none, fold("The decision is yours:")).why).toContain(
            '3: what "The decision is yours:" points at is not in the fold'
        );
        expect(score(none, fold("Verdict.\n\n## Everything else passed\n\n## Next\ntext")).criteria[3]).toBe(false);
        expect(score(none, fold("Pick one:\n\n```\n! task install\n```")).criteria[3]).toBe(true);
    });

    it("fails criterion 3 when the block a colon points at in the reply is not what follows it in the fold", () => {
        const c = {
            reply: reply("Done.", "", "The decision is yours:", "", "(a) Keep it.", "(b) Drop it.", "", "I pick (a)."),
            marks: [],
            mustKeep: [],
        };
        expect(score(c, fold("Done.\n\nThe decision is yours:\n\nI pick (a).")).criteria[3]).toBe(false);
        expect(score(c, fold("Done.\n\nThe decision is yours:\n\n(a) Keep it.\n(b) Drop it.")).criteria[3]).toBe(true);
    });

    it("passes criterion 4 only when each section of the reply has a line of its own under its title", () => {
        const text = reply(
            "Landed it.",
            "",
            "## What landed",
            "- The parser takes tabs now.",
            "",
            "## Found not fixed",
            "- The flaky test in the store.",
            "",
            "## Numbers",
            "| a | b |",
            "|---|---|",
            "| 1 | 2 |"
        );
        const c = { reply: text, marks: [], mustKeep: [] };
        const good = fold(
            reply(
                "Landed it.",
                "",
                "## What landed",
                "- The parser takes tabs now.",
                "",
                "## Found not fixed",
                "- The flaky test…",
                "",
                "## Numbers",
                "(table · 1 row)"
            )
        );
        expect(score(c, good).criteria[4]).toBe(true);
        const short = score(c, fold("Landed it.\n\n- The parser takes tabs now."));
        expect(short.criteria[4]).toBe(false);
        expect(short.why).toContain("4: no line for ## Found not fixed");
        expect(score(c, fold("Landed it.\n\n## What landed\n- Invented text.")).criteria[4]).toBe(false);
    });

    it("fails criterion 4 on raw table rows or code in the fold", () => {
        const c = { reply: "Intro.\n\n| a |\n|---|\n| 1 |", marks: [], mustKeep: [] };
        expect(score(c, fold("Intro.\n\n| a |")).why).toContain("4: raw table rows or code in the fold");
    });

    it("passes everything when the reply draws in full", () => {
        const s = score({ ...none, mustKeep: [{ text: "x", criterion: 2 }] }, { text: "", isFull: true, ratio: 1 });
        expect(Object.values(s.criteria).every(Boolean)).toBe(true);
        expect(s.kept).toBe(1);
    });
});

describe("drawn", () => {
    it("draws the reply in full when the fold reaches 2/3 of its lines", () => {
        const text = Array.from({ length: 12 }, (_, i) => `Line ${i}.`).join("\n");
        expect(drawn(text, [], Array(8).fill("x").join("\n"))).toEqual({ text, isFull: true, ratio: 1 });
        expect(drawn(text, [], "x\ny").isFull).toBe(false);
    });
});

describe("isKept", () => {
    it("matches the sentence whole, bold and whitespace aside, and not a cut one", () => {
        expect(isKept("Run **task** generate first.", "- Run task\n  generate first.")).toBe(true);
        expect(isKept("Run task generate first.", "- Run task gen…")).toBe(false);
    });
});

describe("summarize and regressions", () => {
    const pass = { 1: true, 2: true, 3: true, 4: true } as const;
    const fail4 = { ...pass, 4: false };
    const baseline: Baseline = {
        commit: "abc",
        saved: "2026-11-09",
        cases: { a: { fold: "", criteria: pass, ratio: 0.3 }, b: { fold: "", criteria: fail4, ratio: 0.3 } },
    };

    it("reports the share of cases passing each criterion and the median ratio", () => {
        const s = summarize([
            { criteria: pass, ratio: 0.2, kept: 1, mustKeep: 2 },
            { criteria: fail4, ratio: 0.4, kept: 1, mustKeep: 1 },
        ]);
        expect(s.rates[4]).toBe(0.5);
        expect(s.rates.all).toBe(0.5);
        expect(s.medianRatio).toBeCloseTo(0.3);
        expect(s.recall).toBeCloseTo(2 / 3);
    });

    it("fails when a criterion drops below the baseline on the cases both hold", () => {
        expect(
            regressions({ a: { criteria: fail4, ratio: 0.3 }, b: { criteria: fail4, ratio: 0.3 } }, baseline)
        ).toEqual(["criterion 4: 0% of 2 cases pass, the baseline 50%"]);
        expect(
            regressions({ a: { criteria: pass, ratio: 0.3 }, new: { criteria: fail4, ratio: 0.3 } }, baseline)
        ).toEqual([]);
    });

    it("fails when the median ratio rises more than 10 points over the baseline", () => {
        const now = { a: { criteria: pass, ratio: 0.45 }, b: { criteria: pass, ratio: 0.45 } };
        expect(regressions(now, baseline)).toHaveLength(1);
        expect(
            regressions({ a: { criteria: pass, ratio: 0.39 }, b: { criteria: pass, ratio: 0.39 } }, baseline)
        ).toEqual([]);
    });
});

describe("failureKinds", () => {
    const s = (fails: number[]) => ({
        criteria: { 1: !fails.includes(1), 2: !fails.includes(2), 3: !fails.includes(3), 4: !fails.includes(4) },
        why: [],
        ratio: 0.2,
        kept: 0,
        mustKeep: 0,
    });
    it("names kind 2 for an unmarked reply losing a section, kinds 3 and 4 for a marked one", () => {
        expect(failureKinds(s([1, 4]), false)).toEqual([1, 2]);
        expect(failureKinds(s([3, 4]), true)).toEqual([3, 4]);
    });
});

describe("problems", () => {
    it("flags a must-keep unit or a mark the reply does not hold, and a reply that does not fold", () => {
        const c: Case = {
            reply: "short",
            marks: ["gone"],
            source: "generated",
            mustKeep: [{ text: "Not there.", criterion: 2 }],
            questions: [{ q: "Q?", a: "A" }],
            labels: {},
        };
        expect(problems(c)).toEqual([
            "the reply does not fold: too short, or it ends on a question",
            'mark not in the reply: "gone"',
            'must-keep not in the reply: "Not there."',
        ]);
    });
});

describe("scrub", () => {
    const who = { home: "C:\\Users\\alice", user: "alice" };
    it("replaces the home, drive paths past two parts, emails, tokens and the account name", () => {
        expect(scrub("see C:\\Users\\alice\\proj\\a.ts and c:/users/alice/x", who)).toBe("see ~\\proj\\a.ts and ~/x");
        expect(scrub("in D:\\work\\repo\\pkg\\x.go.", who)).toBe("in …\\pkg\\x.go.");
        expect(scrub("D:\\repo is short", who)).toBe("D:\\repo is short");
        expect(scrub("mail alice.b@corp.io now", who)).toBe("mail someone@example.com now");
        expect(scrub("key sk-ant-abcdefghijklmnop1234 ghp_abcdefghijklmnopqrstuv12", who)).toBe("key <token> <token>");
        expect(scrub("/home/bob/src and /Users/bob", who)).toBe("~/src and ~");
        expect(scrub("alice said", who)).toBe("me said");
        expect(scrub("commit 0afafc4bd1234567890abcdef1234567890abcd", who)).toBe(
            "commit 0afafc4bd1234567890abcdef1234567890abcd"
        );
    });
});
