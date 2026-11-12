// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    chatFold,
    hashText,
    marksByHash,
    parseFoldOn,
    parseSkimOn,
    sameMarks,
    skimStoreFiles,
    withMarks,
} from "./chatskim";

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

describe("parseFoldOn", () => {
    it("is off unless the stored value is true", () => {
        expect(parseFoldOn(null)).toBe(false);
        expect(parseFoldOn("false")).toBe(false);
        expect(parseFoldOn("junk")).toBe(false);
        expect(parseFoldOn("true")).toBe(true);
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

describe("chatFold", () => {
    const long = [
        "The verdict comes first. It says what happened.",
        "",
        "- **One.** The first reason. More of it.",
        "- **Two.** The second reason.",
        "",
        ...Array.from({ length: 12 }, (_, i) => `Detail line ${i}.`),
    ].join("\n");

    it("draws a short reply in full", () => {
        expect(chatFold("Short.\n\nStill short.", [], true)).toBeNull();
    });

    it("draws everything in full while skim is off", () => {
        expect(chatFold(long, [], false)).toBeNull();
    });

    it("folds a long unmarked reply to its verdict and reasons", () => {
        const f = chatFold(long, [], true);
        expect(f?.lines).toBe(17);
        expect(f?.short).toContain("The verdict comes first.");
        expect(f?.short).toContain("**One.**");
        expect(f?.short).not.toContain("Detail line 5.");
    });

    it("folds a marked reply to its marks, drawn highlighted", () => {
        const f = chatFold(long, ["Detail line 5."], true);
        expect(f?.short).toContain("==Detail line 5.==");
        expect(f?.short).not.toContain("Detail line 6.");
    });

    it("draws in full a reply that ends on a question, or whose last mark asks one", () => {
        expect(chatFold(`${long}\nWhich one do you want?`, [], true)).toBeNull();
        expect(chatFold(long, ["Which one do you want?"], true)).toBeNull();
    });

    // a fold keeps prose only: the visuals an agent drew, the point of its reply, would be behind Show more
    it("draws in full a reply that holds an arc-visual block", () => {
        expect(chatFold(`${long}\n\n\`\`\`arc-visual\n~/.arc/visuals/chart.html\n\`\`\``, [], true)).toBeNull();
        expect(chatFold(`${long}\n\n\`\`\`ts\nconst a = 1;\n\`\`\``, [], true)).not.toBeNull();
    });

    // a waiting initiative card must be in view, not behind Show more
    it("draws in full a reply that holds an arc-initiative block", () => {
        const block = '```arc-initiative\n{"kind":"note","text":"a note"}\n```';
        expect(chatFold(`${long}\n\n${block}`, [], true)).toBeNull();
        expect(chatFold(`${block}\n\n${long}`, [], true)).toBeNull();
        // only a fence at the start of a line counts, and only that language
        expect(chatFold(`${long}\n\n\`\`\`arc-initiative-two\n{}\n\`\`\``, [], true)).not.toBeNull();
    });
});
