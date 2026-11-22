// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    expandPastes,
    foldsPaste,
    joinPastes,
    pasteBlock,
    pasteSize,
    splitPastes,
    unfoldPaste,
    withoutPaste,
    withPaste,
} from "./chatpastes";
import { splitTagged, unwrapWholePaste } from "./chattagblocks";

const lines = (n: number, word = "line") => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`).join("\n");
const LOG = [
    "=== RUN   TestMergeHoldsOnConflict",
    "    merge_test.go:212: git merge --no-ff lane-2: exit status 1",
    "        CONFLICT (content): Merge conflict in pkg/orchestrate/lanes.go",
    '    merge_test.go:214: want run state "held", got "failed"',
    "--- FAIL: TestMergeHoldsOnConflict (3.41s)",
    "FAIL\t./pkg/orchestrate\t48.112s",
].join("\n");

describe("foldsPaste", () => {
    it("folds ten lines or more, or a thousand characters", () => {
        expect(foldsPaste("", 0, lines(9))).toBe(false);
        expect(foldsPaste("", 0, lines(10))).toBe(true);
        expect(foldsPaste("", 0, "x".repeat(999))).toBe(false);
        expect(foldsPaste("", 0, "x".repeat(1000))).toBe(true);
    });
    it("does not count trailing blank lines", () => {
        expect(foldsPaste("", 0, lines(9) + "\n\n\n")).toBe(false);
    });
    it("leaves a paste inside a fence, or under one just opened, in the text", () => {
        expect(foldsPaste("```\n", 4, lines(20))).toBe(false);
        expect(foldsPaste("a\n```\nb\n```\nc", 12, lines(20))).toBe(true);
        expect(foldsPaste("a\n```\nb\n```\nc", 6, lines(20))).toBe(false);
    });
});

describe("splitPastes / joinPastes", () => {
    it("round-trips", () => {
        for (const [body, pastes] of [
            ["", ["a\nb"]],
            ["why does this fail", [LOG]],
            ["q\n", ["one", "two"]],
            ["no paste", []],
        ] as [string, string[]][]) {
            const t = joinPastes(body, pastes);
            expect(splitPastes(t)).toEqual({ body, pastes });
        }
    });
    it("drops marks that do not pair and keeps the text", () => {
        expect(splitPastes("a\n\nb")).toEqual({ body: "a\n\nb", pastes: [] });
        expect(splitPastes("ab")).toEqual({ body: "ab", pastes: [] });
    });
});

describe("expandPastes", () => {
    it("writes a log fenced after the typed text", () => {
        const draft = joinPastes("why does this fail", [LOG]);
        expect(expandPastes(draft)).toBe("why does this fail\n\n```\n" + LOG + "\n```");
    });
    it("writes prose as it is, and a paste alone with nothing before it", () => {
        const prose = lines(12, "Một câu văn thường");
        expect(expandPastes(joinPastes("", [prose])).trim()).toBe(prose);
    });
    it("keeps several pastes in order, apart", () => {
        expect(expandPastes(joinPastes("q", ["a b", "c d"]))).toBe("q\n\na b\n\nc d");
    });
    it("leaves a draft with no paste as it is", () => {
        expect(expandPastes("just text\n")).toBe("just text\n");
    });
    it("tagged, puts each paste in a <pasted_content> block, unfenced, that the bubble folds as a card", () => {
        const sent = expandPastes(joinPastes("why does this fail", [LOG, "\n\nsecond  \n"]), true);
        expect(sent).toBe(
            'why does this fail\n\n<pasted_content from="chat">\n' +
                LOG +
                '\n</pasted_content>\n\n<pasted_content from="chat">\nsecond\n</pasted_content>'
        );
        const parts = splitTagged(sent);
        expect(parts.map((p) => p.kind)).toEqual(["text", "tag", "tag"]);
        expect(parts[1]).toMatchObject({ tag: "pasted_content", body: LOG });
    });
    it("tagged, keeps a message that is only a paste a paste (not unwrapped as a whole message)", () => {
        const sent = expandPastes(joinPastes("", [lines(12)]), true).trim();
        expect(unwrapWholePaste(sent)).toBe(sent);
        expect(splitTagged(sent)).toEqual([
            { kind: "tag", tag: "pasted_content", attrs: { from: "chat" }, body: lines(12) },
        ]);
    });
});

describe("pasteBlock", () => {
    it("fences past a backtick run inside the code", () => {
        const code = "const a = 1;\nconst s = `x`;\n// ```\nfunction f() {}";
        expect(pasteBlock(code).startsWith("````\n")).toBe(true);
    });
});

describe("withPaste / withoutPaste / unfoldPaste", () => {
    const quoted = "> earlier\n\nquestion";
    it("adds a paste after the text and keeps the quotes", () => {
        const full = withPaste(quoted, "a\r\nb");
        expect(full.startsWith("> earlier\n\nquestion")).toBe(true);
        expect(splitPastes(full.slice("> earlier\n\n".length)).pastes).toEqual(["a\nb"]);
    });
    it("strips the marks out of the pasted text itself", () => {
        const full = withPaste("", "ab");
        expect(splitPastes(full).pastes).toEqual(["ab"]);
    });
    it("removes one paste", () => {
        const full = withPaste(withPaste(quoted, "one"), "two");
        expect(withoutPaste(full, 0)).toBe(withPaste(quoted, "two"));
    });
    it("puts a paste back in the text, fenced as a paste into the box would be", () => {
        const full = withPaste(quoted, LOG);
        expect(unfoldPaste(full, 0)).toBe("> earlier\n\nquestion\n```\n" + LOG + "\n```");
    });
});

describe("pasteSize", () => {
    it("counts lines, or characters on one line", () => {
        expect(pasteSize(lines(1200))).toBe("1,200 lines");
        expect(pasteSize("x".repeat(1500))).toBe("1,500 characters");
    });
});
