// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    bangSkip,
    fromShown,
    isAtom,
    locate,
    mentionText,
    plainOffset,
    segmentLength,
    segmentsOf,
    shownText,
    type Segment,
} from "./chateditormodel";

const text = (t: string): Segment => ({ kind: "text", text: t });
const pill = (path: string): Segment => ({ kind: "pill", path });
const join = (segments: Segment[]) =>
    segments.map((s) => (s.kind === "text" ? s.text : s.kind === "ref" ? s.raw : mentionText(s.path))).join("");

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
    it("is one plain text run, whatever mentions it holds, with `pills: false` (bash mode draws none)", () => {
        expect(segmentsOf("ls @src/a.ts now", 3, { pills: false })).toEqual([text("ls @src/a.ts now")]);
        expect(segmentsOf("ls @src/a.ts now", undefined, { pills: false })).toEqual([text("ls @src/a.ts now")]);
        expect(segmentsOf('ls @"x y/z.md"\n@a/b.ts', 0, { pills: false })).toEqual([text('ls @"x y/z.md"\n@a/b.ts')]);
        expect(segmentsOf("", 0, { pills: false })).toEqual([]);
        // pills on, or the option left out, is today's split
        expect(segmentsOf("ls @src/a.ts now", 3, { pills: true })).toEqual(segmentsOf("ls @src/a.ts now", 3));
        expect(segmentsOf("ls @src/a.ts now", 3, {})).toEqual([text("ls "), pill("src/a.ts"), text(" now")]);
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
            "có gồm agent:7cd99627 không?",
            "hỏi @agent:7cd99627, rồi run:071a8e3b\nvà (council:0c28ab12) @src/a.ts",
        ]) {
            expect(join(segmentsOf(t))).toBe(t);
        }
    });
});

describe("segmentsOf and references", () => {
    it("makes a ref segment for a finished reference, keeping it as written", () => {
        expect(segmentsOf("có gồm agent:7cd99627 không?")).toEqual([
            text("có gồm "),
            { kind: "ref", ref: "agent", id: "7cd99627", raw: "agent:7cd99627" },
            text(" không?"),
        ]);
    });
    it("reads tab: as an agent, lowercases the id and keeps the `@` and the case in raw", () => {
        expect(segmentsOf("@Tab:7CD99627 ok")).toEqual([
            { kind: "ref", ref: "agent", id: "7cd99627", raw: "@Tab:7CD99627" },
            text(" ok"),
        ]);
    });
    it("keeps a reference still being typed as text", () => {
        expect(segmentsOf("agent:7cd99627", 14)).toEqual([text("agent:7cd99627")]);
        expect(segmentsOf("agent:7cd99627 x", 5)).toEqual([text("agent:7cd99627 x")]);
        expect(segmentsOf("agent:7cd99627 ", 15)).toEqual([
            { kind: "ref", ref: "agent", id: "7cd99627", raw: "agent:7cd99627" },
            text(" "),
        ]);
    });
    it("makes no ref segment with pills off", () => {
        expect(segmentsOf("agent:7cd99627 x", undefined, { pills: false })).toEqual([text("agent:7cd99627 x")]);
    });
    it("puts files and references side by side in the order they stand", () => {
        expect(segmentsOf("a @src/a.ts run:071a8e3b @b/c.ts council:0c28ab12")).toEqual([
            text("a "),
            pill("src/a.ts"),
            text(" "),
            { kind: "ref", ref: "run", id: "071a8e3b", raw: "run:071a8e3b" },
            text(" "),
            pill("b/c.ts"),
            text(" "),
            { kind: "ref", ref: "council", id: "0c28ab12", raw: "council:0c28ab12" },
        ]);
    });
    it("leaves a reference inside a file mention to the file", () => {
        expect(segmentsOf('see @"x agent:7cd99627 y.md" now')).toEqual([
            text("see "),
            pill("x agent:7cd99627 y.md"),
            text(" now"),
        ]);
    });
    it("makes nothing of a word that only looks like one", () => {
        expect(segmentsOf("agent:7cd and xagent:7cd99627 and session:7cd99627")).toEqual([
            text("agent:7cd and xagent:7cd99627 and session:7cd99627"),
        ]);
    });
});

describe("segmentLength", () => {
    it("is the text length, or the length of the mention the pill is written as", () => {
        expect(segmentLength(text("abc"))).toBe(3);
        expect(segmentLength(pill("src/a.ts"))).toBe(9);
        expect(segmentLength(pill("a b/c.ts"))).toBe(11);
    });
    it("is the raw text of a ref segment", () => {
        expect(segmentLength({ kind: "ref", ref: "agent", id: "7cd99627", raw: "agent:7cd99627" })).toBe(14);
        expect(segmentLength({ kind: "ref", ref: "run", id: "071a8e3b", raw: "@run:071a8e3b" })).toBe(13);
    });
});

describe("isAtom", () => {
    it("is true for what the caret steps over whole: a pill and a ref, not text", () => {
        expect(isAtom(pill("a/b.ts"))).toBe(true);
        expect(isAtom({ kind: "ref", ref: "agent", id: "7cd99627", raw: "agent:7cd99627" })).toBe(true);
        expect(isAtom(text("a"))).toBe(false);
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

    describe("with a reference", () => {
        const refText = "a @run:071a8e3b b";
        const refs = segmentsOf(refText);
        const refEnd = 2 + "@run:071a8e3b".length;

        it("counts a ref segment as its raw text", () => {
            expect(refs).toHaveLength(3);
            expect(segmentLength(refs[1])).toBe("@run:071a8e3b".length);
            expect(plainOffset(refs, 1, 0)).toBe(2);
            expect(plainOffset(refs, 1, 1)).toBe(refEnd);
            expect(plainOffset(refs, 2, 2)).toBe(refText.length);
            expect(locate(refs, 5)).toEqual({ index: 1, offset: 1 });
        });
        it("puts a boundary on the earlier segment, a ref being stepped over whole like a pill", () => {
            expect(locate(refs, 2)).toEqual({ index: 0, offset: 2 });
            expect(locate(refs, refEnd)).toEqual({ index: 1, offset: 1 });
            expect(locate(segmentsOf("run:071a8e3b"), 0)).toEqual({ index: 0, offset: 0 });
            expect(locate(segmentsOf("x run:071a8e3b"), 99)).toEqual({ index: 1, offset: 1 });
        });
        it("round-trips every offset, snapping one inside the reference to its end", () => {
            for (let p = 0; p <= refText.length; p++) {
                const at = locate(refs, p);
                expect(plainOffset(refs, at.index, at.offset)).toBe(p > 2 && p < refEnd ? refEnd : p);
            }
        });
    });
});

describe("bash's `!` beside the editor", () => {
    it("skips the leading `!` of a bash command only", () => {
        expect(bangSkip("!git status", true)).toBe(1);
        expect(bangSkip("!", true)).toBe(1);
        expect(bangSkip("git status", true)).toBe(0);
        expect(bangSkip("!git status", false)).toBe(0);
        expect(bangSkip("", true)).toBe(0);
    });

    it("the editor shows the text past the skipped `!`", () => {
        expect(shownText("!git status", 1)).toBe("git status");
        expect(shownText("!", 1)).toBe("");
        expect(shownText("!!x", 1)).toBe("!x");
        expect(shownText("hello", 0)).toBe("hello");
    });

    it("what the editor says goes back out with the `!` and the caret one further", () => {
        expect(fromShown("git status", 3, 1)).toEqual({ text: "!git status", caret: 4 });
        expect(fromShown("", 0, 1)).toEqual({ text: "!", caret: 1 });
        expect(fromShown("hello", 2, 0)).toEqual({ text: "hello", caret: 2 });
    });

    it("an outside caret maps into the shown text, never before its start", () => {
        expect(fromShown(shownText("!ls", 1), 2 - 1, 1)).toEqual({ text: "!ls", caret: 2 });
    });
});
