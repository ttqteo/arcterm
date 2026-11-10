// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { hashText, marksByHash, parseSkimOn, sameMarks, skimStoreFiles, withMarks } from "./chatskim";

describe("hashText", () => {
    it("matches the skim mod's hash", () => {
        // computed with claude/skim-mod/hooks/highlight-core.ts hashText on 2026-11-10
        expect(hashText("")).toBe("811c9dc50");
        expect(hashText("hello")).toBe("4f9f2cab5");
        expect(hashText("Skim ở chế độ chat: không mất.")).toBe("a9b9f3a81e");
    });
});

describe("marksByHash", () => {
    it("merges the files' entries, a later file winning a shared hash", () => {
        const a = JSON.stringify({
            highlightMarks: [
                ["h1", ["one"]],
                ["h2", ["two"]],
            ],
        });
        const b = JSON.stringify({ highlightMarks: [["h2", ["TWO"]]] });
        const m = marksByHash([a, b]);
        expect(m.get("h1")).toEqual(["one"]);
        expect(m.get("h2")).toEqual(["TWO"]);
    });
    it("skips a file that is not JSON or not the shape", () => {
        expect(
            marksByHash(["{", JSON.stringify({ other: 1 }), JSON.stringify({ highlightMarks: [[1, "x"]] })]).size
        ).toBe(0);
    });
});

describe("withMarks", () => {
    it("wraps each marked sentence in ==…==", () => {
        expect(withMarks("First. Second one. Third.", ["Second one."])).toBe("First. ==Second one.== Third.");
    });
    it("leaves a sentence it cannot find, and an empty list, as is", () => {
        expect(withMarks("Text.", ["Missing."])).toBe("Text.");
        expect(withMarks("Text.", [])).toBe("Text.");
    });
    it("never marks inside a code fence or inline code", () => {
        const text = "```\nSame.\n```\nSame.";
        expect(withMarks(text, ["Same."])).toBe("```\nSame.\n```\n==Same.==");
        expect(withMarks("`Same.` Same.", ["Same."])).toBe("`Same.` ==Same.==");
    });
    it("marks a sentence in a list item, keeping its bullet", () => {
        expect(withMarks("- Do this now.\n- Later.", ["Do this now."])).toBe("- ==Do this now.==\n- Later.");
    });
});

describe("sameMarks", () => {
    it("is true for the same hashes with the same sentence lists, whatever the order", () => {
        const a = new Map([
            ["h1", ["one"]],
            ["h2", ["two", "too"]],
        ]);
        const b = new Map([
            ["h2", ["two", "too"]],
            ["h1", ["one"]],
        ]);
        expect(sameMarks(a, b)).toBe(true);
        expect(sameMarks(new Map(), new Map())).toBe(true);
    });
    it("is false when a hash, a sentence or a count differs", () => {
        const a = new Map([["h1", ["one"]]]);
        expect(sameMarks(a, new Map([["h2", ["one"]]]))).toBe(false);
        expect(sameMarks(a, new Map([["h1", ["ONE"]]]))).toBe(false);
        expect(sameMarks(a, new Map([["h1", ["one", "two"]]]))).toBe(false);
        expect(
            sameMarks(
                a,
                new Map([
                    ["h1", ["one"]],
                    ["h2", []],
                ])
            )
        ).toBe(false);
    });
});

describe("skimStoreFiles", () => {
    it("keeps the skim_*.json files of 2 MB or less, by name", () => {
        const MB = 1024 * 1024;
        expect(
            skimStoreFiles([
                { name: "skim_inline-2e2b7f082d52.json", size: 160_000 },
                { name: "skim_other.json", size: 2 * MB },
                { name: "skim_huge.json", size: 2 * MB + 1 },
                { name: "skim_notes.txt", size: 10 },
                { name: "arc_x.json", size: 10 },
                { name: "skim_dir.json", size: 10, isdir: true },
            ])
        ).toEqual(["skim_inline-2e2b7f082d52.json", "skim_other.json"]);
    });
});

describe("parseSkimOn", () => {
    it("is on unless the stored value is false", () => {
        expect(parseSkimOn(null)).toBe(true);
        expect(parseSkimOn("true")).toBe(true);
        expect(parseSkimOn("false")).toBe(false);
        expect(parseSkimOn("garbage")).toBe(true);
    });
});
