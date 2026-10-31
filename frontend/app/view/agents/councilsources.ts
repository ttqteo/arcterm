// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what a council message's evidence draws and what the Sources panel shows (A-links-panel.dc.html in the
// council-evidence-chips canvas). A message's `path:line` refs fold into one link per file, named by the shortest tail
// of its path no other link shares, its cited lines after it (`:45, 49`); a click opens the panel on that file, which
// shows the cited lines lit with one line of context each side, runs that touch merged. No React, no Wave runtime imports.

/** A run of cited lines, 1-based and inclusive. */
export interface CitedLines {
    start: number;
    end: number;
}

/** A ref the expert wrote, read as a file and its lines. */
export interface SourceRef {
    path: string; // as cited, `\` turned to `/` and a leading `./` dropped
    lines: CitedLines | null; // null when it names no line
}

/** One file a message cites, with every line it cites there. */
export interface SourceGroup {
    path: string;
    name: string; // the file name, or more of its tail when another group's file has the same name
    lines: CitedLines[]; // ascending, each run once
    label: string; // the lines as the link reads them after the name: `:45, 49`, `:12–20`, or "" for none
}

/** A message's evidence, as its links draw it: the files, then whatever is not a file (a screenshot region) as cited. */
export interface EvidenceView {
    groups: SourceGroup[];
    others: string[];
}

/** One line of a file in the panel. */
export interface SourceRow {
    n: number;
    text: string;
    cited: boolean;
}

/** A run of lines the panel shows together. */
export interface SourceHunk {
    start: number;
    end: number;
    rows: SourceRow[];
    cut: boolean; // a cited run longer than MAX_HUNK_ROWS, shown only to that many rows
}

export interface SourceExcerpt {
    hunks: SourceHunk[];
    pastEnd: number[]; // cited lines the file no longer reaches
    lineCount: number;
}

/** A file cited with no line shows this many of its first lines. */
export const HEAD_ROWS = 40;
/** The most rows one hunk draws, so a ref like `a.ts:1-5000` cannot draw the whole file. */
export const MAX_HUNK_ROWS = 120;

const REF = /^(.+?):(\d+)(?::\d+)?(?:\s*[-–]\s*(\d+))?$/;

/** Pure: a cited `path:line`, `path:line:col`, `path:start-end` or bare `path`; null for a screenshot region or nothing. */
export function parseSourceRef(ref: string): SourceRef | null {
    const s = ref.trim();
    if (s === "" || s.startsWith("screenshot:")) {
        return null;
    }
    const m = REF.exec(s);
    if (m == null) {
        return { path: cleanPath(s), lines: null };
    }
    const a = Number(m[2]);
    const b = m[3] != null ? Number(m[3]) : a;
    if (a < 1 || b < 1) {
        return { path: cleanPath(m[1]), lines: null };
    }
    return { path: cleanPath(m[1]), lines: { start: Math.min(a, b), end: Math.max(a, b) } };
}

function cleanPath(p: string): string {
    return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Pure: a message's evidence refs folded into one group per file, in the order each file is first cited. */
export function groupSources(refs: readonly string[]): EvidenceView {
    const byPath = new Map<string, CitedLines[]>();
    const others: string[] = [];
    for (const ref of refs) {
        const r = parseSourceRef(ref);
        if (r == null) {
            if (ref.trim() !== "") {
                others.push(ref.trim());
            }
            continue;
        }
        const lines = byPath.get(r.path) ?? [];
        if (r.lines != null && !lines.some((l) => l.start === r.lines.start && l.end === r.lines.end)) {
            lines.push(r.lines);
        }
        byPath.set(r.path, lines);
    }
    const paths = [...byPath.keys()];
    const names = shortNames(paths);
    const groups = paths.map((path, i) => {
        const lines = [...byPath.get(path)].sort((x, y) => x.start - y.start || x.end - y.end);
        return { path, name: names[i], lines, label: linesLabel(lines) };
    });
    return { groups, others };
}

/** Pure: `:45, 49` for the cited lines, a run as `12–20`; "" when there are none. */
export function linesLabel(lines: readonly CitedLines[]): string {
    if (lines.length === 0) {
        return "";
    }
    return ":" + lines.map((l) => (l.start === l.end ? `${l.start}` : `${l.start}–${l.end}`)).join(", ");
}

// each path's file name, with as many of its folders as it takes for no two to read the same
function shortNames(paths: readonly string[]): string[] {
    const parts = paths.map((p) => p.split("/").filter((s) => s !== ""));
    const depth = paths.map(() => 1);
    const name = (i: number) => parts[i].slice(-depth[i]).join("/") || paths[i];
    for (let round = 0; round < 64; round++) {
        const seen = new Map<string, number[]>();
        paths.forEach((_, i) => seen.set(name(i), [...(seen.get(name(i)) ?? []), i]));
        let grew = false;
        for (const same of seen.values()) {
            if (same.length < 2) {
                continue;
            }
            for (const i of same) {
                if (depth[i] < parts[i].length) {
                    depth[i]++;
                    grew = true;
                }
            }
        }
        if (!grew) {
            break;
        }
    }
    return paths.map((_, i) => name(i));
}

/** Pure: the folder part of a cited path, with its trailing `/`; "" for a file at the project's root. */
export function sourceDir(path: string): string {
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i + 1);
}

/** Pure: where a cited path is on disk: as written when absolute, else under the council's project folder. */
export function sourceFilePath(project: string, path: string): string {
    if (/^([A-Za-z]:\/|\/|~)/.test(path)) {
        return path;
    }
    const root = project.replace(/[\\/]+$/, "");
    return root === "" ? path : `${root}/${path}`;
}

/** Pure: the lines of `text` the panel shows for `lines`: each cited run with `context` lines each side, runs that
 *  overlap or touch merged into one hunk. With no cited line it is the file's first HEAD_ROWS lines. */
export function sourceExcerpt(text: string, lines: readonly CitedLines[], context = 1): SourceExcerpt {
    const all = text.split(/\r?\n/);
    if (all.length > 1 && all[all.length - 1] === "") {
        all.pop();
    }
    const lineCount = all.length;
    const pastEnd: number[] = [];
    const cited: (CitedLines & { cut: boolean })[] = [];
    for (const l of lines) {
        if (l.start > lineCount) {
            pastEnd.push(l.start);
            continue;
        }
        const want = Math.min(l.end, lineCount);
        const end = Math.min(want, l.start + MAX_HUNK_ROWS - 1);
        cited.push({ start: l.start, end, cut: end < want });
    }
    const isCited = (n: number) => cited.some((c) => n >= c.start && n <= c.end);
    const row = (n: number): SourceRow => ({ n, text: all[n - 1], cited: isCited(n) });
    const span = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => row(start + i));
    if (lines.length === 0) {
        const end = Math.min(lineCount, HEAD_ROWS);
        return { hunks: [{ start: 1, end, rows: span(1, end), cut: false }], pastEnd, lineCount };
    }
    const windows = cited
        .map((c) => ({
            start: Math.max(1, c.start - context),
            end: Math.min(lineCount, c.end + context),
            cut: c.cut,
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: { start: number; end: number; cut: boolean }[] = [];
    for (const w of windows) {
        const last = merged[merged.length - 1];
        if (last != null && w.start <= last.end + 1) {
            last.end = Math.max(last.end, w.end);
            last.cut = last.cut || w.cut;
        } else {
            merged.push({ ...w });
        }
    }
    return {
        hunks: merged.map((m) => ({ start: m.start, end: m.end, rows: span(m.start, m.end), cut: m.cut })),
        pastEnd,
        lineCount,
    };
}

/** Pure: the line under the hunks when cited lines are past the file's end, which means it changed since the council
 *  ran; "" when none is. */
export function pastEndWords(x: SourceExcerpt): string {
    if (x.pastEnd.length === 0) {
        return "";
    }
    const many = x.pastEnd.length > 1;
    return `${many ? "Lines" : "Line"} ${x.pastEnd.join(", ")} ${many ? "are" : "is"} past the end of the file (${x.lineCount} lines): it has changed since the council ran.`;
}

/** Pure: a hunk's heading: `Line 12` or `Lines 44–46`. */
export function hunkLabel(h: { start: number; end: number }): string {
    return h.start === h.end ? `Line ${h.start}` : `Lines ${h.start}–${h.end}`;
}
