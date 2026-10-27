// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    findPathCandidates,
    findSpanningPaths,
    inlinePathOf,
    isBareName,
    matchKnownPath,
    nearbyFolders,
    resolvePath,
} from "./pathlinks";

describe("nearbyFolders", () => {
    it("finds the folder a line above names for a bare file name, as an agent's report puts it", () => {
        const rows = [
            "● I've made v1.4 for the sales team. It's in docs/slide/ as",
            "  Early_Warning_Services_v1.4_271026_Sales.pptx and .pdf, 22 slides. There's no BigLabs logo",
        ];
        expect(nearbyFolders(rows, 1)).toEqual(["docs/slide"]);
    });

    it("takes the folder of a file path, the nearest row first, each once and at most max", () => {
        const rows = ["see a/b and c/d.ts", "here x/y.go and a/b", "then e/f"];
        expect(nearbyFolders(rows, 1)).toEqual(["x", "a/b", "c", "e/f"]);
        expect(nearbyFolders(rows, 1, 2)).toEqual(["x", "a/b"]);
    });

    it("has nothing when no row names a folder", () => {
        expect(nearbyFolders(["just deck.pptx here", ""], 0)).toEqual([]);
    });
});

describe("isBareName", () => {
    it("is a name with no folder, not one from home", () => {
        expect(isBareName("Deck_v1.4.pptx")).toBe(true);
        expect(isBareName("docs/Deck.pptx")).toBe(false);
        expect(isBareName("~")).toBe(false);
    });
});

const paths = (line: string) => findPathCandidates(line).map((c) => [c.path, c.line, c.col]);

describe("findPathCandidates", () => {
    it("reads tsc's file(line,col)", () => {
        expect(paths("src/app.ts(12,5): error TS2304: Cannot find name 'x'.")).toEqual([["src/app.ts", 12, 5]]);
    });

    it("reads go test and go vet's file:line and file:line:col", () => {
        expect(paths("    foo_test.go:12: expected 1, got 2")).toEqual([["foo_test.go", 12, undefined]]);
        expect(paths("pkg/x/y.go:12:5: undefined: z")).toEqual([["pkg/x/y.go", 12, 5]]);
    });

    it("reads vitest's file lines without taking its counts for a line number", () => {
        expect(paths(" ✓ frontend/util/fontutil.test.ts (12 tests) 41ms")).toEqual([
            ["frontend/util/fontutil.test.ts", undefined, undefined],
        ]);
        expect(paths(" ❯ frontend/x.test.ts:12:5")).toEqual([["frontend/x.test.ts", 12, 5]]);
    });

    it("reads eslint's absolute Windows path line", () => {
        expect(paths("D:\\projects\\arcterm\\frontend\\x.tsx")).toEqual([
            ["D:\\projects\\arcterm\\frontend\\x.tsx", undefined, undefined],
        ]);
        expect(paths("  12:5  error  'x' is defined but never used")).toEqual([]);
    });

    it("reads Claude Code's tool lines and git status", () => {
        expect(paths("● Update(frontend/util/fontutil.ts)")).toEqual([
            ["frontend/util/fontutil.ts", undefined, undefined],
        ]);
        expect(paths(" M frontend/tailwindsetup.css")).toEqual([["frontend/tailwindsetup.css", undefined, undefined]]);
    });

    it("takes a bare file name with an extension, and a suffix right after it", () => {
        expect(paths("echo a.txt:2")).toEqual([["a.txt", 2, undefined]]);
        expect(paths("see package.json.")).toEqual([["package.json", undefined, undefined]]);
    });

    it("leaves out URLs, flags, numbers, versions and abbreviations", () => {
        expect(paths("open http://localhost:5174/src/main.ts now")).toEqual([]);
        expect(paths("--config=x 1.32s v3.2.4 e.g. i.e. 0.4s 2026/10/06 localhost:5174")).toEqual([]);
    });

    it("takes a path through a dot folder, from home or relative, but not a bare dot name", () => {
        expect(paths("open ~/.claude/usage-data/report.html")).toEqual([
            ["~/.claude/usage-data/report.html", undefined, undefined],
        ]);
        expect(paths("see .claude/settings.json and ../.env/x")).toEqual([
            [".claude/settings.json", undefined, undefined],
            ["../.env/x", undefined, undefined],
        ]);
        expect(paths("edit .gitignore and .ts files")).toEqual([]);
    });

    it("gives the text the link covers, with its offsets", () => {
        const [c] = findPathCandidates("at src/a.ts:3:1 here");
        expect(c).toMatchObject({ text: "src/a.ts:3:1", start: 3, end: 15 });
    });
});

describe("findSpanningPaths", () => {
    const row = (text: string, wrapped = false) => ({ text, wrapped });

    it("joins a path an agent TUI broke at the edge and indented, as Claude Code prints a long one", () => {
        const rows = [
            row("  It's saved at C:\\Users\\u\\Temp\\claude\\a84f5"),
            row("  551-9e49\\scratchpad\\report.md."),
        ];
        const [s, ...rest] = findSpanningPaths(rows, rows[0].text.length);
        expect(rest).toEqual([]);
        expect(s).toMatchObject({
            path: "C:\\Users\\u\\Temp\\claude\\a84f5551-9e49\\scratchpad\\report.md",
            start: { row: 0, col: 16 },
            end: { row: 1, col: 31 },
        });
    });

    it("joins a row xterm wrapped from its first cell", () => {
        const rows = [row("see src/view/age"), row("nts/a.ts:12 now", true)];
        expect(findSpanningPaths(rows, 16)).toMatchObject([
            { path: "src/view/agents/a.ts", line: 12, start: { row: 0, col: 4 }, end: { row: 1, col: 11 } },
        ]);
    });

    it("leaves a path that sits within one row to findPathCandidates", () => {
        const rows = [row("edited src/a.ts and src/b.ts plus"), row("  more words here")];
        expect(findSpanningPaths(rows, rows[0].text.length)).toEqual([]);
    });

    it("does not join a row that stops short of the edge, or one that ends on punctuation", () => {
        expect(findSpanningPaths([row("at src/vie"), row("  w/a.ts")], 40)).toEqual([]);
        expect(findSpanningPaths([row("ends here:"), row("src/a.ts")], 10)).toEqual([]);
        expect(findSpanningPaths([row("one sentence,"), row("  src/x/a.ts")], 13)).toEqual([]);
    });
});

describe("resolvePath", () => {
    it("joins a relative path to the cwd and folds . and ..", () => {
        expect(resolvePath("D:/repo", "./src/../src/a.ts")).toBe("D:/repo/src/a.ts");
        expect(resolvePath("D:\\repo\\sub", "..\\a.ts")).toBe("D:/repo/a.ts");
        expect(resolvePath("/home/u/repo", "a.ts")).toBe("/home/u/repo/a.ts");
    });

    it("keeps an absolute path, whatever the cwd", () => {
        expect(resolvePath(null, "C:\\x\\y.go")).toBe("C:/x/y.go");
        expect(resolvePath("~", "/etc/hosts")).toBe("/etc/hosts");
    });

    it("cannot resolve a relative path without an absolute cwd, nor a ~ path without the home folder", () => {
        expect(resolvePath("~", "a.ts")).toBeNull();
        expect(resolvePath(null, "a.ts")).toBeNull();
        expect(resolvePath("D:/repo", "~/a.ts")).toBeNull();
    });

    it("reads ~ as the home folder, in the path and in the cwd", () => {
        const home = "C:\\Users\\u";
        expect(resolvePath("D:/repo", "~/.claude/usage-data/report.html", home)).toBe(
            "C:/Users/u/.claude/usage-data/report.html"
        );
        expect(resolvePath("~", "a.ts", home)).toBe("C:/Users/u/a.ts");
        expect(resolvePath("~/proj", "src/a.ts", "/home/u")).toBe("/home/u/proj/src/a.ts");
        expect(resolvePath(null, "~user/a.ts", home)).toBeNull();
    });
});

describe("inlinePathOf", () => {
    it("accepts inline code that is one path, with a separator, a suffix or a source extension", () => {
        expect(inlinePathOf("frontend/util/fontutil.ts")?.path).toBe("frontend/util/fontutil.ts");
        expect(inlinePathOf("fontutil.ts:40")).toMatchObject({ path: "fontutil.ts", line: 40 });
        expect(inlinePathOf("package.json")?.path).toBe("package.json");
    });

    it("refuses code that is not only a path, or a name that is not a source file", () => {
        expect(inlinePathOf("console.log")).toBeNull();
        expect(inlinePathOf("npm run dev")).toBeNull();
        expect(inlinePathOf("const x = 1")).toBeNull();
    });
});

describe("matchKnownPath", () => {
    const known = [
        "D:/thesis/obsidian/seminar_cycle2/huong_C/plan_C.md",
        "D:/thesis/obsidian/seminar_cycle2/huong_C/idea_C.md",
        "D:/thesis/README.md",
    ];

    it("finds the one known file a path is the tail of", () => {
        expect(matchKnownPath("huong_C/plan_C.md", known)).toBe("D:/thesis/obsidian/seminar_cycle2/huong_C/plan_C.md");
        expect(matchKnownPath("./huong_C\\plan_C.md", known)).toBe(
            "D:/thesis/obsidian/seminar_cycle2/huong_C/plan_C.md"
        );
    });

    it("matches whole segments only", () => {
        expect(matchKnownPath("C/plan_C.md", known)).toBeNull();
        expect(matchKnownPath("an_C.md", known)).toBeNull();
    });

    it("gives up when two different files fit", () => {
        const two = [...known, "D:/thesis/archive/huong_C/plan_C.md"];
        expect(matchKnownPath("huong_C/plan_C.md", two)).toBeNull();
        expect(matchKnownPath("huong_C/plan_C.md", [...known, known[0]])).toBe(known[0]);
    });

    it("leaves absolute, parent-relative and home paths alone", () => {
        expect(matchKnownPath("/huong_C/plan_C.md", known)).toBeNull();
        expect(matchKnownPath("../huong_C/plan_C.md", known)).toBeNull();
        expect(matchKnownPath("~/huong_C/plan_C.md", known)).toBeNull();
    });
});
