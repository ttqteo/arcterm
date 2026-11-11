// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { outlineOf, rankSymbols, type OutlineSymbol } from "./codeoutline";

const lines = (...ls: string[]) => ls.join("\n");
const brief = (syms: OutlineSymbol[]) => syms.map((s) => `${s.depth}:${s.kind}:${s.name}@${s.line}`);

describe("outlineOf go", () => {
    const src = lines(
        "package code",
        "",
        "func Grep(ctx context.Context) error {",
        "\treturn nil",
        "}",
        'func (r *Reader[T]) String() string { return "" }',
        "type GrepOpts struct {",
        "\tRegex bool",
        "}",
        "const maxGrepMatches = 500",
        'var errNope = errors.New("nope")',
        "const (",
        "\tKindA Kind = iota",
        "\tKindB",
        "\t_",
        "\t// a comment",
        ")",
        "type (",
        "\tPair struct {",
        "\t\tLeft int",
        "\t}",
        ")"
    );

    it("lists funcs, methods, types and top-level consts and vars with 1-based lines", () => {
        expect(brief(outlineOf(src, "go"))).toEqual([
            "0:func:Grep@3",
            "0:func:Reader.String@6",
            "0:type:GrepOpts@7",
            "0:const:maxGrepMatches@10",
            "0:var:errNope@11",
            "0:const:const (…)@12",
            "1:const:KindA@13",
            "1:const:KindB@14",
            "0:type:type (…)@18",
            "1:type:Pair@19",
        ]);
    });

    it("does not claim struct fields, locals or a nested struct's fields", () => {
        const names = outlineOf(src, "go").map((s) => s.name);
        expect(names).not.toContain("Regex");
        expect(names).not.toContain("Left");
        expect(names).not.toContain("_");
    });
});

describe("outlineOf ts", () => {
    const src = lines(
        'import { atom } from "jotai";',
        "export async function runSearch(q: string) {",
        "    const local = 1;",
        "}",
        "export default class Store<T> extends Base {",
        "    private count = 0;",
        "    constructor() {",
        "        super();",
        "        if (x) {",
        "            helper(() => {});",
        "        }",
        "    }",
        "    static async load(id: string): Promise<void> {",
        '        const s = "{";',
        "    }",
        "    get size() {",
        "        return 1;",
        "    }",
        "}",
        "export interface SearchOpts {",
        "    regex: boolean;",
        "}",
        "export type Lang = 'go' | 'ts';",
        "export const enum Mode { A }",
        "export const codeSearchAtom = atom({",
        "    kind: 'idle',",
        "});",
        "let counter = 0;",
        "function* gen() {}",
        "class Empty {}",
        "const after = 2;"
    );

    it("lists top-level declarations and class methods at depth 1", () => {
        expect(brief(outlineOf(src, "ts"))).toEqual([
            "0:func:runSearch@2",
            "0:class:Store@5",
            "1:func:constructor@7",
            "1:func:load@13",
            "1:func:size@16",
            "0:type:SearchOpts@20",
            "0:type:Lang@23",
            "0:type:Mode@24",
            "0:const:codeSearchAtom@25",
            "0:var:counter@28",
            "0:func:gen@29",
            "0:class:Empty@30",
            "0:const:after@31",
        ]);
    });

    it("does not claim locals, calls inside methods, fields or object members", () => {
        const names = outlineOf(src, "ts").map((s) => s.name);
        for (const n of ["local", "super", "helper", "count", "regex", "kind", "if"]) {
            expect(names).not.toContain(n);
        }
    });

    it("finds a class whose brace opens on the next line", () => {
        const s = lines("class A", "{", "    m() {}", "}", "function f() {}");
        expect(brief(outlineOf(s, "ts"))).toEqual(["0:class:A@1", "1:func:m@3", "0:func:f@5"]);
    });
});

describe("outlineOf rust", () => {
    const src = lines(
        "pub struct Server {",
        "    port: u16,",
        "}",
        "pub(crate) enum Mode { A, B }",
        "trait Run {",
        "    fn run(&self);",
        "}",
        "const MAX: usize = 10;",
        "static mut COUNT: u32 = 0;",
        "type Res<T> = Result<T, Error>;",
        "impl<T: Clone> Display for Wrapper<T> {",
        "    pub fn fmt(&self) -> String {",
        "        let inner = || {};",
        "    }",
        "    async fn later() {}",
        "}",
        "pub const fn answer() -> u32 { 42 }",
        "pub async fn main() {}"
    );

    it("lists items, impl blocks, and the impl's fns at depth 1", () => {
        expect(brief(outlineOf(src, "rust"))).toEqual([
            "0:type:Server@1",
            "0:type:Mode@4",
            "0:type:Run@5",
            "0:const:MAX@8",
            "0:var:COUNT@9",
            "0:type:Res@10",
            "0:type:impl Display for Wrapper<T>@11",
            "1:func:fmt@12",
            "1:func:later@15",
            "0:func:answer@17",
            "0:func:main@18",
        ]);
    });

    it("does not claim a trait's method signatures or fields", () => {
        const names = outlineOf(src, "rust").map((s) => s.name);
        expect(names).not.toContain("run");
        expect(names).not.toContain("port");
    });
});

describe("outlineOf python", () => {
    it("nests by indentation", () => {
        const src = lines(
            "import os",
            "class Repo:",
            "    def __init__(self):",
            "        def inner():",
            "            pass",
            "    async def fetch(self):",
            "        pass",
            "def main():",
            "    x = 1",
            "class Other(Base):",
            "    pass"
        );
        expect(brief(outlineOf(src, "python"))).toEqual([
            "0:class:Repo@2",
            "1:func:__init__@3",
            "2:func:inner@4",
            "1:func:fetch@6",
            "0:func:main@8",
            "0:class:Other@10",
        ]);
    });

    it("does not claim assignments", () => {
        expect(outlineOf("x = 1\nCONST = 2", "python")).toEqual([]);
    });
});

describe("outlineOf java", () => {
    it("lists type declarations, nested ones a level down", () => {
        const src = lines(
            "package a;",
            "public final class App {",
            "    private static class Inner {}",
            "    public void run() {}",
            "    enum State { ON }",
            "}",
            "interface Api {}",
            "record Point(int x, int y) {}"
        );
        expect(brief(outlineOf(src, "java"))).toEqual([
            "0:class:App@2",
            "1:class:Inner@3",
            "1:type:State@5",
            "0:type:Api@7",
            "0:type:Point@8",
        ]);
    });

    it("does not claim methods", () => {
        expect(outlineOf("class A {\n    void run() {}\n}", "java").map((s) => s.name)).toEqual(["A"]);
    });
});

describe("outlineOf shell", () => {
    it("lists both function forms", () => {
        const src = lines("#!/bin/sh", "build() {", "  go build", "}", "function clean {", "}", "deploy-all () {", "}");
        expect(brief(outlineOf(src, "shell"))).toEqual(["0:func:build@2", "0:func:clean@5", "0:func:deploy-all@7"]);
    });

    it("does not claim calls or variables", () => {
        expect(outlineOf('NAME=x\nbuild\necho "$(date)"', "shell")).toEqual([]);
    });
});

describe("outlineOf css", () => {
    it("lists top-level selectors and at-rules, joining a wrapped selector list", () => {
        const src = lines(
            "@import 'x.css';",
            ".btn { color: red; }",
            "a,",
            "b:hover {",
            "  color: blue;",
            "}",
            "@media (min-width: 600px) {",
            "  .btn { color: green; }",
            "}",
            "/* note */ :root {",
            "}"
        );
        expect(brief(outlineOf(src, "css"))).toEqual([
            "0:type:.btn@2",
            "0:type:a, b:hover@3",
            "0:type:@media (min-width: 600px)@7",
            "0:type::root@10",
        ]);
    });

    it("does not claim rules nested inside another", () => {
        const names = outlineOf("@media print {\n  .x {\n  }\n}", "css").map((s) => s.name);
        expect(names).toEqual(["@media print"]);
    });
});

describe("outlineOf markdown", () => {
    it("lists ATX headings with depth from the # count", () => {
        const src = lines("# Title", "text", "## Section ##", "### Deep", "#not a heading", "#");
        expect(brief(outlineOf(src, "markdown"))).toEqual([
            "0:heading:Title@1",
            "1:heading:Section@3",
            "2:heading:Deep@4",
        ]);
    });

    it("skips fenced blocks and frontmatter", () => {
        const src = lines(
            "---",
            "# yaml comment",
            "---",
            "# Real",
            "```sh",
            "# shell comment",
            "```",
            "~~~~",
            "# also code",
            "~~~",
            "~~~~",
            "## After"
        );
        expect(brief(outlineOf(src, "markdown"))).toEqual(["0:heading:Real@4", "1:heading:After@12"]);
    });
});

describe("outlineOf unknown", () => {
    it("claims nothing", () => {
        expect(outlineOf("func main() {}\nclass A {}\n# Title", "unknown")).toEqual([]);
    });
});

describe("outlineOf line endings", () => {
    it("counts CRLF lines the same as LF", () => {
        expect(brief(outlineOf("package a\r\n\r\nfunc F() {}\r\n", "go"))).toEqual(["0:func:F@3"]);
    });
});

describe("rankSymbols", () => {
    const syms: OutlineSymbol[] = [
        { name: "openPath", kind: "func", line: 3, depth: 0 },
        { name: "selectProject", kind: "func", line: 9, depth: 0 },
        { name: "openInCode", kind: "func", line: 20, depth: 0 },
    ];

    it("keeps file order for an empty query", () => {
        expect(rankSymbols("  ", syms).map((s) => s.line)).toEqual([3, 9, 20]);
    });

    it("drops non-matches and ranks the closer match first", () => {
        expect(rankSymbols("openin", syms).map((s) => s.name)).toEqual(["openInCode"]);
        expect(rankSymbols("open", syms).map((s) => s.name)).toEqual(["openPath", "openInCode"]);
    });
});
