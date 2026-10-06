// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure, dependency-free line tokenizer for transcript code blocks. Ported from the claude-design
// mock's hlLine. Returns tokens tagged with a Tailwind text-color utility (design-system token),
// never a raw hex. Language-agnostic lexical heuristics (keywords/strings/numbers/comments) — good
// enough for prose code snippets, not a full parser.

export interface CodeToken {
    t: string;
    cls: string;
}

const KEYWORDS = new Set([
    "const", "let", "var", "function", "return", "new", "import", "from", "export", "default",
    "if", "else", "for", "while", "await", "async", "class", "extends", "true", "false", "null",
    "undefined", "this", "void", "type", "interface",
]);

// group order matters: comment | string | number | ident | whitespace | punctuation. Identifiers are
// Unicode letters (so "Kiểm" stays one word, not "Ki" + punct "ể" + "m"); punctuation is any other single
// non-space char, so a char no earlier group takes (the "0" of "0x1F") still renders.
const TOKEN_RE =
    /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([\p{L}_$][\p{L}\p{M}\p{N}_$]*)|(\s+)|(\S)/gu;

// Fence languages that are prose, not code: an untagged fence (a pasted prompt, a file tree) and the
// text/markdown tags render in one colour, as GitHub does, instead of painting its numbers and quotes.
const PLAIN_LANGS = new Set(["", "text", "txt", "plain", "plaintext", "md", "markdown"]);

export function isPlainLang(lang: string | undefined): boolean {
    return PLAIN_LANGS.has((lang ?? "").toLowerCase());
}

export function highlightLine(line: string): CodeToken[] {
    const toks: CodeToken[] = [];
    let m: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(line))) {
        let cls = "text-syntax-ident";
        if (m[1]) cls = "text-syntax-comment";
        else if (m[2]) cls = "text-syntax-string";
        else if (m[3]) cls = "text-syntax-number";
        else if (m[4]) cls = KEYWORDS.has(m[4]) ? "text-syntax-keyword" : "text-syntax-ident";
        else if (m[6]) cls = "text-syntax-punct";
        toks.push({ t: m[0], cls });
    }
    if (toks.length === 0) toks.push({ t: " ", cls: "text-syntax-ident" });
    return toks;
}
