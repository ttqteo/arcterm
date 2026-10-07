// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: a .tex or .md source as a reading view — sections of paragraphs of sentences. A sentence is a list of
// word-sized tokens (what the view draws and the word diff compares) plus the slice of the file it came from
// (what a comment quotes, so the agent can search the file for it). A hand-written scanner, not a LaTeX or markdown
// parser: it keeps what a reader of the prose sees and drops the rest.

export type ProseKind = "latex" | "markdown";
export type TokenKind = "text" | "em" | "strong" | "code" | "ref" | "cite" | "math" | "link" | "image" | "placeholder";

// one word of text-like kinds, with its trailing whitespace in `text`; math, image and placeholder are one token each.
// link: href = target. image: text = alt, href = src.
export interface ProseToken {
    kind: TokenKind;
    text: string;
    href?: string;
    display?: boolean;
}

// `text` is the shown text, whitespace collapsed (what the diff compares); `source` slices the original file text
export interface ProseSentence {
    tokens: ProseToken[];
    text: string;
    source: { start: number; end: number };
}

export interface ProseParagraph {
    sentences: ProseSentence[];
    list?: boolean;
}

// level 0 is the text before the first heading; `label` is the short name a comment's location uses: `§3.2` or
// `5.2` for a numbered heading, else the title cut to LABEL_MAX characters
export interface ProseSection {
    level: number;
    title: string;
    label: string;
    paragraphs: ProseParagraph[];
}

export interface ProseDoc {
    kind: ProseKind;
    sections: ProseSection[];
}

export const LABEL_MAX = 40;
const FRONT_MATTER = "Front matter";

export function proseKindOf(path: string): ProseKind | null {
    if (/\.tex$/i.test(path)) {
        return "latex";
    }
    if (/\.(?:md|markdown)$/i.test(path)) {
        return "markdown";
    }
    return null;
}

export function toProse(kind: ProseKind, text: string): ProseDoc {
    return { kind, sections: kind === "latex" ? texSections(text) : mdSections(text) };
}

// ---------------------------------------------------------------------------------------------------------------
// shared: tokens, sentences, labels

const WS = /\s/;
const ALNUM = /[\p{L}\p{N}]/u;
const TEXT_LIKE = new Set<TokenKind>(["text", "em", "strong", "code", "ref", "cite", "link"]);
// kinds a sentence can end or start on; code, math, images and placeholders never do
const PROSE_KINDS = new Set<TokenKind>(["text", "em", "strong", "link"]);
// lower-cased, without their closing bracket or quote
const ABBREVIATIONS = new Set(["e.g.", "i.e.", "fig.", "figs.", "eq.", "eqs.", "sec.", "secs.", "vs.", "cf."]);
const OPENERS = /^[(["'“‘«]+/;
const CLOSERS = /[)\]"'”’»]+$/;
const SENTENCE_END = /[.?!][)\]"'”’»]*$/;

interface Style {
    kind: TokenKind;
    href?: string;
}
const PLAIN: Style = { kind: "text" };

// a token plus where it came from; `s`..`e` is the source of the construct that made it (a macro's whole
// invocation, not only its argument), so a sentence's source starts at `\emph` and ends past its brace
interface Piece {
    token: ProseToken;
    s: number;
    e: number;
    run: number; // pieces only merge into a word within one run of plain characters
    open: boolean; // the next character of the same style may still extend this word
    ws: boolean; // whitespace follows
}

class Emitter {
    pieces: Piece[] = [];
    private run = 0;

    // a character of text in a style; it extends the current word unless whitespace or a construct came between
    word(ch: string, style: Style, start: number, end: number): void {
        const last = this.pieces[this.pieces.length - 1];
        if (
            last &&
            last.open &&
            last.run === this.run &&
            last.token.kind === style.kind &&
            last.token.href === style.href
        ) {
            last.token.text += ch;
            last.e = end;
            return;
        }
        const token: ProseToken = { kind: style.kind, text: ch };
        if (style.href !== undefined) {
            token.href = style.href;
        }
        this.pieces.push({ token, s: start, e: end, run: this.run, open: true, ws: false });
    }

    // one whole token: math, an image, a placeholder, or a citation or reference
    atom(token: ProseToken, start: number, end: number): void {
        this.pieces.push({ token, s: start, e: end, run: this.run, open: false, ws: false });
    }

    space(): void {
        const last = this.pieces[this.pieces.length - 1];
        if (!last || last.ws) {
            return;
        }
        if (TEXT_LIKE.has(last.token.kind)) {
            last.token.text += " ";
        } else {
            this.pieces.push({
                token: { kind: "text", text: " " },
                s: last.e,
                e: last.e,
                run: this.run,
                open: false,
                ws: true,
            });
        }
        last.ws = true;
        last.open = false;
    }

    // wrap one construct: the pieces made between begin and end take its whole source range
    begin(): number {
        this.run++;
        return this.pieces.length;
    }
    end(from: number, start: number, end: number): void {
        this.run++;
        if (this.pieces.length > from) {
            const first = this.pieces[from];
            const last = this.pieces[this.pieces.length - 1];
            first.s = Math.min(first.s, start);
            last.e = Math.max(last.e, end);
        }
    }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const tokensText = (tokens: ProseToken[]) => collapse(tokens.map((t) => t.text).join(""));

function plainText(em: Emitter): string {
    return tokensText(em.pieces.map((p) => p.token));
}

export function cutLabel(title: string): string {
    const chars = Array.from(title);
    return chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX).join("") + "…" : title;
}

function isAbbreviation(pieces: Piece[], k: number): boolean {
    const word = (p: Piece) => p.token.text.trim().replace(OPENERS, "").replace(CLOSERS, "").toLowerCase();
    const w = word(pieces[k]);
    return ABBREVIATIONS.has(w) || (w === "al." && k > 0 && word(pieces[k - 1]) === "et");
}

function endsSentence(pieces: Piece[], k: number): boolean {
    const p = pieces[k];
    return (
        p.ws && PROSE_KINDS.has(p.token.kind) && SENTENCE_END.test(p.token.text.trimEnd()) && !isAbbreviation(pieces, k)
    );
}

// an uppercase letter (any script: Đ, Ế), or in LaTeX a macro or math in `\(…\)`/`\[…\]`
function startsSentence(p: Piece, src: string, tex: boolean): boolean {
    if (tex && src[p.s] === "\\" && /[a-zA-Z([]/.test(src[p.s + 1] ?? "")) {
        return true;
    }
    return PROSE_KINDS.has(p.token.kind) && /^\p{Lu}/u.test(p.token.text.replace(OPENERS, ""));
}

// pieces → sentences. `src` is the text the pieces' offsets index (the LaTeX scan reads a comment-masked copy of
// the file, same length, so offsets are the file's).
function sentencesOf(em: Emitter, src: string, tex: boolean): ProseSentence[] {
    const pieces = em.pieces;
    while (
        pieces.length > 0 &&
        pieces[pieces.length - 1].token.kind === "text" &&
        pieces[pieces.length - 1].token.text.trim() === ""
    ) {
        pieces.pop();
    }
    if (pieces.length > 0) {
        const last = pieces[pieces.length - 1].token;
        last.text = last.text.trimEnd();
    }
    const out: ProseSentence[] = [];
    let from = 0;
    for (let k = 0; k < pieces.length; k++) {
        const boundary =
            k === pieces.length - 1 || (endsSentence(pieces, k) && startsSentence(pieces[k + 1], src, tex));
        if (!boundary) {
            continue;
        }
        const group = pieces.slice(from, k + 1);
        from = k + 1;
        const tokens = group.map((p) => p.token);
        const text = tokensText(tokens);
        if (text !== "") {
            out.push({ tokens, text, source: { start: group[0].s, end: group[group.length - 1].e } });
        }
    }
    return out;
}

function placeholderParagraph(text: string, start: number, end: number): ProseParagraph {
    return { sentences: [{ tokens: [{ kind: "placeholder", text }], text, source: { start, end } }] };
}

function codeParagraph(code: string, start: number, end: number): ProseParagraph | null {
    const text = collapse(code);
    return text === ""
        ? null
        : { sentences: [{ tokens: [{ kind: "code", text: code }], text, source: { start, end } }] };
}

// ---------------------------------------------------------------------------------------------------------------
// LaTeX

// a comment's text is blanked to this, same length, so every offset into the masked copy is the file's
const MASK = "\u0001";
const HEADING_LEVEL: Record<string, number> = { section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
const NUMBERED_LEVELS = 3; // LaTeX's own secnumdepth: \paragraph and starred headings carry no number
const FLOATS: Record<string, string> = { figure: "Figure", "figure*": "Figure", table: "Table", "table*": "Table" };
const CODE_ENVS = new Set(["verbatim", "lstlisting", "minted"]);
// environments KaTeX renders by name; the token holds the whole \begin…\end so it can render them as they are
const MATH_ENVS = new Set(["equation", "equation*", "align", "align*", "gather", "gather*", "alignat", "alignat*"]);
// environments whose first braced argument is a spec, not prose
const ENV_SPEC = new Set(["tabular", "tabular*", "tabularx", "minipage", "multicols", "array", "wrapfigure"]);
const EM_MACROS = new Set(["emph", "textit", "textsl"]);
const CITE_MACRO = /^(?:cite[a-zA-Z]*|(?:paren|text|auto|foot|smart)cite[a-zA-Z]*)$/;
const REF_MACRO = /^(?:ref|autoref|eqref|cref|Cref|pageref|nameref|vref)$/;
// macros whose arguments are not prose: dropped with them
const DROP_MACROS = new Set([
    "label",
    "nocite",
    "usepackage",
    "documentclass",
    "input",
    "include",
    "includegraphics",
    "bibliography",
    "bibliographystyle",
    "addbibresource",
    "printbibliography",
    "newcommand",
    "renewcommand",
    "providecommand",
    "newenvironment",
    "DeclareMathOperator",
    "newtheorem",
    "theoremstyle",
    "setlength",
    "setcounter",
    "addtocounter",
    "vspace",
    "hspace",
    "pagestyle",
    "thispagestyle",
    "graphicspath",
    "hypersetup",
    "lstset",
    "captionsetup",
    "definecolor",
    "geometry",
    "bibitem",
    "index",
]);
const TEX_WORDS: Record<string, string> = { ldots: "…", dots: "…", LaTeX: "LaTeX", TeX: "TeX" };
const THIN_SPACES = new Set([",", ";", ":", " ", "\n", "\r", "\t"]);
const ESCAPED = new Set(["%", "&", "$", "#", "_", "{", "}"]);

function maskTexComments(src: string): string {
    let out = "";
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") {
            out += src.slice(i, i + 2);
            i += 2;
        } else if (ch === "%") {
            const nl = src.indexOf("\n", i);
            const end = nl < 0 ? src.length : nl;
            out += MASK.repeat(end - i);
            i = end;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

// the inside of the `{…}` at s[i] and the index after it, or null when s[i] is not `{` or it never closes before `limit`
function braceGroup(s: string, i: number, limit: number): { a: number; b: number; next: number } | null {
    if (s[i] !== "{") {
        return null;
    }
    let depth = 0;
    for (let j = i; j < limit; j++) {
        const ch = s[j];
        if (ch === "\\") {
            j++;
        } else if (ch === "{") {
            depth++;
        } else if (ch === "}" && --depth === 0) {
            return { a: i + 1, b: j, next: j + 1 };
        }
    }
    return null;
}

// the `[…]` at s[i] and the index after it, or null
function bracketGroup(s: string, i: number, limit: number): number | null {
    if (s[i] !== "[") {
        return null;
    }
    for (let j = i + 1; j < limit; j++) {
        if (s[j] === "\\") {
            j++;
        } else if (s[j] === "]") {
            return j + 1;
        } else if (s[j] === "{") {
            const g = braceGroup(s, j, limit);
            if (g) {
                j = g.next - 1;
            }
        }
    }
    return null;
}

// the arguments right after a macro name: any `[…]` and `{…}`, in order. With no braced argument none is consumed,
// so `\foo [1]` and `\ldots[2]` keep their brackets as text.
function texArgs(s: string, from: number, limit: number): { braced: { a: number; b: number }[]; next: number } {
    const braced: { a: number; b: number }[] = [];
    let i = from;
    if (s[i] === "*") {
        i++;
    }
    let next = from;
    for (;;) {
        const g = braceGroup(s, i, limit);
        if (g) {
            braced.push({ a: g.a, b: g.b });
            i = next = g.next;
            continue;
        }
        const o = bracketGroup(s, i, limit);
        if (o != null) {
            i = o;
            continue;
        }
        return { braced, next };
    }
}

function texPlain(s: string, a: number, b: number): string {
    const em = new Emitter();
    scanTex(s, a, b, em, PLAIN);
    return plainText(em);
}

function dollarClose(s: string, from: number, limit: number, double: boolean): number {
    for (let j = from; j < limit; j++) {
        if (s[j] === "\\") {
            j++;
        } else if (s[j] === "$" && (!double || s[j + 1] === "$")) {
            return j;
        }
    }
    return -1;
}

function texMath(em: Emitter, tex: string, display: boolean, start: number, end: number): void {
    const from = em.begin();
    const token: ProseToken = { kind: "math", text: tex.trim() };
    if (display) {
        token.display = true;
    }
    em.atom(token, start, end);
    em.end(from, start, end);
}

function scanTex(s: string, a: number, b: number, em: Emitter, st: Style): void {
    let i = a;
    while (i < b) {
        const ch = s[i];
        if (ch === MASK || ch === "{" || ch === "}") {
            i++;
        } else if (ch === "\\") {
            i = texMacro(s, i, b, em, st);
        } else if (ch === "$") {
            const double = s[i + 1] === "$";
            const close = dollarClose(s, i + (double ? 2 : 1), b, double);
            if (close > i + 1) {
                const end = close + (double ? 2 : 1);
                texMath(em, s.slice(i + (double ? 2 : 1), close), double, i, end);
                i = end;
            } else {
                em.word("$", st, i, i + 1);
                i++;
            }
        } else if (ch === "~" || WS.test(ch)) {
            em.space();
            i++;
        } else if (ch === "-" && s[i + 1] === "-") {
            const n = s[i + 2] === "-" ? 3 : 2;
            em.word(n === 3 ? "—" : "–", st, i, i + n);
            i += n;
        } else if ((ch === "`" || ch === "'") && s[i + 1] === ch) {
            em.word(ch === "`" ? "“" : "”", st, i, i + 2);
            i += 2;
        } else {
            em.word(ch, st, i, i + 1);
            i++;
        }
    }
}

// the macro at s[i] === "\\"; returns the index after it and its arguments
function texMacro(s: string, i: number, limit: number, em: Emitter, st: Style): number {
    const j = i + 1;
    if (j >= limit) {
        return limit;
    }
    const c = s[j];
    if (!/[a-zA-Z]/.test(c)) {
        if (THIN_SPACES.has(c) || c === "\\") {
            em.space();
        } else if (ESCAPED.has(c)) {
            em.word(c, st, i, j + 1);
        } else if (c === "(" || c === "[") {
            const closer = c === "(" ? "\\)" : "\\]";
            const close = s.indexOf(closer, j + 1);
            if (close >= 0 && close < limit) {
                texMath(em, s.slice(j + 1, close), c === "[", i, close + 2);
                return close + 2;
            }
        }
        return j + 1; // \- \/ \! and accent marks: the symbol goes, the letter it modifies stays
    }
    let k = j;
    while (k < limit && /[a-zA-Z]/.test(s[k])) {
        k++;
    }
    const name = s.slice(j, k);
    if (name === "begin" || name === "end") {
        return texEnvMarker(s, i, k, limit, name === "begin", em);
    }
    if (name === "item") {
        return k; // a list item starts its own paragraph (texParagraphs); a stray one is nothing
    }
    if (TEX_WORDS[name] !== undefined) {
        const from = em.begin();
        for (const ch of TEX_WORDS[name]) {
            em.word(ch, st, i, k);
        }
        em.end(from, i, k);
        return k;
    }
    const args = texArgs(s, k, limit);
    const last = args.braced[args.braced.length - 1];
    const end = args.next;
    const from = em.begin();
    if (CITE_MACRO.test(name) || REF_MACRO.test(name)) {
        if (last) {
            const keys = s
                .slice(last.a, last.b)
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);
            em.atom({ kind: CITE_MACRO.test(name) ? "cite" : "ref", text: `[${keys.join(", ")}]` }, i, end);
        }
    } else if (!DROP_MACROS.has(name) && last) {
        const style = EM_MACROS.has(name)
            ? { kind: "em" as const }
            : name === "textbf"
              ? { kind: "strong" as const }
              : name === "texttt"
                ? { kind: "code" as const }
                : st;
        scanTex(s, last.a, last.b, em, style);
    }
    em.end(from, i, end);
    return end;
}

// \begin{env} / \end{env} inside a paragraph: display math is one token; any other environment is transparent
function texEnvMarker(s: string, i: number, nameEnd: number, limit: number, begin: boolean, em: Emitter): number {
    const g = braceGroup(s, nameEnd, limit);
    if (!g) {
        return nameEnd;
    }
    const env = s.slice(g.a, g.b);
    if (!begin) {
        return g.next;
    }
    if (MATH_ENVS.has(env)) {
        const endMarker = `\\end{${env}}`;
        const close = s.indexOf(endMarker, g.next);
        if (close >= 0 && close < limit) {
            const end = close + endMarker.length;
            texMath(em, s.slice(i, end).replace(/\\label\{[^}]*\}/g, ""), true, i, end);
            return end;
        }
    }
    let next = g.next;
    const o = bracketGroup(s, next, limit);
    if (o != null) {
        next = o;
    }
    if (ENV_SPEC.has(env)) {
        const spec = braceGroup(s, next, limit);
        if (spec) {
            next = spec.next;
        }
    }
    return next;
}

type TexBlock =
    | { type: "text"; a: number; b: number }
    | { type: "heading"; level: number; numbered: boolean; a: number; b: number }
    | { type: "float"; label: string; a: number; b: number; caption: string }
    | { type: "code"; a: number; b: number; code: string };

function texBlocks(s: string, src: string, start: number, end: number): TexBlock[] {
    const blocks: TexBlock[] = [];
    let textStart = start;
    let i = start;
    const flush = (to: number) => {
        if (to > textStart) {
            blocks.push({ type: "text", a: textStart, b: to });
        }
    };
    while (i < end) {
        const k = s.indexOf("\\", i);
        if (k < 0 || k >= end) {
            break;
        }
        const m = /^[a-zA-Z]+/.exec(s.slice(k + 1, k + 40));
        if (!m) {
            i = k + 2;
            continue;
        }
        const name = m[0];
        const after = k + 1 + name.length;
        if (HEADING_LEVEL[name] !== undefined) {
            let p = after;
            const starred = s[p] === "*";
            if (starred) {
                p++;
            }
            const opt = bracketGroup(s, p, end);
            const g = braceGroup(s, opt ?? p, end);
            if (g) {
                flush(k);
                blocks.push({
                    type: "heading",
                    level: HEADING_LEVEL[name],
                    numbered: !starred && HEADING_LEVEL[name] <= NUMBERED_LEVELS,
                    a: g.a,
                    b: g.b,
                });
                i = textStart = g.next;
                continue;
            }
        } else if (name === "begin") {
            const g = braceGroup(s, after, end);
            const env = g ? s.slice(g.a, g.b) : "";
            if (g && (FLOATS[env] || CODE_ENVS.has(env))) {
                const endMarker = `\\end{${env}}`;
                const close = s.indexOf(endMarker, g.next);
                if (close >= 0 && close < end) {
                    flush(k);
                    const stop = close + endMarker.length;
                    if (FLOATS[env]) {
                        blocks.push({
                            type: "float",
                            label: FLOATS[env],
                            a: k,
                            b: stop,
                            caption: texCaption(s, g.next, close),
                        });
                    } else {
                        blocks.push({
                            type: "code",
                            a: k,
                            b: stop,
                            code: src.slice(g.next, close).replace(/^\s*\n|\s+$/g, ""),
                        });
                    }
                    i = textStart = stop;
                    continue;
                }
            }
        }
        i = after;
    }
    flush(end);
    return blocks;
}

function texCaption(s: string, from: number, to: number): string {
    const re = /\\caption(?![a-zA-Z])/g;
    re.lastIndex = from;
    const m = re.exec(s);
    if (!m || m.index >= to) {
        return "";
    }
    const args = texArgs(s, m.index + m[0].length, to);
    const last = args.braced[args.braced.length - 1];
    return last ? texPlain(s, last.a, last.b) : "";
}

// [start, end] ranges of the paragraphs in s[a, b): blank-line separated. A line that is only a comment neither
// breaks a paragraph nor makes one.
function texParagraphRanges(s: string, a: number, b: number): [number, number][] {
    const out: [number, number][] = [];
    let start = -1;
    let end = -1;
    let hasText = false;
    const flush = () => {
        if (start >= 0 && hasText) {
            out.push([start, end]);
        }
        start = -1;
        hasText = false;
    };
    for (let pos = a; pos < b; ) {
        let nl = s.indexOf("\n", pos);
        if (nl < 0 || nl > b) {
            nl = b;
        }
        const line = s.slice(pos, nl);
        if (/^\s*$/.test(line)) {
            flush();
        } else {
            if (start < 0) {
                start = pos;
            }
            end = nl;
            if (line.split(MASK).join("").trim() !== "") {
                hasText = true;
            }
        }
        pos = nl + 1;
    }
    flush();
    return out;
}

// split one paragraph range at its \item commands: what comes before is a paragraph, each item a list paragraph
function texItemRanges(s: string, a: number, b: number): { a: number; b: number; list: boolean }[] {
    const re = /(?<!\\)\\item(?![a-zA-Z])/g;
    const body = s.slice(a, b);
    const out: { a: number; b: number; list: boolean }[] = [];
    let prev = a;
    let list = false;
    for (let m = re.exec(body); m; m = re.exec(body)) {
        out.push({ a: prev, b: a + m.index, list });
        prev = a + m.index + m[0].length;
        list = true;
    }
    out.push({ a: prev, b, list });
    return out;
}

function texParagraphs(s: string, a: number, b: number): ProseParagraph[] {
    const out: ProseParagraph[] = [];
    for (const [pa, pb] of texParagraphRanges(s, a, b)) {
        for (const chunk of texItemRanges(s, pa, pb)) {
            const em = new Emitter();
            scanTex(s, chunk.a, chunk.b, em, PLAIN);
            const sentences = sentencesOf(em, s, true);
            if (sentences.length > 0) {
                out.push(chunk.list ? { sentences, list: true } : { sentences });
            }
        }
    }
    return out;
}

// what an \author argument carries besides the name, removed with its arguments
const AUTHOR_EXTRAS =
    /\\(?:thanks|affiliation|additionalaffiliation|institution|email|orcid|inst|authornote|footnote|IEEEauthorrefmark)(?![a-zA-Z])/g;

// The document's authors as plain names, in order: every \author{…} (acmart takes one per person; article joins
// them with \and), with \thanks, affiliations and e-mails dropped and only the first line of each kept, since the
// lines after a \\ name the affiliation. Commented-out authors are ignored.
export function texAuthors(src: string): string[] {
    const s = maskTexComments(src);
    const names: string[] = [];
    const authorRe = /\\author(?![a-zA-Z])/g;
    for (let m = authorRe.exec(s); m != null; m = authorRe.exec(s)) {
        const arg = texArgs(s, m.index + m[0].length, s.length).braced.at(-1);
        if (arg == null) {
            continue;
        }
        let inner = s.slice(arg.a, arg.b);
        AUTHOR_EXTRAS.lastIndex = 0;
        for (let x = AUTHOR_EXTRAS.exec(inner); x != null; x = AUTHOR_EXTRAS.exec(inner)) {
            const next = texArgs(inner, x.index + x[0].length, inner.length).next;
            inner = inner.slice(0, x.index) + " ".repeat(next - x.index) + inner.slice(next);
        }
        for (const part of inner.split(/\\and(?![a-zA-Z])/)) {
            const first = part.split("\\\\")[0];
            const name = texPlain(first, 0, first.length).replace(/\s+/g, " ").trim();
            if (name !== "") {
                names.push(name);
            }
        }
    }
    return names;
}

function texSections(src: string): ProseSection[] {
    const s = maskTexComments(src);
    const titleAt = /\\title(?![a-zA-Z])/.exec(s);
    const titleArgs = titleAt ? texArgs(s, titleAt.index + titleAt[0].length, s.length) : null;
    const titleArg = titleArgs?.braced[titleArgs.braced.length - 1];
    const docTitle = titleArg ? texPlain(s, titleArg.a, titleArg.b) : "";

    const beginDoc = s.indexOf("\\begin{document}");
    const start = beginDoc < 0 ? 0 : beginDoc + "\\begin{document}".length;
    const endDoc = s.indexOf("\\end{document}", start);
    const end = endDoc < 0 ? s.length : endDoc;

    const sections: ProseSection[] = [];
    const counters = [0, 0, 0];
    let cur: ProseSection | null = null;
    const current = () => {
        if (!cur) {
            const title = docTitle || FRONT_MATTER;
            cur = { level: 0, title, label: cutLabel(title), paragraphs: [] };
            sections.push(cur);
        }
        return cur;
    };
    for (const block of texBlocks(s, src, start, end)) {
        if (block.type === "heading") {
            const title = texPlain(s, block.a, block.b);
            let label = cutLabel(title);
            if (block.numbered) {
                counters[block.level - 1]++;
                counters.fill(0, block.level);
                label = "§" + counters.slice(0, block.level).join(".");
            }
            cur = { level: block.level, title, label, paragraphs: [] };
            sections.push(cur);
        } else if (block.type === "text") {
            const paragraphs = texParagraphs(s, block.a, block.b);
            if (paragraphs.length > 0) {
                current().paragraphs.push(...paragraphs);
            }
        } else if (block.type === "float") {
            const text = block.caption ? `[${block.label}: ${block.caption}]` : `[${block.label}]`;
            current().paragraphs.push(placeholderParagraph(text, block.a, block.b));
        } else {
            const p = codeParagraph(block.code, block.a, block.b);
            if (p) {
                current().paragraphs.push(p);
            }
        }
    }
    return sections;
}

// ---------------------------------------------------------------------------------------------------------------
// markdown

const MD_PUNCT = /[\\`*_{}[\]()#+\-.!|~<>$]/;

// the first run of exactly n `ch` in s[from, to), or -1
function findRun(s: string, ch: string, n: number, from: number, to: number): number {
    for (let j = from; j < to; ) {
        if (s[j] !== ch) {
            j++;
            continue;
        }
        let m = 1;
        while (j + m < to && s[j + m] === ch) {
            m++;
        }
        if (m === n) {
            return j;
        }
        j += m;
    }
    return -1;
}

// the run of n `ch` that closes an emphasis opened before `from`, skipping escapes and code spans
function emphasisClose(s: string, ch: string, n: number, from: number, to: number): number {
    for (let j = from; j < to; ) {
        const c = s[j];
        if (c === "\\") {
            j += 2;
        } else if (c === "`") {
            let m = 1;
            while (j + m < to && s[j + m] === "`") {
                m++;
            }
            const close = findRun(s, "`", m, j + m, to);
            j = close < 0 ? j + m : close + m;
        } else if (c === ch) {
            let m = 1;
            while (j + m < to && s[j + m] === ch) {
                m++;
            }
            if (m === n && j > from && !WS.test(s[j - 1]) && (ch === "*" || !ALNUM.test(s[j + m] ?? ""))) {
                return j;
            }
            j += m;
        } else {
            j++;
        }
    }
    return -1;
}

// `[text](dest)` at s[i] === "[": the text's range, the destination, the index after, or null
function mdLink(s: string, i: number, limit: number): { a: number; b: number; href: string; next: number } | null {
    let depth = 0;
    let close = -1;
    for (let j = i; j < limit; j++) {
        if (s[j] === "\\") {
            j++;
        } else if (s[j] === "[") {
            depth++;
        } else if (s[j] === "]" && --depth === 0) {
            close = j;
            break;
        }
    }
    if (close < 0 || s[close + 1] !== "(") {
        return null;
    }
    let parens = 0;
    let end = -1;
    for (let j = close + 1; j < limit; j++) {
        if (s[j] === "\\") {
            j++;
        } else if (s[j] === "(") {
            parens++;
        } else if (s[j] === ")" && --parens === 0) {
            end = j;
            break;
        }
    }
    if (end < 0) {
        return null;
    }
    // a destination may hold spaces (notes exported from Obsidian do); only a quoted title after it is not part of it
    const dest = s.slice(close + 2, end).trim();
    const href =
        dest.startsWith("<") && dest.includes(">")
            ? dest.slice(1, dest.indexOf(">"))
            : dest.replace(/\s+(?:"[^"]*"|'[^']*')$/, "");
    return { a: i + 1, b: close, href, next: end + 1 };
}

function mdPlain(s: string, a: number, b: number): string {
    const em = new Emitter();
    scanMd(s, a, b, em, PLAIN);
    return plainText(em);
}

function mdMath(s: string, i: number, limit: number): { tex: string; display: boolean; next: number } | null {
    if (s[i + 1] === "$") {
        const close = s.indexOf("$$", i + 2);
        return close >= 0 && close < limit ? { tex: s.slice(i + 2, close), display: true, next: close + 2 } : null;
    }
    if (i + 1 >= limit || WS.test(s[i + 1])) {
        return null;
    }
    for (let j = i + 1; j < limit; j++) {
        if (s[j] === "\\") {
            j++;
        } else if (s[j] === "$" && !WS.test(s[j - 1]) && !/\d/.test(s[j + 1] ?? "")) {
            return { tex: s.slice(i + 1, j), display: false, next: j + 1 };
        }
    }
    return null;
}

function scanMd(s: string, a: number, b: number, em: Emitter, st: Style): void {
    const nested = (kind: TokenKind): Style => (st.kind === "link" ? st : { kind });
    let i = a;
    while (i < b) {
        const ch = s[i];
        if (ch === "\\" && i + 1 < b && MD_PUNCT.test(s[i + 1])) {
            em.word(s[i + 1], st, i, i + 2);
            i += 2;
        } else if (ch === "`") {
            let n = 1;
            while (i + n < b && s[i + n] === "`") {
                n++;
            }
            const close = findRun(s, "`", n, i + n, b);
            if (close < 0) {
                for (let k = 0; k < n; k++) {
                    em.word("`", st, i + k, i + k + 1);
                }
                i += n;
                continue;
            }
            const from = em.begin();
            for (let k = i + n; k < close; k++) {
                if (WS.test(s[k])) {
                    em.space();
                } else {
                    em.word(s[k], { kind: "code" }, k, k + 1);
                }
            }
            em.end(from, i, close + n);
            i = close + n;
        } else if (ch === "!" && s[i + 1] === "[") {
            const link = mdLink(s, i + 1, b);
            if (!link) {
                em.word("!", st, i, i + 1);
                i++;
                continue;
            }
            const from = em.begin();
            em.atom({ kind: "image", text: mdPlain(s, link.a, link.b), href: link.href }, i, link.next);
            em.end(from, i, link.next);
            i = link.next;
        } else if (ch === "[") {
            const link = mdLink(s, i, b);
            if (!link) {
                em.word("[", st, i, i + 1);
                i++;
                continue;
            }
            const from = em.begin();
            scanMd(s, link.a, link.b, em, { kind: "link", href: link.href });
            em.end(from, i, link.next);
            i = link.next;
        } else if (ch === "<" && /^<https?:\/\/[^>\s]+>/.test(s.slice(i, b))) {
            const close = s.indexOf(">", i);
            const from = em.begin();
            scanMd(s, i + 1, close, em, { kind: "link", href: s.slice(i + 1, close) });
            em.end(from, i, close + 1);
            i = close + 1;
        } else if (ch === "$") {
            const m = mdMath(s, i, b);
            if (!m) {
                em.word("$", st, i, i + 1);
                i++;
                continue;
            }
            const from = em.begin();
            const token: ProseToken = { kind: "math", text: m.tex.trim() };
            if (m.display) {
                token.display = true;
            }
            em.atom(token, i, m.next);
            em.end(from, i, m.next);
            i = m.next;
        } else if (ch === "*" || ch === "_") {
            let n = 1;
            while (i + n < b && s[i + n] === ch) {
                n++;
            }
            const prev = i > a ? s[i - 1] : "";
            const opens = n <= 3 && i + n < b && !WS.test(s[i + n]) && (ch === "*" || !(prev && ALNUM.test(prev)));
            const close = opens ? emphasisClose(s, ch, n, i + n, b) : -1;
            if (close < 0) {
                for (let k = 0; k < n; k++) {
                    em.word(ch, st, i + k, i + k + 1);
                }
                i += n;
                continue;
            }
            const from = em.begin();
            scanMd(s, i + n, close, em, nested(n === 1 ? "em" : "strong"));
            em.end(from, i, close + n);
            i = close + n;
        } else if (WS.test(ch)) {
            em.space();
            i++;
        } else {
            em.word(ch, st, i, i + 1);
            i++;
        }
    }
}

type MdBlock =
    | { type: "heading"; level: number; a: number; b: number }
    | { type: "para"; a: number; b: number; list: boolean }
    | { type: "code"; a: number; b: number; code: string }
    | { type: "table"; a: number; b: number; header: string[] };

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^( {0,3})(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(?=\S)/;
const QUOTE = /^(?: {0,3}> ?)+/;
const IMAGE_ONLY = /^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*$/;
const TABLE_DELIM = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

// the file as blocks, plus a copy with list markers and quote arrows blanked (same length), which the inline scan reads
function mdBlocks(src: string): { blocks: MdBlock[]; masked: string } {
    const blocks: MdBlock[] = [];
    const masks: [number, number][] = [];
    const lines: { start: number; text: string }[] = [];
    for (let pos = 0; pos <= src.length; ) {
        let nl = src.indexOf("\n", pos);
        if (nl < 0) {
            nl = src.length;
        }
        lines.push({ start: pos, text: src.slice(pos, nl).replace(/\r$/, "") });
        pos = nl + 1;
    }
    // the paragraph being read; `as` because TS cannot see that `flush` and the loop reassign it
    let cur = null as { a: number; b: number; list: boolean } | null;
    const flush = () => {
        if (cur) {
            blocks.push({ type: "para", ...cur });
        }
        cur = null;
    };
    const first =
        lines[0]?.text.trimEnd() === "---"
            ? lines.findIndex((l, n) => n > 0 && /^(?:---|\.\.\.)\s*$/.test(l.text))
            : -1;
    for (let n = first < 0 ? 0 : first + 1; n < lines.length; n++) {
        const { start, text } = lines[n];
        const end = start + text.trimEnd().length;
        let fence = FENCE.exec(text);
        if (fence && fence[1][0] === "`" && fence[2].includes("`")) {
            fence = null;
        }
        if (fence) {
            flush();
            const marker = fence[1];
            let close = n + 1;
            while (
                close < lines.length &&
                !new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`).test(
                    lines[close].text
                )
            ) {
                close++;
            }
            const last = Math.min(close, lines.length - 1);
            const code = lines
                .slice(n + 1, close)
                .map((l) => l.text)
                .join("\n");
            blocks.push({ type: "code", a: start, b: lines[last].start + lines[last].text.trimEnd().length, code });
            n = last;
            continue;
        }
        if (/^\s*$/.test(text)) {
            flush();
            continue;
        }
        const atx = ATX.exec(text);
        if (atx) {
            flush();
            const a =
                start +
                atx[1].length +
                atx[2].length +
                /^[ \t]+/.exec(text.slice(atx[1].length + atx[2].length))![0].length;
            blocks.push({ type: "heading", level: atx[2].length, a, b: a + atx[3].length });
            continue;
        }
        if (THEMATIC.test(text)) {
            flush();
            continue;
        }
        if (
            text.includes("|") &&
            lines[n + 1] &&
            lines[n + 1].text.includes("|") &&
            TABLE_DELIM.test(lines[n + 1].text)
        ) {
            flush();
            let last = n + 1;
            while (
                last + 1 < lines.length &&
                lines[last + 1].text.includes("|") &&
                !/^\s*$/.test(lines[last + 1].text)
            ) {
                last++;
            }
            const header = text
                .split("|")
                .map((c) => c.trim())
                .filter(Boolean);
            blocks.push({ type: "table", a: start, b: lines[last].start + lines[last].text.trimEnd().length, header });
            n = last;
            continue;
        }
        const item = LIST_ITEM.exec(text);
        if (item) {
            flush();
            const contentStart = start + item[0].length;
            masks.push([start, contentStart]);
            cur = { a: contentStart, b: end, list: true };
            continue;
        }
        let from = start;
        const quote = QUOTE.exec(text);
        if (quote) {
            masks.push([start, start + quote[0].length]);
            from = start + quote[0].length;
        }
        if (IMAGE_ONLY.test(text.slice(from - start))) {
            flush();
            blocks.push({
                type: "para",
                a: from + /^[ \t]*/.exec(text.slice(from - start))![0].length,
                b: end,
                list: false,
            });
            continue;
        }
        if (cur) {
            cur.b = end;
        } else {
            cur = { a: from + /^[ \t]*/.exec(text.slice(from - start))![0].length, b: end, list: false };
        }
    }
    flush();
    let masked = "";
    let at = 0;
    for (const [a, b] of masks) {
        masked += src.slice(at, a) + " ".repeat(b - a);
        at = b;
    }
    return { blocks, masked: masked + src.slice(at) };
}

const MD_ENUMERATOR = /^\d+(?:\.\d+)*\.?(?=\s)/;

function mdSections(src: string): ProseSection[] {
    const { blocks, masked } = mdBlocks(src);
    const sections: ProseSection[] = [];
    let cur: ProseSection | null = null;
    const current = () => {
        if (!cur) {
            cur = { level: 0, title: FRONT_MATTER, label: cutLabel(FRONT_MATTER), paragraphs: [] };
            sections.push(cur);
        }
        return cur;
    };
    for (const block of blocks) {
        if (block.type === "heading") {
            const text = mdPlain(masked, block.a, block.b);
            const enumerator = MD_ENUMERATOR.exec(text)?.[0];
            const title = enumerator ? text.slice(enumerator.length).trim() || text : text;
            cur = { level: block.level, title, label: enumerator ?? cutLabel(text), paragraphs: [] };
            sections.push(cur);
        } else if (block.type === "para") {
            const em = new Emitter();
            scanMd(masked, block.a, block.b, em, PLAIN);
            const sentences = sentencesOf(em, masked, false);
            if (sentences.length > 0) {
                current().paragraphs.push(block.list ? { sentences, list: true } : { sentences });
            }
        } else if (block.type === "table") {
            current().paragraphs.push(placeholderParagraph(`[Table: ${block.header.join(", ")}]`, block.a, block.b));
        } else {
            const p = codeParagraph(block.code, block.a, block.b);
            if (p) {
                current().paragraphs.push(p);
            }
        }
    }
    return sections;
}
