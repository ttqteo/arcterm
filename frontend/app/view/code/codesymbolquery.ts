// frontend/app/view/code/codesymbolquery.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: go-to-definition as a shaped grep. For a name, an extended regex of the language's
// declaration forms, and a ranking of what git returns. Roughly right rather than exactly right: it
// cannot tell two same-named symbols in different packages apart, so several hits become a list the
// user picks from — it never lands somewhere silently.
//
// The pattern runs under `git grep -E` and, in a directory that is not a repository, under Go's RE2.
// Both accept POSIX bracket classes, and neither is guaranteed to accept \b or \s the same way, so
// the forms use [[:space:]] and spell out the character after a name.

import type { Lang } from "./codelang";

// a declaration form is either "strong" (introduced by a keyword: func, class, def…) or "weak" (a
// shape that is usually a declaration: a method header, a module-level assignment). Both are grepped;
// the ranking puts strong ones first.
interface Forms {
    strong: string[];
    weak: string[];
}

// the space class as each engine spells it
const ERE_SPACE = "[[:space:]]";
const JS_SPACE = "\\s";

function escapeName(name: string): string {
    return name.replace(/[.[\]()*+?{}|^$\\]/g, "\\$&");
}

function formsOf(name: string, lang: Lang, sp: string): Forms | null {
    const n = escapeName(name);
    const ws = `${sp}+`;
    const os = `${sp}*`;
    // the character after the name: not part of an identifier, or the line's end
    const end = "([^A-Za-z0-9_$]|$)";
    switch (lang) {
        case "go":
            return {
                strong: [
                    `^func${ws}(\\([^)]*\\)${os})?${n}${os}[[(]`,
                    `^type${ws}${n}${end}`,
                    `^(const|var)${ws}${n}${end}`,
                ],
                // a member of a type, const or var block, at one indentation level
                weak: [`^(\t|    )${n}${ws}[^=:,(]`, `^(\t|    )${n}${os}=[^=]`],
            };
        case "ts": {
            const lead = `^${os}(export${ws})?(default${ws})?(declare${ws})?`;
            return {
                strong: [
                    `${lead}(async${ws})?function${os}\\*?${os}${n}${end}`,
                    `${lead}(abstract${ws})?class${ws}${n}${end}`,
                    `${lead}(interface|type|enum|const${ws}enum)${ws}${n}${end}`,
                    `^(export${ws})?(const|let|var)${ws}${n}${end}`,
                ],
                // a method header: name, parameters, then a body brace on the same line
                weak: [
                    `^${sp}+((public|private|protected|static|async|readonly|override|abstract|get|set)${ws})*${n}${os}(<[^>]*>)?${os}\\([^;]*\\)[^;=]*\\{${os}$`,
                ],
            };
        }
        case "rust":
            return {
                strong: [
                    `^${os}(pub(\\([^)]*\\))?${ws})?((const|async|unsafe|extern)${ws}("[^"]*"${ws})?)*fn${ws}${n}${end}`,
                    `^${os}(pub(\\([^)]*\\))?${ws})?(struct|enum|trait|type|union|const|static|mod)${ws}(mut${ws})?${n}${end}`,
                    `^${os}macro_rules!${os}${n}${end}`,
                ],
                weak: [],
            };
        case "python":
            return {
                strong: [`^${os}(async${ws})?def${ws}${n}${os}\\(`, `^${os}class${ws}${n}${os}[(:]`],
                weak: [`^${n}${os}(:[^=]*)?=[^=]`],
            };
        case "java":
            return {
                strong: [
                    `^${os}((public|private|protected|static|final|abstract|sealed|non-sealed|strictfp)${ws})*(class|interface|enum|record|@interface)${ws}${n}${end}`,
                ],
                weak: [
                    `^${sp}+((public|private|protected|static|final|abstract|synchronized|native|default)${ws})*[A-Za-z_][A-Za-z0-9_<>,.?]*(\\[\\])*${ws}${n}${os}\\(`,
                ],
            };
        case "shell":
            return {
                strong: [`^${os}function${ws}${n}([^A-Za-z0-9_.:-]|$)`, `^${os}${n}${os}\\(${os}\\)`],
                weak: [],
            };
        case "css":
            // a custom property is declared by `--name:`; anything else is a class or id selector
            return name.startsWith("--")
                ? { strong: [`^${os}${n}${os}:`], weak: [] }
                : { strong: [`[.#]${n}([^A-Za-z0-9_-]|$)[^;]*\\{`], weak: [] };
        case "markdown":
        case "unknown":
            return null;
    }
}

// The ERE git greps with, or null for a language with no declaration forms (markdown, unknown), where
// the caller falls back to a plain references search.
export function definitionPattern(name: string, lang: Lang): string | null {
    const f = formsOf(name, lang, ERE_SPACE);
    return f == null ? null : [...f.strong, ...f.weak].join("|");
}

// Identifier characters per language. CSS and shell names carry dashes (`--color-accent`,
// `deploy-all`); everything else follows the C-family rule, with JavaScript's `$`.
function wordChar(lang: Lang): RegExp {
    return lang === "css" || lang === "shell" ? /[A-Za-z0-9_-]/ : /[A-Za-z0-9_$]/;
}

// The identifier under a caret. column is Monaco's: 1-based, the caret sitting before that character,
// so a caret just past the last letter still names the word. null on whitespace, punctuation, or a
// number. Strings are not special: a word in a string is still a word.
export function wordAt(lineText: string, column: number, lang: Lang = "ts"): string | null {
    const ch = wordChar(lang);
    let at = column - 1;
    if (!ch.test(lineText[at] ?? "")) {
        at -= 1;
        if (!ch.test(lineText[at] ?? "")) {
            return null;
        }
    }
    let start = at;
    let end = at + 1;
    while (start > 0 && ch.test(lineText[start - 1])) start--;
    while (end < lineText.length && ch.test(lineText[end])) end++;
    const word = lineText.slice(start, end);
    return /^[0-9-]+$/.test(word) || /^[0-9]/.test(word) ? null : word;
}

export interface RankedHit {
    path: string;
    line: number;
    text: string;
    score: number;
}

const TEST_PATH = /(^|\/)(__tests__|tests?|testdata)\/|[._-](test|spec)\.[^/]+$|_test\.go$|(^|\/)test_[^/]*\.py$/;
const STRONG_SCORE = 100;
const SAME_DIR_SCORE = 20;
const SHARED_SEGMENT_SCORE = 2;
const TEST_PENALTY = 1000;

function dirOf(path: string): string {
    const cut = path.lastIndexOf("/");
    return cut === -1 ? "" : path.slice(0, cut);
}

function sharedSegments(a: string, b: string): number {
    const as = a.split("/");
    const bs = b.split("/");
    let i = 0;
    while (i < as.length && i < bs.length && as[i] === bs[i]) i++;
    return i;
}

// Keyword declarations above declaration-shaped lines, the caller's directory above the rest and
// nearer directories above farther ones, and test files after everything else.
export function rankDefinitions(
    hits: readonly GitGrepMatch[],
    name: string,
    lang: Lang,
    fromPath: string
): RankedHit[] {
    const forms = formsOf(name, lang, JS_SPACE);
    const strong = forms == null ? [] : forms.strong.map((f) => new RegExp(f));
    const fromDir = dirOf(fromPath);
    const ranked = hits.map((h) => {
        const dir = dirOf(h.path);
        let score = 0;
        if (strong.some((re) => re.test(h.text))) score += STRONG_SCORE;
        if (dir === fromDir) score += SAME_DIR_SCORE;
        else score += SHARED_SEGMENT_SCORE * sharedSegments(dir, fromDir);
        if (TEST_PATH.test(h.path)) score -= TEST_PENALTY;
        return { path: h.path, line: h.line, text: h.text, score };
    });
    ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
    return ranked;
}
