// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { findPathCandidates, inlinePathOf, resolvePath } from "./pathlinks";

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

    it("gives the text the link covers, with its offsets", () => {
        const [c] = findPathCandidates("at src/a.ts:3:1 here");
        expect(c).toMatchObject({ text: "src/a.ts:3:1", start: 3, end: 15 });
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

    it("cannot resolve a relative path without an absolute cwd, nor a ~ path", () => {
        expect(resolvePath("~", "a.ts")).toBeNull();
        expect(resolvePath(null, "a.ts")).toBeNull();
        expect(resolvePath("D:/repo", "~/a.ts")).toBeNull();
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
