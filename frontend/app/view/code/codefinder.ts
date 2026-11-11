// frontend/app/view/code/codefinder.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: rank repo-relative paths against a query for the Code surface's file finder. Reuses the
// command palette's matcher rather than growing a second fuzzy implementation.

import { fuzzyScore } from "@/app/cockpit/palette-match";

export interface FinderMatch {
    path: string;
    score: number;
}

// a basename hit is almost always what you meant. fuzzyScore reports no matched span, so this
// cannot be a bonus applied to part of the full-path score — basename is scored separately and
// the better of the two wins.
const BASENAME_BONUS = 20;
// and a basename that STARTS with what you typed beats one that merely contains it somewhere:
// "code" must lead with code/codestore.ts, not with a dated design doc whose title has "code" in
// the middle of it.
const PREFIX_BONUS = 15;

interface Scored {
    path: string;
    base: string;
    score: number;
}

// One term against one path. null when the term does not appear at all — every term has to land
// somewhere, so a single null drops the path.
function scoreTerm(term: string, path: string, base: string): number | null {
    const baseScore = fuzzyScore(term, base);
    const pathScore = fuzzyScore(term, path);
    let score: number | null = null;
    if (baseScore != null) {
        score = baseScore + BASENAME_BONUS + (base.toLowerCase().startsWith(term) ? PREFIX_BONUS : 0);
    }
    if (pathScore != null && (score == null || pathScore > score)) {
        score = pathScore;
    }
    return score;
}

// recent: most recent first. It only shapes the empty query — the file you just left is the likeliest
// next open, and an alphabetical head of the index is the least likely.
export function rankPaths(
    query: string,
    paths: readonly string[],
    limit: number,
    recent: readonly string[] = []
): FinderMatch[] {
    // Whitespace splits terms, ANDed in any order — no path contains a space, so matching one
    // literally meant every multi-word query ("usage stats") returned nothing at all.
    const terms = query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t !== "");
    if (terms.length === 0) {
        return emptyQuery(paths, limit, recent);
    }
    const out: Scored[] = [];
    for (const path of paths) {
        const slash = path.lastIndexOf("/");
        const base = slash === -1 ? path : path.slice(slash + 1);
        let total = 0;
        let matched = true;
        for (const term of terms) {
            const score = scoreTerm(term, path, base);
            if (score == null) {
                matched = false;
                break;
            }
            total += score;
        }
        if (matched) {
            out.push({ path, base, score: total });
        }
    }
    // Shorter basename first on a tie: "codefinder" scores the same against codefinder.ts and
    // codefinder.test.ts, and the file itself is what you asked for, not its test.
    out.sort((a, b) => b.score - a.score || a.base.length - b.base.length || a.path.localeCompare(b.path));
    return out.slice(0, limit).map(({ path, score }) => ({ path, score }));
}

// a recent file the index no longer lists was deleted or renamed, and offering it would open a dead end
function emptyQuery(paths: readonly string[], limit: number, recent: readonly string[]): FinderMatch[] {
    const known = recent.length === 0 ? null : new Set(paths);
    const head = recent.filter((p) => known?.has(p));
    const headSet = new Set(head);
    const out = head.slice(0, limit);
    for (const path of paths) {
        if (out.length >= limit) {
            break;
        }
        if (!headSet.has(path)) {
            out.push(path);
        }
    }
    return out.map((path) => ({ path, score: 0 }));
}

export interface FinderQuery {
    text: string;
    line?: number;
    symbol?: boolean; // a leading "@": rank the open file's symbols, not paths
}

// A trailing ":<digits>" is a line. Reusing the finder for this is why there is no second overlay
// and no Ctrl+G dialog. A trailing colon with nothing after it is someone mid-keystroke, so it
// stays part of the text.
const LINE_SUFFIX = /:(\d+)$/;

// A leading "@" asks for symbols, the convention VS Code set. It carries no line: a symbol is the line.
export function parseFinderQuery(raw: string): FinderQuery {
    const q = raw.trim();
    if (q.startsWith("@")) {
        return { text: q.slice(1).trim(), symbol: true };
    }
    return parsePathQuery(q);
}

// The query as a path and an optional line, with no symbol mode: a leading "@" stays part of the text. The
// palette's Files scope ranks paths with it, so a path typed with an "@" there reads as it always did.
export function parsePathQuery(raw: string): FinderQuery {
    const q = raw.trim();
    const m = LINE_SUFFIX.exec(q);
    if (m == null) {
        return { text: q };
    }
    return { text: q.slice(0, m.index), line: parseInt(m[1], 10) };
}
