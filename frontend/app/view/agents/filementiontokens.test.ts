// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { mentionBaseName, mentionTokens } from "./filementiontokens";

const paths = (text: string, caret?: number) => mentionTokens(text, caret).map((t) => t.path);

describe("mentionTokens", () => {
    it("finds an @path at the start, after a space and after a bracket, with its span", () => {
        const text = "@src/app.ts and (@D:\\x\\y.pdf) then @README.md";
        expect(mentionTokens(text)).toEqual([
            { start: 0, end: 11, path: "src/app.ts" },
            { start: 17, end: 28, path: "D:\\x\\y.pdf" },
            { start: 35, end: 45, path: "README.md" },
        ]);
    });
    it("reads a quoted path with spaces", () => {
        expect(mentionTokens('see @"C:/My Files/a b.md" now')).toEqual([{ start: 4, end: 25, path: "C:/My Files/a b.md" }]);
    });
    it("drops trailing punctuation from the path", () => {
        expect(paths("look at @src/app.ts, then @a/b.")).toEqual(["src/app.ts", "a/b"]);
    });
    it("skips what is not a path: a handle, an email, a lone @", () => {
        expect(paths("ask @alice, mail me@site.com, or type @ alone")).toEqual([]);
    });
    it("skips the token the caret is still typing, and keeps one the caret has left", () => {
        expect(paths("open @src/ap", 12)).toEqual([]);
        expect(paths("open @src/app.ts ", 17)).toEqual(["src/app.ts"]);
        expect(paths("open @src/app.ts now", 3)).toEqual(["src/app.ts"]);
    });
});

describe("mentionBaseName", () => {
    it("is the last segment of either separator, a folder's trailing one ignored", () => {
        expect(mentionBaseName("docs/notes/related.tex")).toBe("related.tex");
        expect(mentionBaseName("D:\\a\\b\\x.pdf")).toBe("x.pdf");
        expect(mentionBaseName("src/views/")).toBe("views");
        expect(mentionBaseName("README.md")).toBe("README.md");
    });
});
