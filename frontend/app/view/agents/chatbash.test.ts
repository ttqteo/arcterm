// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { applyCompletion, bashGhost, bashWordAt, ranFirst } from "./chatbash";

describe("bashGhost", () => {
    const history = ["git log --oneline -5", "git status -sb", "ls releases"];
    it("is the rest of the newest command that starts with what was typed", () => {
        expect(bashGhost(history, "!git l", 6)).toBe("og --oneline -5");
        expect(bashGhost(history, "!git s", 6)).toBe("tatus -sb");
    });
    it("is nothing under 2 characters, for an exact match, off the end of the text, or out of bash mode", () => {
        expect(bashGhost(history, "!g", 2)).toBe("");
        expect(bashGhost(history, "!ls releases", 12)).toBe("");
        expect(bashGhost(history, "!git l", 3)).toBe("");
        expect(bashGhost(history, "git l", 5)).toBe("");
        expect(bashGhost(history, "!zz", 3)).toBe("");
    });
});

describe("bashWordAt", () => {
    it("reads the first word as a command", () => {
        expect(bashWordAt("!gi", 3)).toEqual({ start: 1, end: 3, kind: "command", word: "gi" });
    });
    it("reads a later word as a file, and a path-like first word too", () => {
        expect(bashWordAt("!npx vitest run src/ch", 22)).toEqual({ start: 16, end: 22, kind: "file", word: "src/ch" });
        expect(bashWordAt("!./scr", 6)).toEqual({ start: 1, end: 6, kind: "file", word: "./scr" });
    });
    it("reads a $word as a variable, without its $", () => {
        expect(bashWordAt("!echo $PA", 9)).toEqual({ start: 7, end: 9, kind: "variable", word: "PA" });
    });
    it("is null out of bash mode", () => {
        expect(bashWordAt("git", 3)).toBeNull();
    });
    it("keeps a backslash-escaped space inside the word, returns the word unescaped and spans the escaped text", () => {
        const text = "!cat my\\ fi";
        expect(bashWordAt(text, text.length)).toEqual({ start: 5, end: text.length, kind: "file", word: "my fi" });
        // the span covers `my\ fi` in the box, so a pick replaces all of it
        expect(text.slice(5, text.length)).toBe("my\\ fi");
        expect(bashWordAt("!cat a\\ b\\ c", 12)).toEqual({ start: 5, end: 12, kind: "file", word: "a b c" });
    });
    it("splits at a space that a backslash does not escape: an escaped backslash leaves the space a separator", () => {
        // `a\\ b` is a, a backslash, then a space, then b: the word under the caret is `b`
        const text = "!cat a\\\\ b";
        expect(bashWordAt(text, text.length)).toEqual({
            start: text.length - 1,
            end: text.length,
            kind: "file",
            word: "b",
        });
    });
    it("reads an escaped first word as a file when it holds a slash, and a $word as a variable", () => {
        expect(bashWordAt("!my\\ dir/x", 10)).toEqual({ start: 1, end: 10, kind: "file", word: "my dir/x" });
        expect(bashWordAt("!echo $PA", 9)).toEqual({ start: 7, end: 9, kind: "variable", word: "PA" });
    });
});

describe("applyCompletion", () => {
    it("puts the pick in place of the word, a space after a file but not after a folder", () => {
        expect(
            applyCompletion("!cat src/ch", { start: 5, end: 11, kind: "file", word: "src/ch" }, "src/chat.ts")
        ).toEqual({
            text: "!cat src/chat.ts ",
            caret: 17,
        });
        expect(applyCompletion("!cd fr", { start: 4, end: 6, kind: "file", word: "fr" }, "frontend/")).toEqual({
            text: "!cd frontend/",
            caret: 13,
        });
    });
    it("keeps the $ of a variable and the text after the caret", () => {
        expect(applyCompletion("!echo $PA x", { start: 7, end: 9, kind: "variable", word: "PA" }, "PATH")).toEqual({
            text: "!echo $PATH  x",
            caret: 12,
        });
    });
    it("backslash-escapes the spaces of a file pick and puts a space after it", () => {
        expect(applyCompletion("!cat my", { start: 5, end: 7, kind: "file", word: "my" }, "my file.txt")).toEqual({
            text: "!cat my\\ file.txt ",
            caret: 18,
        });
    });
    it("escapes a folder's name but leaves its trailing / bare, with no space after it", () => {
        expect(applyCompletion("!cd a", { start: 4, end: 5, kind: "file", word: "a" }, "a b/")).toEqual({
            text: "!cd a\\ b/",
            caret: 9,
        });
    });
    it("escapes the shell metacharacters of a file pick: $ & ; ' ( and the rest of the list", () => {
        const escaped = (pick: string) =>
            applyCompletion("!x f", { start: 3, end: 4, kind: "file", word: "f" }, pick).text.slice(3, -1);
        expect(escaped("a$b")).toBe("a\\$b");
        expect(escaped("a&b")).toBe("a\\&b");
        expect(escaped("a;b")).toBe("a\\;b");
        expect(escaped("a'b")).toBe("a\\'b");
        expect(escaped("a(b)")).toBe("a\\(b\\)");
        expect(escaped('a"b`c\\d')).toBe('a\\"b\\`c\\\\d');
        expect(escaped("a!b|c<d>e")).toBe("a\\!b\\|c\\<d\\>e");
        expect(escaped("a[b]{c}*?#=")).toBe("a\\[b\\]\\{c\\}\\*\\?\\#\\=");
        expect(escaped("a\tb")).toBe("a\\\tb");
        // a character that is none of these stays as it is
        expect(escaped("a-b_c.d,e%f@g")).toBe("a-b_c.d,e%f@g");
    });
    it("leaves a command or a variable pick as it is", () => {
        expect(applyCompletion("!x", { start: 1, end: 2, kind: "command", word: "x" }, "a=b$c")).toEqual({
            text: "!a=b$c ",
            caret: 7,
        });
        expect(applyCompletion("!echo $A", { start: 7, end: 8, kind: "variable", word: "A" }, "A&B")).toEqual({
            text: "!echo $A&B ",
            caret: 11,
        });
    });
    it("keeps a leading ~ bare when the word typed started with one (the shell expands it), escapes it otherwise", () => {
        expect(applyCompletion("!cd ~/sr", { start: 4, end: 8, kind: "file", word: "~/sr" }, "~/src/")).toEqual({
            text: "!cd ~/src/",
            caret: 10,
        });
        expect(applyCompletion("!cd ~/a", { start: 4, end: 7, kind: "file", word: "~/a" }, "~/a b.txt").text).toBe(
            "!cd ~/a\\ b.txt "
        );
        // a file named ~$x.docx, picked from a word that did not start with ~, is escaped whole
        expect(applyCompletion("!rm ", { start: 4, end: 4, kind: "file", word: "" }, "~$x.docx").text).toBe(
            "!rm \\~\\$x.docx "
        );
    });
});

describe("ranFirst", () => {
    it("moves a command just run to the front, once", () => {
        expect(ranFirst(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
        expect(ranFirst(["a"], "z")).toEqual(["z", "a"]);
    });
});
