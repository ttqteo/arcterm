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
});

describe("ranFirst", () => {
    it("moves a command just run to the front, once", () => {
        expect(ranFirst(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
        expect(ranFirst(["a"], "z")).toEqual(["z", "a"]);
    });
});
