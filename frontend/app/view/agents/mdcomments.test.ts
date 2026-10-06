// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    blockForLine,
    blockKind,
    bodyOffset,
    cardNumbers,
    commentRefLabel,
    countLine,
    coveredIndexes,
    formatMdComments,
    hostIndex,
    imageTarget,
    orderMdComments,
    panelLink,
    plusTarget,
    refPath,
    selectionQuote,
    selectionTarget,
    sourceQuote,
    spanOf,
    type MdBlock,
    type MdComment,
} from "./mdcomments";

// the first 19 lines of docs/guide.md, the CDP scenario's fixture
const GUIDE = [
    "---",
    "title: Guide",
    "---",
    "# Guide",
    "",
    "First paragraph line one,",
    "still the first paragraph.",
    "",
    "Second paragraph, the one the link names.",
    "",
    "| Flow | Use |",
    "|---|---|",
    "| Quick | one worker |",
    "| Goal | a lead |",
    "| Plan | the engine |",
    "",
    "![Shot](images/shot.png)",
    "",
    "See [the other doc](other.md).",
];

// those lines as the DOM lists their stamped blocks: frontmatter on lines 1-3
const B: MdBlock[] = [
    { kind: "block", start: 4, end: 4 }, // 0 h1
    { kind: "block", start: 6, end: 7 }, // 1 p
    { kind: "block", start: 9, end: 9 }, // 2 p
    { kind: "table", start: 11, end: 15 }, // 3
    { kind: "tr", start: 11, end: 11 }, // 4 header row
    { kind: "tr", start: 13, end: 13 }, // 5
    { kind: "tr", start: 14, end: 14 }, // 6
    { kind: "tr", start: 15, end: 15 }, // 7
    { kind: "block", start: 17, end: 17 }, // 8 p holding the image
    { kind: "img", start: 17, end: 17, src: "images/shot.png" }, // 9
    { kind: "block", start: 19, end: 19 }, // 10 p
];

// a loose list: an item with its paragraph and a nested list, then an item with its paragraph
const L: MdBlock[] = [
    { kind: "block", start: 1, end: 3 }, // 0 li
    { kind: "block", start: 1, end: 1 }, // 1 its p
    { kind: "block", start: 2, end: 2 }, // 2 nested li
    { kind: "block", start: 3, end: 3 }, // 3 nested li
    { kind: "block", start: 5, end: 5 }, // 4 li
    { kind: "block", start: 5, end: 5 }, // 5 its p
];

const mk = (o: Partial<MdComment> & Pick<MdComment, "id" | "seq" | "startLine" | "endLine">): MdComment => ({
    file: "/repo/docs/guide.md",
    root: "/repo",
    quoteKind: "none",
    quote: [],
    note: "",
    ...o,
});
const SEL = mk({
    id: "a",
    seq: 1,
    startLine: 9,
    endLine: 9,
    quoteKind: "selection",
    quote: ["the one the link names"],
    note: "Name the link's target.",
});
const RANGE = mk({
    id: "b",
    seq: 2,
    startLine: 13,
    endLine: 15,
    quoteKind: "source",
    quote: ["| Quick | one worker |", "| Goal | a lead |", "| Plan | the engine |"],
    note: "Add a column for cost.",
});
const IMG = mk({ id: "c", seq: 3, startLine: 17, endLine: 17, image: "images/shot.png", note: "Retake this shot." });
const OTHER = mk({
    id: "d",
    seq: 4,
    file: "/repo/docs/other.md",
    startLine: 3,
    endLine: 3,
    quoteKind: "selection",
    quote: ["only paragraph"],
    note: "Say more here.",
});

describe("blockKind", () => {
    it("names rows, tables and images, and calls the rest blocks", () => {
        expect([blockKind("TR"), blockKind("table"), blockKind("IMG"), blockKind("DIV"), blockKind("li")]).toEqual([
            "tr",
            "table",
            "img",
            "block",
            "block",
        ]);
    });
});

describe("bodyOffset", () => {
    it("counts the lines a frontmatter block took off the top", () => {
        expect(bodyOffset("---\ntitle: x\n---\n# H\n", "# H\n")).toBe(3);
    });
    it("bodyOffset counts a CRLF frontmatter block", () => {
        expect(bodyOffset("---\r\ntitle: x\r\n---\r\n# H\r\n", "# H\r\n")).toBe(3);
    });
    it("is 0 without one", () => {
        expect(bodyOffset("# H\n", "# H\n")).toBe(0);
    });
});

describe("quotes", () => {
    it("collapses a selection's whitespace", () => {
        expect(selectionQuote("  the one\n  the link\tnames ")).toEqual(["the one the link names"]);
    });
    it("cuts a selection at 160 characters", () => {
        const q = selectionQuote("x".repeat(200));
        expect(q[0]).toBe("x".repeat(160) + "…");
    });
    it("quotes nothing for an empty selection", () => {
        expect(selectionQuote(" \n ")).toEqual([]);
    });
    it("quotes a range's first 3 non-blank lines and counts the rest", () => {
        const lines = ["a", "", "b", "c", "d", "e"];
        expect(sourceQuote(lines, 1, 6)).toEqual(["a", "b", "c", "… (2 more lines)"]);
        expect(sourceQuote(lines, 1, 5)).toEqual(["a", "b", "c", "… (1 more line)"]);
        expect(sourceQuote(lines, 3, 4)).toEqual(["b", "c"]);
    });
    it("cuts a source line at 120 characters", () => {
        expect(sourceQuote(["y".repeat(130)], 1, 1)).toEqual(["y".repeat(120) + "…"]);
    });
});

describe("spanOf", () => {
    it("runs from the earliest start to the latest end", () => {
        expect(
            spanOf([
                { start: 9, end: 9 },
                { start: 6, end: 7 },
            ])
        ).toEqual({ start: 6, end: 9 });
        expect(spanOf([])).toBeNull();
    });
});

describe("selectionTarget", () => {
    it("takes the lines of the one block a selection sits in, and quotes the selection", () => {
        expect(selectionTarget(B, [2], "the one the link names")).toEqual({
            startLine: 9,
            endLine: 9,
            quoteKind: "selection",
            quote: ["the one the link names"],
        });
    });
    it("runs across blocks from the first one's start to the last one's end", () => {
        expect(selectionTarget(B, [1, 2], "still the first paragraph. Second")).toMatchObject({
            startLine: 6,
            endLine: 9,
        });
    });
    it("reduces each end to its innermost block: rows, not their table; a paragraph, not its list item", () => {
        expect(selectionTarget(B, [3, 5, 6], "one worker | Goal")).toMatchObject({ startLine: 13, endLine: 14 });
        expect(selectionTarget(L, [0, 1], "a")).toMatchObject({ startLine: 1, endLine: 1 });
    });
    it("keeps to the body: dragged in from outside it, it spans only the body blocks it touches", () => {
        // from the panel's header down into the first paragraph: the DOM lists the body's blocks alone
        expect(selectionTarget(B, [0, 1], "Guide First paragraph")).toMatchObject({ startLine: 4, endLine: 7 });
    });
    it("is null when it touches no stamped block", () => {
        expect(selectionTarget(B, [], "raw html")).toBeNull();
    });
});

describe("plusTarget", () => {
    it("+ alone comments on that block and quotes its source lines", () => {
        expect(plusTarget(B, 5, GUIDE, false, undefined)).toEqual({
            extend: false,
            target: {
                startLine: 13,
                endLine: 13,
                quoteKind: "source",
                quote: ["| Quick | one worker |"],
                anchor: { start: 13, end: 13 },
            },
        });
    });
    it("Shift+click downward stretches the open + box from its first block", () => {
        expect(plusTarget(B, 7, GUIDE, true, { start: 13, end: 13 })).toEqual({
            extend: true,
            target: {
                startLine: 13,
                endLine: 15,
                quoteKind: "source",
                quote: ["| Quick | one worker |", "| Goal | a lead |", "| Plan | the engine |"],
                anchor: { start: 13, end: 13 },
            },
        });
    });
    it("Shift+click upward stretches it the other way", () => {
        expect(plusTarget(B, 5, GUIDE, true, { start: 15, end: 15 })).toMatchObject({
            extend: true,
            target: { startLine: 13, endLine: 15, anchor: { start: 15, end: 15 } },
        });
    });
    it("measures every Shift+click from the first block, so a later one can shrink the range", () => {
        expect(plusTarget(B, 6, GUIDE, true, { start: 13, end: 13 })?.target).toMatchObject({
            startLine: 13,
            endLine: 14,
        });
    });
    it("Shift with no + box open opens one on that block", () => {
        expect(plusTarget(B, 2, GUIDE, true, undefined)).toMatchObject({
            extend: false,
            target: { startLine: 9, endLine: 9 },
        });
    });
    it("is null for a block that is gone", () => {
        expect(plusTarget(B, 40, GUIDE, false, undefined)).toBeNull();
    });
});

describe("imageTarget", () => {
    it("anchors to the image's line and its src as written, with no quote", () => {
        expect(imageTarget(B, 9)).toEqual({
            startLine: 17,
            endLine: 17,
            quoteKind: "none",
            quote: [],
            image: "images/shot.png",
        });
    });
    it("is null for a block that is not an image", () => {
        expect(imageTarget(B, 8)).toBeNull();
    });
});

describe("blockForLine", () => {
    it("marks the innermost block holding the line", () => {
        expect(blockForLine(B, 9)).toBe(2);
        expect(blockForLine(B, 7)).toBe(1);
        expect(blockForLine(B, 14)).toBe(6);
    });
    it("marks the table on its separator row", () => {
        expect(blockForLine(B, 12)).toBe(3);
    });
    it("marks the next block after a blank line", () => {
        expect(blockForLine(B, 8)).toBe(2);
    });
    it("marks the paragraph, not the image, on an image's line", () => {
        expect(blockForLine(B, 17)).toBe(8);
    });
    it("prefers the later of two blocks on the same lines (the child)", () => {
        expect(blockForLine(L, 5)).toBe(5);
        expect(blockForLine(L, 1)).toBe(1);
    });
    it("is -1 past the last block", () => {
        expect(blockForLine(B, 25)).toBe(-1);
    });
});

describe("hostIndex", () => {
    it("hangs a card after the innermost block holding its last line", () => {
        expect(hostIndex(B, { endLine: 9 })).toBe(2);
        expect(hostIndex(L, { endLine: 3 })).toBe(3);
        expect(hostIndex(L, { endLine: 5 })).toBe(5);
    });
    it("a table row gives way to its table", () => {
        expect(hostIndex(B, { endLine: 15 })).toBe(3);
        expect(hostIndex(B, { endLine: 13 })).toBe(3);
    });
    it("hangs an image comment after its image", () => {
        expect(hostIndex(B, { endLine: 17, image: "images/shot.png" })).toBe(9);
        expect(hostIndex(B, { endLine: 17 })).toBe(8);
    });
    it("falls back to the last block before a line between blocks", () => {
        expect(hostIndex(B, { endLine: 10 })).toBe(2);
        expect(hostIndex(B, { endLine: 1 })).toBe(-1);
    });
});

describe("coveredIndexes", () => {
    it("marks the innermost blocks a range covers whole", () => {
        expect(coveredIndexes(B, 13, 15)).toEqual([5, 6, 7]);
        expect(coveredIndexes(B, 6, 9)).toEqual([1, 2]);
        expect(coveredIndexes(B, 11, 15)).toEqual([4, 5, 6, 7]);
        expect(coveredIndexes(L, 1, 3)).toEqual([1, 2, 3]);
        expect(coveredIndexes(L, 5, 5)).toEqual([5]);
    });
    it("falls back to the block of the first line", () => {
        expect(coveredIndexes(B, 12, 12)).toEqual([3]);
    });
});

describe("paths and labels", () => {
    it("is relative under the root, absolute elsewhere, always with /", () => {
        expect(refPath("/repo/docs/a.md", "/repo")).toBe("docs/a.md");
        expect(refPath("/elsewhere/x.md", "/repo")).toBe("/elsewhere/x.md");
        expect(refPath("C:\\repo\\docs\\a.md", "C:\\repo")).toBe("docs/a.md");
        expect(refPath("C:\\repo\\docs\\a.md", null)).toBe("C:/repo/docs/a.md");
    });
    it("labels a card", () => {
        expect(commentRefLabel(RANGE)).toBe("docs/guide.md:13-15");
        expect(commentRefLabel(IMG)).toBe("docs/guide.md:17 · image shot.png");
    });
});

describe("the message", () => {
    it("orders by file first commented, then line", () => {
        expect(orderMdComments([OTHER, IMG, SEL, RANGE]).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
        expect([...cardNumbers([OTHER, IMG, SEL, RANGE])]).toEqual([
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 4],
        ]);
    });
    it("counts comments and files", () => {
        expect(countLine([SEL, RANGE, IMG, OTHER])).toBe("4 comments on 2 files");
        expect(countLine([SEL])).toBe("1 comment on 1 file");
    });
    it("formats several files", () => {
        expect(formatMdComments([OTHER, IMG, SEL, RANGE])).toBe(
            [
                "Comments on 2 files (4):",
                "",
                "1. docs/guide.md:9",
                "   > the one the link names",
                "   Name the link's target.",
                "",
                "2. docs/guide.md:13-15",
                "   > | Quick | one worker |",
                "   > | Goal | a lead |",
                "   > | Plan | the engine |",
                "   Add a column for cost.",
                "",
                "3. docs/guide.md:17 (image images/shot.png)",
                "   Retake this shot.",
                "",
                "4. docs/other.md:3",
                "   > only paragraph",
                "   Say more here.",
            ].join("\n")
        );
    });
    it("names the file in the header when there is one", () => {
        expect(formatMdComments([SEL])).toBe(
            [
                "Comments on docs/guide.md (1):",
                "",
                "1. docs/guide.md:9",
                "   > the one the link names",
                "   Name the link's target.",
            ].join("\n")
        );
    });
    it("keeps a note's blank lines blank", () => {
        const c = mk({ id: "n", seq: 1, startLine: 4, endLine: 4, note: "one\n\nthree" });
        expect(formatMdComments([c]).split("\n").slice(-3)).toEqual(["   one", "", "   three"]);
    });
    it("is empty without comments", () => {
        expect(formatMdComments([])).toBe("");
    });
});

describe("panelLink", () => {
    it("resolves a relative link against the file's directory", () => {
        expect(panelLink("/repo/docs/a.md", "other.md")).toEqual({
            abs: "/repo/docs/other.md",
            line: null,
            markdown: true,
        });
        expect(panelLink("/repo/docs/a.md", "../pkg/x.go#L12")).toEqual({
            abs: "/repo/pkg/x.go",
            line: 12,
            markdown: false,
        });
        expect(panelLink("C:\\repo\\docs\\a.md", "b.md")).toEqual({
            abs: "C:/repo/docs/b.md",
            line: null,
            markdown: true,
        });
    });
    it("leaves web links, anchors and root-relative links alone", () => {
        expect(panelLink("/repo/docs/a.md", "https://example.com")).toBeNull();
        expect(panelLink("/repo/docs/a.md", "#top")).toBeNull();
        expect(panelLink("/repo/docs/a.md", "/abs.md")).toBeNull();
    });
});
