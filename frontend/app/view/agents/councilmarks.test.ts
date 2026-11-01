import { describe, expect, it } from "vitest";
import { markSpans, stripMarks } from "./councilmarks";

describe("markSpans", () => {
    it("splits a text into its plain runs and its marked sentences, the == dropped", () => {
        expect(markSpans("Cheap to try. ==Report precision with intervals.== Then widen it.")).toEqual([
            { text: "Cheap to try. ", mark: false },
            { text: "Report precision with intervals.", mark: true },
            { text: " Then widen it.", mark: false },
        ]);
    });

    it("keeps two marks apart, and a mark at either end", () => {
        expect(markSpans("==First.== middle ==Last.==")).toEqual([
            { text: "First.", mark: true },
            { text: " middle ", mark: false },
            { text: "Last.", mark: true },
        ]);
    });

    it("is one plain run with no mark, or an empty text", () => {
        expect(markSpans("No mark here.")).toEqual([{ text: "No mark here.", mark: false }]);
        expect(markSpans("")).toEqual([{ text: "", mark: false }]);
    });

    it("draws no mark for == with a space inside it, an unclosed one, or one across a paragraph", () => {
        expect(markSpans("if a == b and b == c")).toEqual([{ text: "if a == b and b == c", mark: false }]);
        expect(markSpans("==never closed")).toEqual([{ text: "==never closed", mark: false }]);
        expect(markSpans("==one\n\ntwo==")).toEqual([{ text: "==one\n\ntwo==", mark: false }]);
    });

    it("marks across a single line break, and a one-letter mark", () => {
        expect(markSpans("==one\ntwo==")).toEqual([{ text: "one\ntwo", mark: true }]);
        expect(markSpans("==a==")).toEqual([{ text: "a", mark: true }]);
    });
});

describe("stripMarks", () => {
    it("drops the marks and keeps their sentences", () => {
        expect(stripMarks("==Do this first.== Then the rest.")).toBe("Do this first. Then the rest.");
        expect(stripMarks("a == b")).toBe("a == b");
    });
});
