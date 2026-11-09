import { describe, expect, it } from "vitest";
import { isTitle, sections, stubOf, titleKey } from "./sections-core";

describe("sections", () => {
    it("is the opening, then a section per heading and per bold label alone on its line", () => {
        const text = [
            "Landed the fix.",
            "",
            "## What landed",
            "- one",
            "",
            "**Found not fixed:**",
            "the flaky test",
        ].join("\n");
        expect(sections(text).map((s) => s.title)).toEqual([null, "## What landed", "**Found not fixed:**"]);
        expect(sections(text)[2]?.lines).toEqual(["the flaky test"]);
    });

    it("leaves the opening out when the reply starts on a title", () => {
        expect(sections("## One\ntext").map((s) => s.title)).toEqual(["## One"]);
    });

    it("never takes a line inside a fence for a title", () => {
        const text = ["Run it:", "```bash", "# build", "**x**", "```", "done"].join("\n");
        expect(sections(text)).toHaveLength(1);
    });

    it("does not take a list item or a bold lead with text after it for a title", () => {
        expect(isTitle("- **Lead:**")).toBe(false);
        expect(isTitle("**Lead:** and more")).toBe(false);
        expect(isTitle("**Lead**:")).toBe(true);
        expect(isTitle("### Lead")).toBe(true);
    });
});

describe("titleKey", () => {
    it("reads a heading and a bold label alike", () => {
        expect(titleKey("## Found not fixed")).toBe(titleKey("**Found not fixed:**"));
    });
});

describe("stubOf", () => {
    it("stands for a table by its rows, header and rule left out", () => {
        const lines = ["| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"];
        expect(stubOf({ title: "## T", lines })).toBe("(table · 2 rows)");
    });

    it("stands for code by the lines inside its fences", () => {
        const lines = ["```ts", "const a = 1;", "const b = 2;", "```"];
        expect(stubOf({ title: "## C", lines })).toBe("(code · 2 lines)");
    });

    it("is null for a section holding prose, and for a fence of commands, which stays whole", () => {
        expect(stubOf({ title: "## P", lines: ["text", "| a |"] })).toBeNull();
        expect(stubOf({ title: "## P", lines: ["```", "! task install", "```"] })).toBeNull();
    });
});
