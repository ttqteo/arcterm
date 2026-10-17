import { describe, expect, it } from "vitest";
import {
    askOf,
    hashText,
    HIGHLIGHT_REMINDER,
    HIGHLIGHT_SECTION,
    inlineRuns,
    isAskInView,
    keepMarks,
    layout,
    MAX_KEPT,
    parseMarks,
    rowsFromAsk,
    shownMarks,
    submitContext,
} from "./highlight-core";

describe("submitContext", () => {
    const base = { isInteractive: true, isCommand: false, isComposed: false, hasTold: false };

    it("carries the whole ask on the first prompt while the system prompt has not taken it", () => {
        expect(submitContext(base)).toBe(HIGHLIGHT_SECTION);
    });

    it("carries the reminder on later prompts", () => {
        expect(submitContext({ ...base, hasTold: true })).toBe(HIGHLIGHT_REMINDER);
    });

    it("carries nothing once the section was composed, for a command, or headless", () => {
        expect(submitContext({ ...base, isComposed: true })).toBeNull();
        expect(submitContext({ ...base, isCommand: true })).toBeNull();
        expect(submitContext({ ...base, isInteractive: false })).toBeNull();
    });
});

describe("parseMarks", () => {
    it("strips the marks and keeps what they marked, in order", () => {
        const { clean, marks } = parseMarks("Yes. ==It works without a fork.== More.\n- ==One item.==");
        expect(clean).toBe("Yes. It works without a fork. More.\n- One item.");
        expect(marks).toEqual(["It works without a fork.", "One item."]);
    });

    it("leaves == in code alone, in a span and in a fence", () => {
        const reply = "Compare with `a == b` here.\n```js\nif (x ==y==) {}\n```\n==Real.==";
        const { clean, marks } = parseMarks(reply);
        expect(clean).toBe("Compare with `a == b` here.\n```js\nif (x ==y==) {}\n```\nReal.");
        expect(marks).toEqual(["Real."]);
    });

    it("keeps inline code inside a mark, and an == in that code does not close it", () => {
        const { clean, marks } = parseMarks("==Where no mod runs, `==` shows as written.==");
        expect(clean).toBe("Where no mod runs, `==` shows as written.");
        expect(marks).toEqual(["Where no mod runs, `==` shows as written."]);
    });

    it("reads == with a space after it as prose, not a mark", () => {
        const reply = "a == b and c == d";
        expect(parseMarks(reply)).toEqual({ clean: reply, marks: [] });
    });

    it("leaves an unclosed mark as written", () => {
        expect(parseMarks("==never closed")).toEqual({ clean: "==never closed", marks: [] });
    });

    it("never lets a mark span lines", () => {
        expect(parseMarks("==one\ntwo==").marks).toEqual([]);
    });
});

describe("shownMarks", () => {
    it("draws at most four, and none past the length cap", () => {
        const long = "x".repeat(301);
        expect(shownMarks(["a", long, "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d"]);
    });
});

describe("askOf", () => {
    it("is the last mark when it asks", () => {
        expect(askOf(["Point.", "A, B or C?"])).toBe("A, B or C?");
    });

    it("is null when the last mark does not ask, even if an earlier one did", () => {
        expect(askOf(["Which one?", "The point."])).toBeNull();
        expect(askOf([])).toBeNull();
    });
});

describe("hashText and keepMarks", () => {
    it("tells texts apart and is stable", () => {
        expect(hashText("abc")).toBe(hashText("abc"));
        expect(hashText("abc")).not.toBe(hashText("abd"));
    });

    it("keeps the newest, replacing a hash already kept", () => {
        const kept = keepMarks(keepMarks([["h1", ["a"]]], "h2", ["b"]), "h1", ["c"]);
        expect(kept).toEqual([
            ["h2", ["b"]],
            ["h1", ["c"]],
        ]);
        let many: [string, string[]][] = [];
        for (let i = 0; i <= MAX_KEPT; i++) many = keepMarks(many, `h${i}`, []);
        expect(many).toHaveLength(MAX_KEPT);
        expect(many[0][0]).toBe("h1");
    });
});

describe("inlineRuns", () => {
    it("styles bold, italic and code, and marks the given range", () => {
        const line = "Use **this** and `that`, *now*.";
        const at = line.indexOf("**this**");
        const runs = inlineRuns(line, [[at, at + "**this** and `that`".length]]);
        expect(runs).toEqual([
            { text: "Use " },
            { text: "this", isBold: true, isMarked: true },
            { text: " and ", isMarked: true },
            { text: "that", isCode: true, isMarked: true },
            { text: ", " },
            { text: "now", isItalic: true },
            { text: "." },
        ]);
    });

    it("draws a link as its text and leaves an unclosed marker literal", () => {
        expect(inlineRuns("see [docs](https://x.dev) **open", [])).toEqual([{ text: "see docs **open" }]);
    });
});

describe("layout", () => {
    const reply = "Intro line.\n\n**Heading**\n- plain item\n- Marked item here.\n\nLast paragraph.";

    it("draws the lines holding a mark apart and the rest as markdown, blank lines as gaps", () => {
        expect(layout(reply, ["Marked item here."], false)).toEqual([
            { kind: "markdown", text: "Intro line.\n\n**Heading**\n- plain item", isDim: false },
            { kind: "line", prefix: "- ", runs: [{ text: "Marked item here.", isMarked: true }], isHeading: false },
            { kind: "gap" },
            { kind: "markdown", text: "Last paragraph.", isDim: false },
        ]);
    });

    it("under skim dims the markdown but keeps headings bright", () => {
        expect(layout(reply, ["Marked item here."], true)).toEqual([
            { kind: "markdown", text: "Intro line.", isDim: true },
            { kind: "gap" },
            { kind: "markdown", text: "**Heading**", isDim: false },
            { kind: "markdown", text: "- plain item", isDim: true },
            { kind: "line", prefix: "- ", runs: [{ text: "Marked item here.", isMarked: true }], isHeading: false },
            { kind: "gap" },
            { kind: "markdown", text: "Last paragraph.", isDim: true },
        ]);
    });

    it("marks a sentence inside a paragraph, leaving the rest of the line plain", () => {
        const [line] = layout("Before. Key one. After.", ["Key one."], false);
        expect(line).toEqual({
            kind: "line",
            prefix: "",
            runs: [{ text: "Before. " }, { text: "Key one.", isMarked: true }, { text: " After." }],
            isHeading: false,
        });
    });

    it("bolds a marked heading and drops its hashes", () => {
        const [line] = layout("## Key heading", ["Key heading"], false);
        expect(line).toEqual({
            kind: "line",
            prefix: "",
            runs: [{ text: "Key heading", isBold: true, isMarked: true }],
            isHeading: true,
        });
    });

    it("never draws a mark inside a fence or a table row", () => {
        const text = "```\nKey\n```\n| Key | x |";
        expect(layout(text, ["Key"], false)).toEqual([{ kind: "markdown", text, isDim: false }]);
    });

    it("draws a fence of commands for the person to type highlighted, without its fence lines", () => {
        const text = "Built it.\n\nInstall it:\n\n```\n! task install\n```\n\nThat closes arcterm. Key one.";
        expect(layout(text, ["Key one."], true)).toEqual([
            { kind: "markdown", text: "Built it.\n\nInstall it:", isDim: true },
            { kind: "gap" },
            {
                kind: "line",
                prefix: "",
                runs: [{ text: "! task install", isCode: true, isMarked: true }],
                isHeading: false,
            },
            { kind: "gap" },
            {
                kind: "line",
                prefix: "",
                runs: [{ text: "That closes arcterm. " }, { text: "Key one.", isMarked: true }],
                isHeading: false,
            },
        ]);
    });

    it("highlights a command in a code span, but not other code", () => {
        const [line] = layout("Type `! task install` when `a != b` holds.", ["holds."], false);
        expect(line).toEqual({
            kind: "line",
            prefix: "",
            runs: [
                { text: "Type " },
                { text: "! task install", isCode: true, isMarked: true },
                { text: " when " },
                { text: "a != b", isCode: true },
                { text: " " },
                { text: "holds.", isMarked: true },
            ],
            isHeading: false,
        });
    });

    it("leaves a fence alone when any line in it is not a command", () => {
        const text = "```\n! task install\nls\n```\n```\n```";
        expect(layout(text, [], false)).toEqual([{ kind: "markdown", text, isDim: false }]);
    });
});

describe("rowsFromAsk and isAskInView", () => {
    it("counts the wrapped rows from the question's line to the reply's end", () => {
        const clean = "Options.\n\n" + "a".repeat(25) + " Which one?\nTail.";
        expect(rowsFromAsk(clean, "Which one?", 20)).toBe(3);
    });

    it("sees the question only while its rows overlap the viewport", () => {
        expect(isAskInView({ first: 0, last: 9, of: 20 }, 3)).toBe(false);
        expect(isAskInView({ first: 10, last: 17, of: 20 }, 3)).toBe(true);
        expect(isAskInView(null, 3)).toBe(false);
    });
});
