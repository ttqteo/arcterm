// frontend/app/view/code/codeoutline.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the declarations in a file's text, per language. A regex pass over declaration lines, not a
// parser: it claims a small set of forms per language and returns nothing for a language it does not
// know, because an empty outline reads as "not supported here" and a wrong one would read as a fact.
// String and comment contents are not excluded — an anchored pattern makes a false hit rare, and a
// tokenizer per language is the cost this module exists to avoid.

import { fuzzyScore } from "@/app/cockpit/palette-match";
import type { Lang } from "./codelang";

export type SymbolKind = "func" | "type" | "class" | "const" | "var" | "heading";

export interface OutlineSymbol {
    name: string;
    kind: SymbolKind;
    line: number; // 1-based, as codePendingLineAtom takes it
    depth: number; // 0 at the top level; 1 for a member of an enclosing block
}

type Parser = (lines: readonly string[]) => OutlineSymbol[];

const PARSERS: Record<Lang, Parser> = {
    go: outlineGo,
    ts: outlineTs,
    rust: outlineRust,
    python: outlinePython,
    java: outlineJava,
    shell: outlineShell,
    css: outlineCss,
    markdown: outlineMarkdown,
    unknown: () => [],
};

export function outlineOf(text: string, lang: Lang): OutlineSymbol[] {
    return PARSERS[lang](text.split(/\r?\n/));
}

// Every symbol in file order for an empty query; otherwise the fuzzy matches, best first, with the
// earlier line winning a tie so two equal names keep their reading order.
export function rankSymbols(query: string, symbols: readonly OutlineSymbol[]): OutlineSymbol[] {
    const q = query.trim();
    if (q === "") {
        return [...symbols];
    }
    const scored: { sym: OutlineSymbol; score: number }[] = [];
    for (const sym of symbols) {
        const score = fuzzyScore(q, sym.name);
        if (score != null) {
            scored.push({ sym, score });
        }
    }
    scored.sort((a, b) => b.score - a.score || a.sym.line - b.sym.line);
    return scored.map((s) => s.sym);
}

// Strings and line comments are dropped before braces are counted, so a "{" in a message does not
// open a block. A template literal spanning lines still can; the column-0 resync below bounds that.
function braceDelta(line: string, lineComments = true): number {
    let s = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "");
    if (lineComments) {
        s = s.replace(/\/\/.*$/, "");
    }
    let d = 0;
    for (const ch of s) {
        if (ch === "{") d++;
        else if (ch === "}") d--;
    }
    return d;
}

// --- go -----------------------------------------------------------------------------------------

// a method's receiver type leads its name, so a file's several String methods stay tellable apart
const GO_FUNC = /^func\s+(?:\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_]\w*)[^)]*\)\s*)?([A-Za-z_]\w*)/;
const GO_DECL = /^(type|const|var)\s+([A-Za-z_]\w*)/;
const GO_BLOCK = /^(type|const|var)\s*\(\s*(?:\/\/.*)?$/;
// one indentation level, so a nested struct's fields inside a type block are not members
const GO_MEMBER = /^(?:\t| {4})([A-Za-z_]\w*)/;
const GO_KIND: Record<string, SymbolKind> = { type: "type", const: "const", var: "var" };

function outlineGo(lines: readonly string[]): OutlineSymbol[] {
    const out: OutlineSymbol[] = [];
    let block: SymbolKind | null = null;
    lines.forEach((text, i) => {
        const line = i + 1;
        if (block != null) {
            if (/^\)/.test(text)) {
                block = null;
                return;
            }
            const m = GO_MEMBER.exec(text);
            if (m != null && m[1] !== "_") {
                out.push({ name: m[1], kind: block, line, depth: 1 });
            }
            return;
        }
        let m = GO_FUNC.exec(text);
        if (m != null) {
            out.push({ name: m[1] != null ? `${m[1]}.${m[2]}` : m[2], kind: "func", line, depth: 0 });
            return;
        }
        m = GO_BLOCK.exec(text);
        if (m != null) {
            block = GO_KIND[m[1]];
            out.push({ name: `${m[1]} (…)`, kind: block, line, depth: 0 });
            return;
        }
        m = GO_DECL.exec(text);
        if (m != null) {
            out.push({ name: m[2], kind: GO_KIND[m[1]], line, depth: 0 });
        }
    });
    return out;
}

// --- shared block walk for brace languages --------------------------------------------------------

interface BraceRules {
    // a column-0 declaration; `opens` marks one whose body holds members (a class, an impl block)
    top(text: string): { name: string; kind: SymbolKind; opens: boolean } | null;
    // a member line directly inside an open body
    member(text: string): { name: string; kind: SymbolKind } | null;
}

// Top-level forms are matched at column 0, which formatted code guarantees, rather than at brace
// depth 0: a desynced count (a brace in a regex literal) would otherwise hide the rest of the file.
// Depth is counted only to know which lines sit directly inside a class or impl body.
function outlineBraces(lines: readonly string[], rules: BraceRules): OutlineSymbol[] {
    const out: OutlineSymbol[] = [];
    let depth = 0;
    let body: "none" | "pending" | "open" = "none";
    lines.forEach((text, i) => {
        const line = i + 1;
        const top = rules.top(text);
        if (top != null) {
            depth = 0;
            out.push({ name: top.name, kind: top.kind, line, depth: 0 });
            body = top.opens ? "pending" : "none";
        } else if (body === "open" && depth === 1) {
            const m = rules.member(text);
            if (m != null) {
                out.push({ name: m.name, kind: m.kind, line, depth: 1 });
            }
        }
        depth = Math.max(0, depth + braceDelta(text));
        if (body === "pending" && depth > 0) {
            body = "open";
        } else if (body === "pending" && top != null && text.includes("{")) {
            body = "none"; // `class A {}`: opened and closed on its own line
        } else if (body === "open" && depth === 0) {
            body = "none";
        }
    });
    return out;
}

// --- ts / js ------------------------------------------------------------------------------------

const TS_ID = String.raw`([A-Za-z_$][\w$]*)`;
const TS_LEAD = String.raw`^(?:export\s+)?(?:default\s+)?(?:declare\s+)?`;
const TS_FUNC = new RegExp(TS_LEAD + String.raw`(?:async\s+)?function\s*\*?\s*` + TS_ID);
const TS_CLASS = new RegExp(TS_LEAD + String.raw`(?:abstract\s+)?class\s+` + TS_ID);
const TS_TYPE = new RegExp(TS_LEAD + String.raw`(?:interface|type|(?:const\s+)?enum)\s+` + TS_ID);
const TS_VAR = new RegExp(TS_LEAD + String.raw`(const|let|var)\s+` + TS_ID);
const TS_METHOD = new RegExp(
    String.raw`^\s+(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set|declare)\s+)*\*?\s*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(`
);
// statements that look like `name(` at a method's indentation
const NOT_METHODS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "super", "await", "new"]);

const TS_RULES: BraceRules = {
    top(text) {
        let m = TS_FUNC.exec(text);
        if (m != null) return { name: m[1], kind: "func", opens: false };
        m = TS_CLASS.exec(text);
        if (m != null) return { name: m[1], kind: "class", opens: true };
        m = TS_TYPE.exec(text);
        if (m != null) return { name: m[1], kind: "type", opens: false };
        m = TS_VAR.exec(text);
        if (m != null) return { name: m[2], kind: m[1] === "const" ? "const" : "var", opens: false };
        return null;
    },
    member(text) {
        const m = TS_METHOD.exec(text);
        return m != null && !NOT_METHODS.has(m[1]) ? { name: m[1], kind: "func" } : null;
    },
};

function outlineTs(lines: readonly string[]): OutlineSymbol[] {
    return outlineBraces(lines, TS_RULES);
}

// --- rust ---------------------------------------------------------------------------------------

const RS_VIS = String.raw`(?:pub(?:\([^)]*\))?\s+)?`;
const RS_FN_HEAD = RS_VIS + String.raw`(?:(?:const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+([A-Za-z_]\w*)`;
const RS_FN = new RegExp("^" + RS_FN_HEAD);
const RS_MEMBER_FN = new RegExp(String.raw`^\s+` + RS_FN_HEAD);
const RS_ITEM = new RegExp(
    "^" + RS_VIS + String.raw`(struct|enum|trait|type|union|const|static)\s+(?:mut\s+)?([A-Za-z_]\w*)`
);
const RS_IMPL = /^(?:unsafe\s+)?impl\b\s*(?:<[^{]*?>)?\s*([^{]+?)\s*(?:\{.*)?$/;
const RS_KIND: Record<string, SymbolKind> = {
    struct: "type",
    enum: "type",
    trait: "type",
    type: "type",
    union: "type",
    const: "const",
    static: "var",
};

const RUST_RULES: BraceRules = {
    top(text) {
        // fn before items: `pub const fn f` is a function, not a const named fn
        let m = RS_FN.exec(text);
        if (m != null) return { name: m[1], kind: "func", opens: false };
        m = RS_ITEM.exec(text);
        if (m != null) return { name: m[2], kind: RS_KIND[m[1]], opens: false };
        m = RS_IMPL.exec(text);
        if (m != null) {
            const target = m[1].replace(/\s+where\b.*$/, "");
            return { name: `impl ${target}`, kind: "type", opens: true };
        }
        return null;
    },
    member(text) {
        const m = RS_MEMBER_FN.exec(text);
        return m != null ? { name: m[1], kind: "func" } : null;
    },
};

function outlineRust(lines: readonly string[]): OutlineSymbol[] {
    return outlineBraces(lines, RUST_RULES);
}

// --- python -------------------------------------------------------------------------------------

const PY_DECL = /^(\s*)(?:(?:async\s+)?def|(class))\s+([A-Za-z_]\w*)/;

// nesting is indentation: a declaration sits under every open one indented less than it
function outlinePython(lines: readonly string[]): OutlineSymbol[] {
    const out: OutlineSymbol[] = [];
    const open: number[] = [];
    lines.forEach((text, i) => {
        const m = PY_DECL.exec(text);
        if (m == null) {
            return;
        }
        const indent = m[1].length;
        while (open.length > 0 && open[open.length - 1] >= indent) {
            open.pop();
        }
        out.push({ name: m[3], kind: m[2] != null ? "class" : "func", line: i + 1, depth: open.length });
        open.push(indent);
    });
    return out;
}

// --- java ---------------------------------------------------------------------------------------

const JAVA_TYPE =
    /^\s*(?:(?:public|private|protected|static|final|abstract|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/;

// type declarations only; a nested type's depth is the brace depth it opens at
function outlineJava(lines: readonly string[]): OutlineSymbol[] {
    const out: OutlineSymbol[] = [];
    let depth = 0;
    lines.forEach((text, i) => {
        const m = JAVA_TYPE.exec(text);
        if (m != null) {
            out.push({ name: m[2], kind: m[1] === "class" ? "class" : "type", line: i + 1, depth });
        }
        depth = Math.max(0, depth + braceDelta(text));
    });
    return out;
}

// --- shell --------------------------------------------------------------------------------------

const SH_FUNC = /^\s*(?:function\s+([A-Za-z_][\w.:-]*)|([A-Za-z_][\w.:-]*)\s*\(\s*\))/;

function outlineShell(lines: readonly string[]): OutlineSymbol[] {
    const out: OutlineSymbol[] = [];
    lines.forEach((text, i) => {
        const m = SH_FUNC.exec(text);
        if (m != null) {
            out.push({ name: m[1] ?? m[2], kind: "func", line: i + 1, depth: 0 });
        }
    });
    return out;
}

// --- css ----------------------------------------------------------------------------------------

// The selector of each top-level rule, an at-rule's prelude included. A selector list wrapped over
// several lines is joined and placed at its first line.
function outlineCss(lines: readonly string[]): OutlineSymbol[] {
    const out: OutlineSymbol[] = [];
    let depth = 0;
    let pending: { text: string; line: number } | null = null;
    lines.forEach((raw, i) => {
        const text = raw.replace(/\/\*.*?\*\//g, "");
        if (depth === 0) {
            const brace = text.indexOf("{");
            const head = (brace === -1 ? text : text.slice(0, brace)).trim();
            if (brace !== -1) {
                const name = [pending?.text, head].filter(Boolean).join(" ");
                if (name !== "") {
                    out.push({ name, kind: "type", line: pending?.line ?? i + 1, depth: 0 });
                }
                pending = null;
            } else if (head !== "" && !/[;}]/.test(head)) {
                pending = { text: [pending?.text, head].filter(Boolean).join(" "), line: pending?.line ?? i + 1 };
            } else {
                pending = null;
            }
        }
        depth = Math.max(0, depth + braceDelta(text, false));
    });
    return out;
}

// --- markdown -----------------------------------------------------------------------------------

const MD_HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const MD_FENCE = /^ {0,3}(`{3,}|~{3,})/;

// ATX headings, depth from the # count. Fenced code and a leading frontmatter block are skipped:
// a shell comment in a fence, or a YAML comment, starts with # too.
function outlineMarkdown(lines: readonly string[]): OutlineSymbol[] {
    const out: OutlineSymbol[] = [];
    let fence: string | null = null;
    let start = 0;
    if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
        start = end === -1 ? 0 : end + 1;
    }
    for (let i = start; i < lines.length; i++) {
        const text = lines[i];
        const f = MD_FENCE.exec(text);
        if (fence != null) {
            if (f != null && f[1][0] === fence[0] && f[1].length >= fence.length && text.trim() === f[1]) {
                fence = null;
            }
            continue;
        }
        if (f != null) {
            fence = f[1];
            continue;
        }
        const m = MD_HEADING.exec(text);
        if (m != null && m[2] !== "") {
            out.push({ name: m[2], kind: "heading", line: i + 1, depth: m[1].length - 1 });
        }
    }
    return out;
}
