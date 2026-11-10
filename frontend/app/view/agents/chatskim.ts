// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Skim highlights in Chat, the pure half (chatskimstore.ts reads the file and holds the toggle). The skim mod
// (claude/skim-mod) strips the ==…== marks from a Claude reply before Claude Code stores it and keeps the marked
// sentences apart in its plugin store, under the hash of the stored text: `{ highlightMarks: [[hash, [sentence, …]], …] }`.
// Chat reads the transcript, so it never sees a mark; it finds them by the hash of each prose part's text, then puts the
// ==…== back around each sentence so CouncilText draws them as the terminal does. hashText mirrors the mod's
// (claude/skim-mod/hooks/highlight-core.ts hashText): `claude/` is outside the frontend's tsconfig, so it is copied, and
// chatskim.test.ts pins vectors computed with the mod's own function, so a drift fails there.

// FNV-1a over the stored text, the key the marks are kept under once the reply is stored without them
export function hashText(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0") + text.length.toString(16);
}

// the stored marks of every reply, by hash: each file's `highlightMarks` entries that are a [string, string[]] pair, a
// later file winning a hash two share; a file that is not JSON or not that shape adds nothing
export function marksByHash(files: readonly string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const file of files) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(file);
        } catch {
            continue;
        }
        const rows = (parsed as { highlightMarks?: unknown } | null)?.highlightMarks;
        if (!Array.isArray(rows)) {
            continue;
        }
        for (const row of rows) {
            if (
                Array.isArray(row) &&
                typeof row[0] === "string" &&
                Array.isArray(row[1]) &&
                row[1].every((m) => typeof m === "string")
            ) {
                out.set(row[0], row[1] as string[]);
            }
        }
    }
    return out;
}

// whether two maps hold the same hashes with the same sentence lists, so an unchanged store sets nothing
export function sameMarks(a: ReadonlyMap<string, string[]>, b: ReadonlyMap<string, string[]>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [hash, marks] of a) {
        const other = b.get(hash);
        if (other == null || other.length !== marks.length || other.some((m, i) => m !== marks[i])) {
            return false;
        }
    }
    return true;
}

type Range = readonly [start: number, end: number];

const FENCE = /^\s*(```|~~~)/;

// a fenced block's span, from its opening line to the end of its closing line (to the end of the text when it never
// closes); the mod toggles on the same lines
function fenceRanges(text: string): Range[] {
    const out: Range[] = [];
    let pos = 0;
    let open = -1;
    for (const line of text.split("\n")) {
        const end = pos + line.length;
        if (FENCE.test(line)) {
            if (open < 0) {
                open = pos;
            } else {
                out.push([open, end]);
                open = -1;
            }
        }
        pos = end + 1;
    }
    if (open >= 0) {
        out.push([open, text.length]);
    }
    return out;
}

// an inline code span, backticks included: a run of n backticks closes on the next run of exactly n, within the
// paragraph and outside a fence; a run that never closes is literal text
function codeRanges(text: string, fences: readonly Range[]): Range[] {
    const out: Range[] = [];
    let i = 0;
    while (i < text.length) {
        const fence = fences.find(([s, e]) => i >= s && i < e);
        if (fence != null) {
            i = fence[1];
            continue;
        }
        if (text[i] !== "`") {
            i++;
            continue;
        }
        let n = 1;
        while (text[i + n] === "`") {
            n++;
        }
        const nextFence = fences.find(([s]) => s > i)?.[0] ?? text.length;
        const blank = text.slice(i).search(/\n[ \t]*\n/);
        const limit = Math.min(nextFence, blank < 0 ? text.length : i + blank);
        let close = -1;
        for (let j = i + n; j < limit; ) {
            if (text[j] !== "`") {
                j++;
                continue;
            }
            let m = 1;
            while (text[j + m] === "`") {
                m++;
            }
            if (m === n) {
                close = j;
                break;
            }
            j += m;
        }
        if (close < 0) {
            i += n;
            continue;
        }
        out.push([i, close + n]);
        i = close + n;
    }
    return out;
}

function inside(ranges: readonly Range[], at: number): boolean {
    return ranges.some(([s, e]) => at >= s && at < e);
}

function overlaps(ranges: readonly Range[], start: number, end: number): boolean {
    return ranges.some(([s, e]) => start < e && end > s);
}

// Puts ==…== around each marked sentence: its first occurrence that lies outside a fenced block, does not begin or end
// inside an inline code span (a sentence may hold a whole span, as the mod's marks do) and is not already inside a ==…==.
// A sentence that is not found is left; no marks leaves the text as it was.
export function withMarks(text: string, marks: readonly string[]): string {
    let out = text;
    for (const raw of marks) {
        const mark = raw.trim();
        if (mark === "") {
            continue;
        }
        const fences = fenceRanges(out);
        const code = codeRanges(out, fences);
        const marked: Range[] = [];
        for (const m of out.matchAll(/==[^=\n]+==/g)) {
            if (!inside(fences, m.index) && !inside(code, m.index)) {
                marked.push([m.index, m.index + m[0].length]);
            }
        }
        const barred = [...fences, ...marked];
        for (let at = out.indexOf(mark); at >= 0; at = out.indexOf(mark, at + 1)) {
            const end = at + mark.length;
            if (!overlaps(barred, at, end) && !inside(code, at) && !inside(code, end - 1)) {
                out = `${out.slice(0, at)}==${mark}==${out.slice(end)}`;
                break;
            }
        }
    }
    return out;
}

// the store's size cap: the file holds at most 500 replies' sentences, far under this; a bigger one is not the skim mod's
const MAX_STORE_BYTES = 2 * 1024 * 1024;

// the skim mod's store files in a listing of ~/.claude/plugins/store, in listed order. The suffix after `skim_` varies
// by install, so they are found by name.
export function skimStoreFiles(entries: readonly { name: string; size: number; isdir?: boolean }[]): string[] {
    return entries
        .filter((e) => e.name.startsWith("skim_") && e.name.endsWith(".json") && !e.isdir && e.size <= MAX_STORE_BYTES)
        .map((e) => e.name);
}

// the toggle's stored value: on unless it says false
export function parseSkimOn(raw: string | null): boolean {
    return raw !== "false";
}
