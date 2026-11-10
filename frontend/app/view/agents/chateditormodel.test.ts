// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { locate, mentionText, plainOffset, segmentLength, segmentsOf, type Segment } from "./chateditormodel";

const text = (t: string): Segment => ({ kind: "text", text: t });
const pill = (path: string): Segment => ({ kind: "pill", path });
const join = (segments: Segment[]) => segments.map((s) => (s.kind === "text" ? s.text : mentionText(s.path))).join("");

describe("mentionText", () => {
    it("writes @path", () => {
        expect(mentionText("src/a.ts")).toBe("@src/a.ts");
        expect(mentionText("D:\\x\\y.pdf")).toBe("@D:\\x\\y.pdf");
    });
    it("quotes a path that holds whitespace", () => {
        expect(mentionText("C:/My Files/a b.md")).toBe('@"C:/My Files/a b.md"');
        expect(mentionText("a\tb/c")).toBe('@"a\tb/c"');
    });
});

describe("segmentsOf", () => {
    it("splits text, a pill and text", () => {
        expect(segmentsOf("see @src/a.ts now", 17)).toEqual([text("see "), pill("src/a.ts"), text(" now")]);
    });
    it("gives no segment for an empty text and one text run for a text with no mention", () => {
        expect(segmentsOf("")).toEqual([]);
        expect(segmentsOf("just words\nand a line")).toEqual([text("just words\nand a line")]);
    });
    it("starts and ends on a pill without empty text runs", () => {
        expect(segmentsOf("@a/b.ts and @c/d.ts")).toEqual([pill("a/b.ts"), text(" and "), pill("c/d.ts")]);
    });
    it("keeps a token the caret is still typing as text, and merges it into the run around it", () => {
        expect(segmentsOf("see @src/a.ts", 13)).toEqual([text("see @src/a.ts")]);
        expect(segmentsOf("see @src/a.ts", 8)).toEqual([text("see @src/a.ts")]);
        expect(segmentsOf("see @src/a.ts now", 8)).toEqual([text("see @src/a.ts now")]);
        expect(segmentsOf("see @src/a.ts ", 14)).toEqual([text("see "), pill("src/a.ts"), text(" ")]);
    });
    it("reads a quoted path with spaces as one pill", () => {
        expect(segmentsOf('open @"C:/My Files/a b.md" ok')).toEqual([
            text("open "),
            pill("C:/My Files/a b.md"),
            text(" ok"),
        ]);
    });
    it("leaves trailing punctuation to the text after the pill", () => {
        expect(segmentsOf("look at @src/a.ts, then")).toEqual([text("look at "), pill("src/a.ts"), text(", then")]);
    });
    it("keeps a quoted path with no space as text, so the text round-trips as typed", () => {
        expect(segmentsOf('open @"src/a.ts" now')).toEqual([text('open @"src/a.ts" now')]);
    });
    it("joins back to the text it was made from", () => {
        for (const t of [
            "",
            "plain",
            "@a/b.ts",
            "see @src/a.ts now",
            'two @"x y/z.md" and @D:\\p\\q.pdf, then',
            'quoted plain @"src/a.ts" and @src/b.ts',
            "ask @alice about @README.md\nand @lib/",
        ]) {
            expect(join(segmentsOf(t))).toBe(t);
        }
    });
});

describe("segmentLength", () => {
    it("is the text length, or the length of the mention the pill is written as", () => {
        expect(segmentLength(text("abc"))).toBe(3);
        expect(segmentLength(pill("src/a.ts"))).toBe(9);
        expect(segmentLength(pill("a b/c.ts"))).toBe(11);
    });
});

describe("plainOffset and locate", () => {
    const source = 'go @src/a.ts then @"x y/b.md" end';
    const segments = segmentsOf(source);

    it("reads the fixture as text, pill, text, pill, text", () => {
        expect(segments).toEqual([text("go "), pill("src/a.ts"), text(" then "), pill("x y/b.md"), text(" end")]);
    });
    it("maps a segment offset to a plain offset, a pill's 0 and 1 being before and after it", () => {
        expect(plainOffset(segments, 0, 0)).toBe(0);
        expect(plainOffset(segments, 0, 3)).toBe(3);
        expect(plainOffset(segments, 1, 0)).toBe(3);
        expect(plainOffset(segments, 1, 1)).toBe(12);
        expect(plainOffset(segments, 2, 6)).toBe(18);
        expect(plainOffset(segments, 3, 0)).toBe(18);
        expect(plainOffset(segments, 3, 1)).toBe(29);
        expect(plainOffset(segments, 4, 4)).toBe(source.length);
    });
    it("clamps an offset past the segment and an index past the list", () => {
        expect(plainOffset(segments, 0, 99)).toBe(3);
        expect(plainOffset(segments, 0, -2)).toBe(0);
        expect(plainOffset(segments, 1, 5)).toBe(12);
        expect(plainOffset(segments, 9, 0)).toBe(source.length);
        expect(plainOffset([], 0, 0)).toBe(0);
    });
    it("round-trips every offset, snapping one inside a pill's text to the pill's end", () => {
        const pillRanges = [
            [3, 12],
            [18, 29],
        ];
        for (let p = 0; p <= source.length; p++) {
            const at = locate(segments, p);
            const inside = pillRanges.find(([a, b]) => p > a && p < b);
            const expected = inside ? inside[1] : p;
            expect(plainOffset(segments, at.index, at.offset)).toBe(expected);
            if (inside) {
                expect(segments[at.index]).toEqual(segments[pillRanges.indexOf(inside) * 2 + 1]);
                expect(at.offset).toBe(1);
            }
        }
    });
    it("puts a boundary on the earlier segment, so the caret before a pill is the end of the text ahead of it", () => {
        expect(locate(segments, 3)).toEqual({ index: 0, offset: 3 });
        expect(locate(segments, 12)).toEqual({ index: 1, offset: 1 });
        expect(locate(segments, 18)).toEqual({ index: 2, offset: 6 });
    });
    it("puts offset 0 before a pill that starts the text, and the end of a pill that ends it after it", () => {
        const edge = segmentsOf("@a/b.ts and @c/d.ts");
        expect(locate(edge, 0)).toEqual({ index: 0, offset: 0 });
        expect(locate(edge, 19)).toEqual({ index: 2, offset: 1 });
    });
    it("clamps a plain offset outside the text and answers for an empty one", () => {
        expect(locate(segments, -4)).toEqual({ index: 0, offset: 0 });
        expect(locate(segments, 999)).toEqual({ index: 4, offset: 4 });
        expect(locate([], 0)).toEqual({ index: 0, offset: 0 });
        expect(locate([], 7)).toEqual({ index: 0, offset: 0 });
    });
});
