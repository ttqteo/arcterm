import { describe, expect, it } from "vitest";
import { BLOCK_SEP, findMatches, firstInView, joinParts, matchCount, MAX_MATCHES, partAt, stepMatch } from "./docfind";

const texts = (text: string, query: string) => findMatches(text, query).map((m) => text.slice(m.start, m.end));

describe("find in a document", () => {
    it("finds every match, ignoring case", () => {
        expect(findMatches("Office office OFFICE", "office")).toEqual([
            { start: 0, end: 6 },
            { start: 7, end: 13 },
            { start: 14, end: 20 },
        ]);
    });

    it("finds nothing for an empty or blank query", () => {
        expect(findMatches("a b c", "")).toEqual([]);
        expect(findMatches("a b c", "   ")).toEqual([]);
    });

    it("takes the query's characters literally", () => {
        expect(texts("a.b axb (c) [d]", "a.b")).toEqual(["a.b"]);
        expect(texts("a.b axb (c) [d]", "(c)")).toEqual(["(c)"]);
        expect(texts("a.b axb (c) [d]", "[d]")).toEqual(["[d]"]);
    });

    it("matches a space in the query to a line break inside a paragraph", () => {
        expect(texts("the card\ngrid stays", "card grid")).toEqual(["card\ngrid"]);
    });

    it("never matches across two blocks", () => {
        const text = `the card${BLOCK_SEP}grid stays`;
        expect(findMatches(text, "card grid")).toEqual([]);
        expect(findMatches(text, "cardgrid")).toEqual([]);
    });

    it("stops at the cap", () => {
        expect(findMatches("a".repeat(MAX_MATCHES + 50), "a")).toHaveLength(MAX_MATCHES);
    });
});

describe("the document's text", () => {
    it("joins the parts of one block as they are and puts a separator between blocks", () => {
        const joined = joinParts([
            { text: "Office ", block: "p1" },
            { text: "replaces", block: "p1" },
            { text: "The plan", block: "h2" },
        ]);
        expect(joined.text).toBe(`Office replaces${BLOCK_SEP}The plan`);
        expect(joined.starts).toEqual([0, 7, 16]);
    });

    it("finds the part an offset falls in", () => {
        const starts = [0, 7, 16];
        expect(partAt(starts, 0)).toBe(0);
        expect(partAt(starts, 6)).toBe(0);
        expect(partAt(starts, 7)).toBe(1);
        expect(partAt(starts, 15)).toBe(1);
        expect(partAt(starts, 20)).toBe(2);
    });
});

describe("the current match", () => {
    it("steps round the ends", () => {
        expect(stepMatch(0, 3, 1)).toBe(1);
        expect(stepMatch(2, 3, 1)).toBe(0);
        expect(stepMatch(0, 3, -1)).toBe(2);
        expect(stepMatch(0, 0, 1)).toBe(-1);
    });

    it("starts at the first match at or below the top of the view", () => {
        expect(firstInView([10, 300, 900], 250)).toBe(1);
        expect(firstInView([10, 300, 900], 300)).toBe(1);
        expect(firstInView([10, 300, 900], 0)).toBe(0);
    });

    it("starts at the first match when every match is above the view", () => {
        expect(firstInView([10, 30], 500)).toBe(0);
        expect(firstInView([], 500)).toBe(-1);
    });

    it("counts the matches", () => {
        expect(matchCount(2, 12)).toBe("3/12");
        expect(matchCount(-1, 0)).toBe("No results");
        expect(matchCount(0, MAX_MATCHES)).toBe(`1/${MAX_MATCHES}+`);
    });
});
