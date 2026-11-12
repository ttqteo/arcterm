// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lang } from "./codelang";
import { definitionPattern, rankDefinitions, wordAt } from "./codesymbolquery";

// the ERE as JavaScript reads it, to check what each form claims without a git process per case
function asJs(name: string, lang: Lang): RegExp {
    return new RegExp(definitionPattern(name, lang)!.split("[[:space:]]").join("\\s"));
}

describe("definitionPattern", () => {
    it("escapes regex metacharacters in the name and never relies on \\b or \\s", () => {
        const p = definitionPattern("a.b$c(", "ts")!;
        expect(p).toContain("a\\.b\\$c\\(");
        expect(p).not.toContain("\\b");
        expect(p).not.toContain("\\s");
    });

    it("has no forms for markdown or an unknown language", () => {
        expect(definitionPattern("x", "markdown")).toBeNull();
        expect(definitionPattern("x", "unknown")).toBeNull();
    });

    const cases: { lang: Lang; name: string; defs: string[]; mentions: string[] }[] = [
        {
            lang: "go",
            name: "Grep",
            defs: [
                "func Grep(ctx context.Context) error {",
                "func (r *Reader) Grep(q string) {",
                "func Grep[T any](x T) {",
                "type Grep struct {",
                "var Grep = 1",
                "\tGrep Kind = iota",
            ],
            mentions: ["\tres, err := Grep(ctx)", "// Grep searches", "func GrepAll() {", "\tx := Grep"],
        },
        {
            lang: "ts",
            name: "openPath",
            defs: [
                "export async function openPath(rel: string) {",
                "function openPath() {}",
                "export const openPath = () => {};",
                "export default class openPath {",
                "export interface openPath {",
                "    async openPath(rel: string): Promise<void> {",
            ],
            mentions: [
                "    await openPath(rel);",
                "import { openPath } from './codestore';",
                "    openPath(() => {",
                "const openPathX = 1;",
                "    const openPath = 1;",
            ],
        },
        {
            lang: "rust",
            name: "spawn",
            defs: [
                "pub fn spawn() {",
                "    pub(crate) async fn spawn(&self) {",
                "struct spawn;",
                "pub const fn spawn() {}",
            ],
            mentions: ["    let x = spawn();", "use crate::spawn;"],
        },
        {
            lang: "python",
            name: "fetch",
            defs: ["def fetch(url):", "    async def fetch(self):", "class fetch(Base):", "fetch: int = 3"],
            mentions: ["    return fetch(url)", "x = fetch", "fetch == 1"],
        },
        {
            lang: "java",
            name: "App",
            defs: ["public final class App {", "    static record App(int x) {}"],
            mentions: ["    App app = new App();"],
        },
        {
            lang: "shell",
            name: "build",
            defs: ["build() {", "function build {", "  build () {"],
            mentions: ["build", "  build --release", "echo build()"],
        },
        {
            lang: "css",
            name: "btn",
            defs: [".btn {", "a, .btn:hover {"],
            mentions: ["  color: btn;", ".btn-primary {"],
        },
        {
            lang: "css",
            name: "--color-accent",
            defs: ["  --color-accent: #fff;"],
            mentions: ["  color: var(--color-accent);"],
        },
    ];

    for (const c of cases) {
        it(`${c.lang}: claims the declaration forms of ${c.name} and not its mentions`, () => {
            const re = asJs(c.name, c.lang);
            for (const d of c.defs) {
                expect(re.test(d), d).toBe(true);
            }
            for (const m of c.mentions) {
                expect(re.test(m), m).toBe(false);
            }
        });
    }

    // the pattern is only worth anything if the git this repository runs on accepts it under -E
    it("is accepted by git grep -E and finds the definition", () => {
        const dir = mkdtempSync(join(tmpdir(), "symbolquery-"));
        try {
            const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
            git("init", "-q");
            writeFileSync(join(dir, "a.go"), "package a\n\nfunc (r *R) Grep(q string) {}\n\nfunc use() { Grep(1) }\n");
            writeFileSync(join(dir, "b.ts"), "export async function openPath(rel: string) {}\nopenPath('x');\n");
            git("add", ".");
            const run = (name: string, lang: Lang) =>
                git("grep", "-n", "-E", "--no-color", "-e", definitionPattern(name, lang)!, "--", "*.go", "*.ts");
            const go = run("Grep", "go");
            expect(go.status, go.stderr).toBe(0);
            expect(go.stdout.trim()).toBe("a.go:3:func (r *R) Grep(q string) {}");
            const ts = run("openPath", "ts");
            expect(ts.status, ts.stderr).toBe(0);
            expect(ts.stdout.trim()).toBe("b.ts:1:export async function openPath(rel: string) {}");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("wordAt", () => {
    const line = "    const res = openPath(rel);";

    it("names the word with the caret inside it or at either edge", () => {
        const start = line.indexOf("openPath") + 1; // Monaco columns are 1-based
        expect(wordAt(line, start + 3)).toBe("openPath");
        expect(wordAt(line, start)).toBe("openPath");
        expect(wordAt(line, start + "openPath".length)).toBe("openPath");
    });

    it("is null on whitespace and on punctuation with no word beside it", () => {
        expect(wordAt(line, 2)).toBeNull();
        expect(wordAt("a = ( b", 5)).toBeNull();
    });

    it("finds a word inside a string", () => {
        expect(wordAt('log("openPath failed")', 8)).toBe("openPath");
    });

    it("is null on a number", () => {
        expect(wordAt("x = 500;", 6)).toBeNull();
    });

    it("keeps $ in JavaScript names and dashes in CSS names", () => {
        expect(wordAt("const $el = 1", 8)).toBe("$el");
        expect(wordAt("color: var(--color-accent);", 15, "css")).toBe("--color-accent");
        expect(wordAt("color: var(--color-accent);", 15, "ts")).toBe("color");
    });
});

describe("rankDefinitions", () => {
    const hit = (path: string, text: string, line = 1): GitGrepMatch => ({ path, line, text });

    it("puts a keyword declaration above a declaration-shaped line", () => {
        const ranked = rankDefinitions(
            [hit("x/a.ts", "    openPath(rel: string) {"), hit("y/b.ts", "export function openPath(rel: string) {")],
            "openPath",
            "ts",
            "z/c.ts"
        );
        expect(ranked.map((r) => r.path)).toEqual(["y/b.ts", "x/a.ts"]);
    });

    it("puts the caller's directory above a nearer one, and a nearer one above a distant one", () => {
        const def = "func Grep() {}";
        const ranked = rankDefinitions(
            [hit("cmd/x/a.go", def), hit("pkg/gitinfo/sub/b.go", def), hit("pkg/gitinfo/c.go", def)],
            "Grep",
            "go",
            "pkg/gitinfo/walk.go"
        );
        expect(ranked.map((r) => r.path)).toEqual(["pkg/gitinfo/c.go", "pkg/gitinfo/sub/b.go", "cmd/x/a.go"]);
    });

    it("puts test files last, even a keyword declaration in one", () => {
        const ranked = rankDefinitions(
            [
                hit("pkg/a_test.go", "func helper() {}"),
                hit("frontend/x.test.ts", "function helper() {}"),
                hit("pkg/far/b.go", "\thelper = 1"),
            ],
            "helper",
            "go",
            "pkg/a.go"
        );
        expect(ranked[0].path).toBe("pkg/far/b.go");
        expect(ranked.slice(1).every((r) => /test/.test(r.path))).toBe(true);
    });
});
