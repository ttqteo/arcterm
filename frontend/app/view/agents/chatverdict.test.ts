// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pairAnswers, parseSentStore, type SentAnswer } from "./chatbrainstorm";
import { pairedHidden } from "./chatbrainstormwire";
import {
    REVIEW_LANG,
    VERDICT_TOPIC,
    fixLabel,
    fixLine,
    initialTicks,
    pairReviewer,
    parseReviewBlock,
    skipLine,
    splitReviewBlocks,
    verdictChip,
    verdictDoneLine,
    verdictFromFindings,
    verdictHead,
    verdictMode,
    verdictRecord,
    type ReviewerCall,
    type Verdict,
    type VerdictFinding,
} from "./chatverdict";

const FINDINGS: VerdictFinding[] = [
    { severity: "Critical", file: "pkg/a.go", line: 12, summary: "Nil map write on the first call." },
    { severity: "Important", file: "frontend/b.ts", line: 40, summary: "The tick state is lost on remount." },
    { severity: "Minor", file: "frontend/c.ts", summary: "A comment is out of date." },
];

function verdict(over: Partial<Verdict> = {}): Verdict {
    return {
        kind: "code",
        reviewer: "code-reviewer",
        pass: false,
        note: "Two things to fix.",
        findings: FINDINGS,
        ...over,
    };
}

const block = (o: unknown): string => JSON.stringify(o);

describe("parseReviewBlock", () => {
    it("reads a block with findings and a subagent", () => {
        const v = parseReviewBlock(
            block({
                kind: "code",
                reviewer: "code-reviewer",
                pass: false,
                note: "Two things to fix.",
                subagent: "Review task 3",
                findings: [
                    { severity: "Critical", file: "pkg/a.go", line: 12, summary: "Nil map write." },
                    { severity: "Minor", file: "b.ts", summary: "Stale comment." },
                ],
            })
        );
        expect(v).toEqual({
            kind: "code",
            reviewer: "code-reviewer",
            pass: false,
            note: "Two things to fix.",
            subagent: "Review task 3",
            findings: [
                { severity: "Critical", file: "pkg/a.go", line: 12, summary: "Nil map write." },
                { severity: "Minor", file: "b.ts", summary: "Stale comment." },
            ],
        });
    });

    it("reads a block with no findings and no subagent", () => {
        const v = parseReviewBlock(block({ kind: "plan", reviewer: "review-plan", pass: true, note: "Ready to run." }));
        expect(v).toEqual({ kind: "plan", reviewer: "review-plan", pass: true, note: "Ready to run.", findings: [] });
        expect(v != null && "subagent" in v).toBe(false);
    });

    it("keeps the fields that are optional left out when the block has none", () => {
        const v = parseReviewBlock(block({ kind: "code", pass: true }));
        expect(v).toEqual({ kind: "code", reviewer: "", pass: true, note: "", findings: [] });
    });

    it("reads a severity whatever its case, and takes Important for one it does not know", () => {
        const v = parseReviewBlock(
            block({
                kind: "code",
                pass: false,
                findings: [
                    { severity: "critical", file: "a", summary: "x" },
                    { severity: "MINOR", file: "b", summary: "y" },
                    { severity: "Blocker", file: "c", summary: "z" },
                    { file: "d", summary: "w" },
                ],
            })
        );
        expect(v?.findings.map((f) => f.severity)).toEqual(["Critical", "Minor", "Important", "Important"]);
    });

    it("keeps a line only when it is a positive whole number, and a missing file as an empty one", () => {
        const v = parseReviewBlock(
            block({
                kind: "code",
                pass: false,
                findings: [
                    { severity: "Minor", file: "a", line: 0, summary: "x" },
                    { severity: "Minor", file: "b", line: "7", summary: "y" },
                    { severity: "Minor", file: "c", line: 3.5, summary: "z" },
                    { severity: "Minor", summary: "no file", line: 9 },
                ],
            })
        );
        expect(v?.findings).toEqual([
            { severity: "Minor", file: "a", summary: "x" },
            { severity: "Minor", file: "b", summary: "y" },
            { severity: "Minor", file: "c", summary: "z" },
            { severity: "Minor", file: "", line: 9, summary: "no file" },
        ]);
    });

    it.each([
        ["broken JSON", "{ kind: code"],
        ["not an object", "[1, 2]"],
        ["a string", '"approved"'],
        ["null", "null"],
        ["no pass", block({ kind: "code", reviewer: "r", note: "n" })],
        ["a pass that is not a boolean", block({ kind: "code", pass: "yes" })],
        ["no kind", block({ pass: true })],
        ["a wrong kind", block({ kind: "design", pass: true })],
        ["findings that are not a list", block({ kind: "code", pass: false, findings: "many" })],
        ["a finding that is not an object", block({ kind: "code", pass: false, findings: ["x"] })],
        [
            "a finding with no summary",
            block({ kind: "code", pass: false, findings: [{ severity: "Minor", file: "a" }] }),
        ],
        [
            "a finding with a blank summary",
            block({ kind: "code", pass: false, findings: [{ file: "a", summary: " " }] }),
        ],
    ])("is null for %s", (_name, raw) => {
        expect(parseReviewBlock(raw)).toBeNull();
    });
});

describe("splitReviewBlocks", () => {
    const one = block({ kind: "code", reviewer: "r", pass: true, note: "ok" });
    const two = block({
        kind: "plan",
        reviewer: "p",
        pass: false,
        note: "no",
        findings: [{ file: "a", summary: "x" }],
    });
    const fence = (body: string, lang = REVIEW_LANG): string => "```" + lang + "\n" + body + "\n```";

    it("is one prose part for a text with no block", () => {
        expect(splitReviewBlocks("Just words.\n\nMore.")).toEqual([{ kind: "prose", text: "Just words.\n\nMore." }]);
        expect(splitReviewBlocks("")).toEqual([]);
    });

    it("cuts a block out of its prose, keeping the prose before and after as parts", () => {
        const parts = splitReviewBlocks(`The review is back.\n\n${fence(one)}\n\nNow I fix it.`);
        expect(parts.map((p) => p.kind)).toEqual(["prose", "verdict", "prose"]);
        expect(parts[0]).toEqual({ kind: "prose", text: "The review is back." });
        expect(parts[1]).toMatchObject({ kind: "verdict", verdict: { kind: "code", reviewer: "r", pass: true } });
        expect(parts[2]).toEqual({ kind: "prose", text: "Now I fix it." });
    });

    it("splits around two blocks, with the prose between them", () => {
        const parts = splitReviewBlocks(`${fence(one)}\n\nand then\n\n${fence(two)}`);
        expect(parts.map((p) => p.kind)).toEqual(["verdict", "prose", "verdict"]);
        expect(parts[1]).toEqual({ kind: "prose", text: "and then" });
        expect(parts[2]).toMatchObject({ kind: "verdict", verdict: { kind: "plan", pass: false } });
    });

    it("leaves a block that does not parse in the prose, where the markdown draws it as code", () => {
        const text = `Before.\n\n${fence("{ not json")}\n\nAfter.`;
        expect(splitReviewBlocks(text)).toEqual([{ kind: "prose", text }]);
    });

    it("cuts the good block and keeps the broken one in its prose", () => {
        const broken = fence("{ not json");
        const parts = splitReviewBlocks(`${broken}\n\nmiddle\n\n${fence(one)}`);
        expect(parts.map((p) => p.kind)).toEqual(["prose", "verdict"]);
        expect(parts[0]).toEqual({ kind: "prose", text: `${broken}\n\nmiddle` });
    });

    it("leaves a block that is still being written (no closing fence) in the prose", () => {
        const text = "Here:\n\n```arc-review\n" + one;
        expect(splitReviewBlocks(text)).toEqual([{ kind: "prose", text }]);
    });

    it("reads only the arc-review language", () => {
        for (const text of [
            fence(one, "json"),
            fence(one, "arc-review-two"),
            fence(one, "arc-visual"),
            "use ```arc-review``` inline",
        ]) {
            expect(splitReviewBlocks(text)).toEqual([{ kind: "prose", text }]);
        }
    });

    it("reads a block whose fence is indented, and one with a longer fence", () => {
        const indented = splitReviewBlocks(`  \`\`\`arc-review\n  ${one}\n  \`\`\``);
        expect(indented.map((p) => p.kind)).toEqual(["verdict"]);
        const longer = splitReviewBlocks("````arc-review\n" + one + "\n````");
        expect(longer.map((p) => p.kind)).toEqual(["verdict"]);
    });

    it("reads a block in a text with Windows line ends", () => {
        const parts = splitReviewBlocks(`Done.\r\n\`\`\`arc-review\r\n${one}\r\n\`\`\`\r\nNext.`);
        expect(parts.map((p) => p.kind)).toEqual(["prose", "verdict", "prose"]);
    });

    it("does not look inside another code block for a fence", () => {
        const text = "````md\n```arc-review\n" + one + "\n```\n````";
        expect(splitReviewBlocks(text)).toEqual([{ kind: "prose", text }]);
    });
});

describe("verdictFromFindings", () => {
    it("maps CONFIRMED to Important, PLAUSIBLE to Minor, and no verdict to Important", () => {
        const v = verdictFromFindings({
            findings: [
                { file: "a.go", line: 3, summary: "One.", failure_scenario: "x", verdict: "CONFIRMED", category: "c" },
                { file: "b.ts", line: 9, summary: "Two.", failure_scenario: "y", verdict: "PLAUSIBLE" },
                { file: "c.ts", summary: "Three.", failure_scenario: "z" },
            ],
        });
        expect(v).toEqual({
            kind: "code",
            reviewer: "code-review",
            pass: false,
            note: "3 findings, 1 confirmed",
            findings: [
                { severity: "Important", file: "a.go", line: 3, summary: "One." },
                { severity: "Minor", file: "b.ts", line: 9, summary: "Two." },
                { severity: "Important", file: "c.ts", summary: "Three." },
            ],
        });
    });

    it("counts one finding in the singular", () => {
        const v = verdictFromFindings({ findings: [{ file: "a", summary: "x", verdict: "CONFIRMED" }] });
        expect(v?.note).toBe("1 finding, 1 confirmed");
    });

    it("passes with no findings", () => {
        expect(verdictFromFindings({ findings: [] })).toEqual({
            kind: "code",
            reviewer: "code-review",
            pass: true,
            note: "No findings",
            findings: [],
        });
    });

    it.each([
        ["nothing", undefined],
        ["null", null],
        ["a string", "x"],
        ["an object with no findings list", {}],
        ["findings that are not a list", { findings: "x" }],
        ["a finding with no summary", { findings: [{ file: "a" }] }],
        ["a finding that is not an object", { findings: [3] }],
    ])("is null for %s", (_name, input) => {
        expect(verdictFromFindings(input)).toBeNull();
    });
});

describe("pairReviewer", () => {
    const calls: ReviewerCall[] = [
        { description: "Explore the repo", subagentType: "Explore", toolUseId: "t1", index: 2 },
        { description: "Review task 3", subagentType: "superpowers:code-reviewer", toolUseId: "t2", index: 4 },
        { description: "Check the plan", subagentType: "general-purpose", toolUseId: "t3", index: 6 },
        { description: "Review task 4", subagentType: "superpowers:code-reviewer", toolUseId: "t4", index: 8 },
    ];

    it("pairs a block with the call whose description its `subagent` names", () => {
        expect(pairReviewer(verdict({ subagent: "Check the plan" }), calls, 10)?.toolUseId).toBe("t3");
        expect(pairReviewer(verdict({ subagent: "  review TASK 3 " }), calls, 10)?.toolUseId).toBe("t2");
    });

    it("takes the nearest of two calls with the same description before the block", () => {
        const twice: ReviewerCall[] = [
            { description: "Review", index: 2, toolUseId: "old" },
            { description: "Review", index: 6, toolUseId: "new" },
        ];
        expect(pairReviewer(verdict({ subagent: "Review" }), twice, 8)?.toolUseId).toBe("new");
        expect(pairReviewer(verdict({ subagent: "Review" }), twice, 4)?.toolUseId).toBe("old");
    });

    it("pairs nothing when the `subagent` names no call of the item", () => {
        expect(pairReviewer(verdict({ subagent: "Review task 9" }), calls, 10)).toBeNull();
    });

    it("pairs a block with no `subagent` to the nearest reviewer call before it", () => {
        expect(pairReviewer(verdict(), calls, 10)?.toolUseId).toBe("t4");
        expect(pairReviewer(verdict(), calls, 7)?.toolUseId).toBe("t2");
    });

    it("reads a reviewer by its subagent type or its description, in any case", () => {
        const byType: ReviewerCall[] = [{ description: "Look at it", subagentType: "Code-REVIEWER", index: 1 }];
        const byDescription: ReviewerCall[] = [
            { description: "Plan Review", subagentType: "general-purpose", index: 1 },
        ];
        expect(pairReviewer(verdict(), byType, 5)).toEqual(byType[0]);
        expect(pairReviewer(verdict(), byDescription, 5)).toEqual(byDescription[0]);
    });

    it("pairs nothing when no reviewer call comes before the block", () => {
        expect(pairReviewer(verdict(), calls, 3)).toBeNull();
        expect(pairReviewer(verdict(), [], 10)).toBeNull();
        expect(pairReviewer(verdict(), [calls[0]], 10)).toBeNull();
    });
});

describe("initialTicks", () => {
    it("ticks Critical and Important findings, not Minor ones", () => {
        expect([...initialTicks(verdict())]).toEqual([0, 1]);
    });

    it("ticks nothing for no findings, or for Minor ones only", () => {
        expect(initialTicks(verdict({ findings: [] })).size).toBe(0);
        expect(initialTicks(verdict({ findings: [FINDINGS[2]] })).size).toBe(0);
    });
});

describe("verdictMode", () => {
    const base = { last: true, live: true, working: false, nextIsYou: false, record: null, v: verdict() };

    it("waits on you when it is the last thing and the agent is idle", () => {
        expect(verdictMode(base)).toEqual({ mode: "waiting" });
    });

    it("shows a card without ticks or buttons while the agent works", () => {
        expect(verdictMode({ ...base, working: true })).toEqual({ mode: "working" });
    });

    it("is static for an agent that exited or an ended session, working or not", () => {
        expect(verdictMode({ ...base, live: false })).toEqual({ mode: "static" });
        expect(verdictMode({ ...base, live: false, working: true })).toEqual({ mode: "static" });
    });

    it("folds once something follows it: `You replied` when your message does, nothing when the agent wrote on", () => {
        expect(verdictMode({ ...base, last: false, nextIsYou: true })).toEqual({
            mode: "folded",
            outcome: { kind: "replied" },
        });
        expect(verdictMode({ ...base, last: false })).toEqual({ mode: "folded", outcome: { kind: "moved-on" } });
        // an agent that exited after more happened still folds
        expect(verdictMode({ ...base, last: false, live: false })).toEqual({
            mode: "folded",
            outcome: { kind: "moved-on" },
        });
    });

    it("folds with what you sent when a record says so, whatever else is true", () => {
        const fixed = verdictMode({ ...base, record: { verdictOutcome: "fix", fixed: 2 } });
        expect(fixed).toEqual({ mode: "folded", outcome: { kind: "fix", fixed: 2 } });
        const skipped = verdictMode({ ...base, last: false, nextIsYou: true, record: { verdictOutcome: "skip" } });
        expect(skipped).toEqual({ mode: "folded", outcome: { kind: "skip" } });
        const exited = verdictMode({ ...base, live: false, working: true, record: { verdictOutcome: "fix" } });
        expect(exited).toEqual({ mode: "folded", outcome: { kind: "fix", fixed: 0 } });
    });

    it("folds a record with no outcome with none", () => {
        expect(verdictMode({ ...base, record: {} })).toEqual({ mode: "folded", outcome: null });
    });

    it("folds an approval with no findings from the start: nothing is left to pick", () => {
        const approved = verdict({ pass: true, findings: [], note: "Clean." });
        expect(verdictMode({ ...base, v: approved })).toEqual({ mode: "folded", outcome: null });
        expect(verdictMode({ ...base, v: approved, working: true })).toEqual({ mode: "folded", outcome: null });
        expect(verdictMode({ ...base, v: approved, live: false })).toEqual({ mode: "folded", outcome: null });
    });

    it("keeps an approval that still has findings as a card", () => {
        const approved = verdict({ pass: true, findings: [FINDINGS[2]] });
        expect(verdictMode({ ...base, v: approved })).toEqual({ mode: "waiting" });
    });

    it("keeps a rejection with no findings as a card", () => {
        expect(verdictMode({ ...base, v: verdict({ pass: false, findings: [] }) })).toEqual({ mode: "waiting" });
    });
});

describe("the card's lines", () => {
    it("heads a card with its kind and reviewer, or the kind alone", () => {
        expect(verdictHead(verdict())).toBe("Code review · code-reviewer");
        expect(verdictHead(verdict({ kind: "plan", reviewer: "review-plan" }))).toBe("Plan review · review-plan");
        expect(verdictHead(verdict({ reviewer: "" }))).toBe("Code review");
    });

    it("chips a pass as Approved and anything else as Changes requested", () => {
        expect(verdictChip(verdict({ pass: true }))).toBe("Approved");
        expect(verdictChip(verdict({ pass: false }))).toBe("Changes requested");
    });

    it("labels the Fix button with how many are ticked, and Fix none at zero", () => {
        expect(fixLabel(2)).toBe("Fix 2 selected");
        expect(fixLabel(1)).toBe("Fix 1 selected");
        expect(fixLabel(0)).toBe("Fix none");
    });

    it("sends one line per ticked finding, in the findings' order", () => {
        expect(fixLine(verdict(), [1, 0])).toBe(
            [
                "Fix these review findings:",
                "- pkg/a.go:12 — Nil map write on the first call.",
                "- frontend/b.ts:40 — The tick state is lost on remount.",
            ].join("\n")
        );
    });

    it("leaves the line out of a finding that has none, and the file out of one that has none", () => {
        const v = verdict({ findings: [FINDINGS[2], { severity: "Minor", file: "", summary: "Whole-plan note." }] });
        expect(fixLine(v, [0, 1])).toBe(
            ["Fix these review findings:", "- frontend/c.ts — A comment is out of date.", "- Whole-plan note."].join(
                "\n"
            )
        );
    });

    it("keeps each finding on one line, and skips a tick that names no finding", () => {
        const v = verdict({ findings: [{ severity: "Minor", file: "a", line: 1, summary: "two\nlines  here" }] });
        expect(fixLine(v, [0, 0, 5, -1])).toBe("Fix these review findings:\n- a:1 — two lines here");
    });

    it("sends a short line to skip", () => {
        expect(skipLine()).toBe("Skip the review: go on without these changes.");
    });
});

describe("verdictDoneLine", () => {
    it("says what the review found and what the person did", () => {
        expect(verdictDoneLine(verdict(), { kind: "fix", fixed: 2 })).toBe(
            "Code review · Changes requested · 3 findings — Fix 2"
        );
        expect(verdictDoneLine(verdict(), { kind: "skip" })).toBe(
            "Code review · Changes requested · 3 findings — Skipped"
        );
    });

    it("says `You replied` when your own words answered, and nothing when the agent went on", () => {
        expect(verdictDoneLine(verdict(), { kind: "replied" })).toBe(
            "Code review · Changes requested · 3 findings — You replied"
        );
        expect(verdictDoneLine(verdict(), { kind: "moved-on" })).toBe("Code review · Changes requested · 3 findings");
        expect(verdictDoneLine(verdict(), null)).toBe("Code review · Changes requested · 3 findings");
    });

    it("leaves the count out when there are no findings", () => {
        expect(verdictDoneLine(verdict({ pass: true, findings: [] }), null)).toBe("Code review · Approved");
        expect(verdictDoneLine(verdict({ kind: "plan", pass: true, findings: [] }), null)).toBe(
            "Plan review · Approved"
        );
    });

    it("counts one finding in the singular", () => {
        expect(verdictDoneLine(verdict({ findings: [FINDINGS[0]] }), { kind: "fix", fixed: 1 })).toBe(
            "Code review · Changes requested · 1 finding — Fix 1"
        );
    });
});

describe("the verdict's send record", () => {
    it("builds a record under the fixed topic, with the key, the outcome and how many were ticked", () => {
        const r = verdictRecord("verdict:7", "fix", 2, "Fix these review findings:\n- a:1 — x", 0, 5000);
        expect(r).toEqual({
            topic: VERDICT_TOPIC,
            n: 0,
            part: "",
            text: "Fix these review findings:\n- a:1 — x",
            sentAt: 5000,
            seen: 0,
            kind: "verdict",
            verdictKey: "verdict:7",
            verdictOutcome: "fix",
            fixed: 2,
        });
        expect(VERDICT_TOPIC).toBe("arc:verdict");
    });

    it("is stored, reloaded, paired with its message, and hidden there", () => {
        const sent: SentAnswer[] = [verdictRecord("verdict:3", "skip", 0, skipLine(), 1, 100)];
        const reloaded = parseSentStore(JSON.stringify({ a1: sent })).a1;
        expect(reloaded).toEqual(sent);
        const paired = pairAnswers(
            reloaded,
            [
                { key: "u0", text: "hello" },
                { key: "u1", text: "Skip the review: go on without these changes." },
                { key: "u2", text: "Skip the review: go on without these changes." },
            ],
            VERDICT_TOPIC
        );
        // seen 1 skips the earlier message with the same text
        expect([...paired.keys()]).toEqual(["u2"]);
        const answer = paired.get("u2")!;
        expect(answer).toMatchObject({ kind: "verdict", verdictKey: "verdict:3", verdictOutcome: "skip", fixed: 0 });
        expect(pairedHidden(answer, new Set())).toBe(true);
        expect(
            verdictMode({ last: true, live: true, working: false, nextIsYou: false, record: answer, v: verdict() })
        ).toEqual({
            mode: "folded",
            outcome: { kind: "skip" },
        });
    });
});
