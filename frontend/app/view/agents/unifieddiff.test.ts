import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./unifieddiff";

const TWO_FILES = [
    "diff --git a/pkg/a.go b/pkg/a.go",
    "index 1111111..2222222 100644",
    "--- a/pkg/a.go",
    "+++ b/pkg/a.go",
    "@@ -1,3 +1,4 @@",
    " package a",
    "-var x = 1",
    "+var x = 2",
    "+var y = 3",
    "",
    "diff --git a/pkg/new.go b/pkg/new.go",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/pkg/new.go",
    "@@ -0,0 +1,2 @@",
    "+package a",
    "+// new",
    "\\ No newline at end of file",
].join("\n");

describe("parseUnifiedDiff", () => {
    it("parses a two-file diff with counts, hunk lines and the new-file badge", () => {
        expect(parseUnifiedDiff(TWO_FILES)).toEqual([
            {
                path: "pkg/a.go",
                badge: "M",
                adds: 2,
                dels: 1,
                lines: [
                    { sign: "", text: "@@ -1,3 +1,4 @@", hunk: true },
                    { sign: "", text: "package a", oldNo: 1, newNo: 1 },
                    { sign: "-", text: "var x = 1", oldNo: 2 },
                    { sign: "+", text: "var x = 2", newNo: 2 },
                    { sign: "+", text: "var y = 3", newNo: 3 },
                    { sign: "", text: "", oldNo: 3, newNo: 4 },
                ],
            },
            {
                path: "pkg/new.go",
                badge: "A",
                adds: 2,
                dels: 0,
                lines: [
                    { sign: "", text: "@@ -0,0 +1,2 @@", hunk: true },
                    { sign: "+", text: "package a", newNo: 1 },
                    { sign: "+", text: "// new", newNo: 2 },
                ],
            },
        ]);
    });

    it("numbers each hunk's lines from its own @@ header", () => {
        const diff = [
            "diff --git a/x b/x",
            "--- a/x",
            "+++ b/x",
            "@@ -10,2 +10,2 @@",
            " keep",
            "-old",
            "+new",
            "@@ -40 +40,2 @@",
            "-a",
            "+b",
            "+c",
        ].join("\n");
        const lines = parseUnifiedDiff(diff)?.[0].lines.filter((l) => !l.hunk);
        expect(lines?.map((l) => [l.sign, l.oldNo, l.newNo])).toEqual([
            ["", 10, 10],
            ["-", 11, undefined],
            ["+", undefined, 11],
            ["-", 40, undefined],
            ["+", undefined, 40],
            ["+", undefined, 41],
        ]);
    });

    it("skips the commit header of git show", () => {
        const show = [
            "commit 6d2e81db98e711c1c88e594d704452d80958e545",
            "Author: Someone <a@b.c>",
            "Date:   Tue Nov 10 09:48:31 2026 +0700",
            "",
            "    feat: a thing",
            "",
            "    diff --git a/fake b/fake",
            "",
            TWO_FILES,
        ].join("\n");
        const files = parseUnifiedDiff(show);
        expect(files?.map((f) => f.path)).toEqual(["pkg/a.go", "pkg/new.go"]);
    });

    it("skips a second commit header between files of a multi-commit git show", () => {
        const show = [
            "diff --git a/x b/x",
            "--- a/x",
            "+++ b/x",
            "@@ -1 +1 @@",
            "-a",
            "+b",
            "",
            "commit 1234",
            "Author: Someone",
            "",
            "diff --git a/y b/y",
            "--- a/y",
            "+++ b/y",
            "@@ -1 +1 @@",
            "-c",
            "+d",
        ].join("\n");
        const files = parseUnifiedDiff(show);
        expect(files?.map((f) => [f.path, f.adds, f.dels, f.lines.length])).toEqual([
            ["x", 1, 1, 3],
            ["y", 1, 1, 3],
        ]);
    });

    it("keeps no lines for a binary file and marks it", () => {
        const files = parseUnifiedDiff(
            "diff --git a/img.png b/img.png\nindex 1..2 100644\nBinary files a/img.png and b/img.png differ"
        );
        expect(files).toEqual([{ path: "img.png", badge: "M", adds: 0, dels: 0, lines: [], binary: true }]);
    });

    it("marks a new binary file, and only the binary one", () => {
        const diff = [
            "diff --git a/img.png b/img.png",
            "new file mode 100644",
            "index 0000000..2222222",
            "Binary files /dev/null and b/img.png differ",
            "diff --git a/x b/x",
            "--- a/x",
            "+++ b/x",
            "@@ -1 +1 @@",
            "-a",
            "+b",
        ].join("\n");
        const files = parseUnifiedDiff(diff);
        expect(files?.map((f) => [f.path, f.binary])).toEqual([
            ["img.png", true],
            ["x", undefined],
        ]);
    });

    it("strips ANSI colors", () => {
        const colored =
            "\x1b[1mdiff --git a/x b/x\x1b[m\n\x1b[1m--- a/x\x1b[m\n\x1b[1m+++ b/x\x1b[m\n\x1b[36m@@ -1 +1 @@\x1b[m\n\x1b[31m-a\x1b[m\n\x1b[32m+b\x1b[m";
        expect(parseUnifiedDiff(colored)?.[0]).toMatchObject({ path: "x", adds: 1, dels: 1 });
    });

    it("returns null without a diff --git header", () => {
        expect(parseUnifiedDiff("")).toBeNull();
        expect(parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b")).toBeNull();
        expect(parseUnifiedDiff(" 2 files changed, 3 insertions(+)")).toBeNull();
    });

    it("parses a 20,000-line diff to the right counts", () => {
        const lines: string[] = [];
        for (let f = 0; f < 10; f++) {
            lines.push(`diff --git a/f${f} b/f${f}`, `--- a/f${f}`, `+++ b/f${f}`, "@@ -1,1496 +1,1496 @@");
            for (let i = 0; i < 1000; i++) {
                lines.push(i % 2 === 0 ? `-old ${i}` : `+new ${i}`);
            }
            for (let i = 0; i < 996; i++) {
                lines.push(` ctx ${i}`);
            }
        }
        expect(lines.length).toBe(20_000);
        const files = parseUnifiedDiff(lines.join("\n"));
        expect(files).toHaveLength(10);
        expect(files?.reduce((n, f) => n + f.adds, 0)).toBe(5_000);
        expect(files?.reduce((n, f) => n + f.dels, 0)).toBe(5_000);
    });
});
