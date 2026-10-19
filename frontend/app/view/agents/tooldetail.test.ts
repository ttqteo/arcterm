import { describe, expect, it } from "vitest";
import { answerAsk, askQuestions, buildEditDiff, formatDuration, parseGrep, sliceRead, toolResultText } from "./tooldetail";

describe("toolResultText", () => {
    it("returns a string result verbatim", () => {
        expect(toolResultText("hello")).toBe("hello");
    });
    it("joins text blocks of an array result", () => {
        expect(toolResultText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
    });
    it("keeps only the string text of text blocks, skipping other blocks and non-objects", () => {
        const content = [
            { type: "text", text: "a" },
            { type: "image", text: "not text" },
            { type: "text", text: 42 },
            { type: "tool_reference" },
            null,
            "stray",
            { type: "text", text: "b" },
        ];
        expect(toolResultText(content)).toBe("a\nb");
    });
    it("returns '' for missing/odd content", () => {
        expect(toolResultText(undefined)).toBe("");
        expect(toolResultText(42)).toBe("");
    });
});

describe("buildEditDiff", () => {
    it("emits removed lines then added lines with counts", () => {
        const f = buildEditDiff("/proj/a.ts", "old1\nold2", "new1");
        expect(f).toEqual({
            path: "/proj/a.ts",
            badge: "M",
            adds: 1,
            dels: 2,
            lines: [
                { sign: "-", text: "old1" },
                { sign: "-", text: "old2" },
                { sign: "+", text: "new1" },
            ],
        });
    });
    it("marks an empty old_string as an add (new file)", () => {
        const f = buildEditDiff("/proj/n.ts", "", "line");
        expect(f.badge).toBe("A");
        expect(f.dels).toBe(0);
    });
});

describe("parseGrep", () => {
    it("splits path:line prefix from code", () => {
        expect(parseGrep("src/a.ts:42:  const x = 1")).toEqual([{ loc: "src/a.ts:42", code: "  const x = 1" }]);
    });
    it("falls back to whole line as code when no prefix", () => {
        expect(parseGrep("no-prefix line")).toEqual([{ loc: "", code: "no-prefix line" }]);
    });
});

describe("sliceRead", () => {
    it("keeps content under the cap intact", () => {
        expect(sliceRead("a\nb", 9)).toEqual({ snippet: "a\nb", truncated: false });
    });
    it("truncates past the cap and flags it", () => {
        const r = sliceRead("1\n2\n3\n4", 2);
        expect(r).toEqual({ snippet: "1\n2", truncated: true });
    });
});

describe("formatDuration", () => {
    it("sub-minute → seconds with one decimal", () => {
        expect(formatDuration(3200)).toBe("3.2s");
        expect(formatDuration(400)).toBe("0.4s");
    });
    it("minutes past 60s", () => {
        expect(formatDuration(720000)).toBe("12m");
    });
    it("undefined → empty", () => {
        expect(formatDuration(undefined)).toBe("");
    });
});

describe("askQuestions", () => {
    it("drops entries without a question string and keeps the rest in order", () => {
        const raw = [{ header: "orphan" }, null, { question: 5 }, { question: "First?" }, { question: "Second?" }];
        expect(askQuestions(raw).map((q) => q.question)).toStrictEqual(["First?", "Second?"]);
    });

    it("keeps a non-empty string header and omits the key for an empty or non-string one", () => {
        const [withHeader, empty, numeric, missing] = askQuestions([
            { question: "q1", header: "Auth" },
            { question: "q2", header: "" },
            { question: "q3", header: 5 },
            { question: "q4" },
        ]);
        expect(withHeader).toStrictEqual({ question: "q1", header: "Auth", options: [], picked: [] });
        expect(empty).toStrictEqual({ question: "q2", options: [], picked: [] });
        expect(numeric).toStrictEqual({ question: "q3", options: [], picked: [] });
        expect(missing).toStrictEqual({ question: "q4", options: [], picked: [] });
    });

    it("projects options to label and non-empty description, dropping entries without a label", () => {
        const [q] = askQuestions([
            {
                question: "Which?",
                options: [
                    { label: "A", description: "first", value: 1 },
                    { description: "no label" },
                    null,
                    { label: "B", description: "" },
                    { label: "C", description: 7 },
                    { label: "D" },
                ],
            },
        ]);
        expect(q.options).toStrictEqual([
            { label: "A", description: "first" },
            { label: "B" },
            { label: "C" },
            { label: "D" },
        ]);
    });

    it("reads a question whose options are not an array as having none", () => {
        expect(askQuestions([{ question: "q", options: "A,B" }])).toStrictEqual([
            { question: "q", options: [], picked: [] },
        ]);
    });
});

describe("answerAsk", () => {
    const ask = (...questions: string[]) => askQuestions(questions.map((question) => ({ question, options: [{ label: "A" }] })));

    it("skips a question with a missing, empty or non-string answer and returns no summary", () => {
        const qs = ask("q1", "q2");
        expect(answerAsk(qs, { q2: 5 })).toBeUndefined();
        expect(answerAsk(qs, { q1: "" })).toBeUndefined();
        expect(qs).toStrictEqual(ask("q1", "q2"));
    });

    it("returns no summary for a single unanswered question", () => {
        expect(answerAsk(ask("q"), {})).toBeUndefined();
    });

    it("fills the picked labels and summarises a single answer as that answer", () => {
        const qs = ask("q");
        expect(answerAsk(qs, { q: "A" })).toBe("A");
        expect(qs[0].picked).toStrictEqual(["A"]);
    });

    it("counts the answers given when there are several questions", () => {
        expect(answerAsk(ask("q1", "q2", "q3"), { q1: "A", q3: "typed" })).toBe("2 answers");
    });

    it("keeps an answer of exactly 32 characters and cuts a longer one to 31 plus an ellipsis", () => {
        const exact = "x".repeat(32);
        expect(answerAsk(ask("q"), { q: exact })).toBe(exact);
        expect(answerAsk(ask("q"), { q: exact + "y" })).toBe("x".repeat(31) + "…");
    });
});
