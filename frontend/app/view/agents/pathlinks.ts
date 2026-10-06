// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// File paths in plain text: what the terminal's path links, the transcript's inline-code links and the File tab
// resolve. Pure: no React, no Wave runtime.

export interface PathCandidate {
    text: string; // what the link covers, suffix included: "src/a.ts:12:5"
    start: number; // offset of text in the line
    end: number; // exclusive
    path: string; // the path alone: "src/a.ts"
    line?: number;
    col?: number;
}

// a URL is never a path; it is blanked to spaces so offsets hold
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
// an optional root (a drive, ~, ./, ../ or a separator), then segments of path characters joined by separators
const PATH_RE = /(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?[\w@+-][\w.@+-]*(?:[\\/][\w.@+-]+)*/g;
// what may follow a path: :12, :12:5, (12) or (12,5)
const SUFFIX_RE = /^(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))/;
// a file name's extension: a letter then 1–9 letters or digits, so ".ts" and ".go" but not "e.g" or "0.4s"
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{1,9}$/;
const SEP_RE = /[\\/]/;
// inline code without a separator or a line is a path only when it names a source file
const INLINE_EXTS = new Set(
    "ts tsx js jsx mjs cjs json md mdx go rs py css scss html yml yaml toml sql sh ps1 txt tex lock mod sum java kt c h cpp cs rb php swift vue svelte".split(
        " "
    )
);

function isPathToken(token: string): boolean {
    if (token.startsWith("-") || !/[A-Za-z]/.test(token)) {
        return false;
    }
    if (SEP_RE.test(token)) {
        return true;
    }
    return EXT_RE.test(token);
}

export function findPathCandidates(line: string): PathCandidate[] {
    const masked = line.replace(URL_RE, (m) => " ".repeat(m.length));
    const out: PathCandidate[] = [];
    for (const m of masked.matchAll(PATH_RE)) {
        const start = m.index ?? 0;
        // a sentence's full stop is not part of the name
        const token = m[0].replace(/\.+$/, "");
        if (token === "" || !isPathToken(token)) {
            continue;
        }
        const after = token.length === m[0].length ? masked.slice(start + token.length) : "";
        const s = SUFFIX_RE.exec(after);
        const lineNo = s ? Number(s[1] ?? s[3]) : undefined;
        const colStr = s ? (s[2] ?? s[4]) : undefined;
        const end = start + token.length + (s ? s[0].length : 0);
        out.push({
            text: line.slice(start, end),
            start,
            end,
            path: token,
            ...(lineNo != null ? { line: lineNo } : {}),
            ...(colStr != null ? { col: Number(colStr) } : {}),
        });
    }
    return out;
}

export function isAbsolutePath(p: string): boolean {
    return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p);
}

// an absolute path with forward slashes and . / .. folded, or null when it cannot be known here
export function resolvePath(cwd: string | null | undefined, p: string): string | null {
    if (p.startsWith("~")) {
        return null; // the shell's home is not known here
    }
    let joined: string;
    if (isAbsolutePath(p)) {
        joined = p;
    } else if (cwd != null && isAbsolutePath(cwd)) {
        joined = `${cwd}/${p}`;
    } else {
        return null;
    }
    const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? "";
    const segs: string[] = [];
    for (const seg of joined.slice(drive.length).split(/[\\/]+/)) {
        if (seg === "" || seg === ".") {
            continue;
        }
        if (seg === "..") {
            segs.pop();
            continue;
        }
        segs.push(seg);
    }
    return `${drive}/${segs.join("/")}`;
}

// inline code that is exactly one path: with a separator, a line, or a source file's extension
export function inlinePathOf(code: string): PathCandidate | null {
    const text = code.trim();
    const all = findPathCandidates(text);
    if (all.length !== 1 || all[0].start !== 0 || all[0].end !== text.length) {
        return null;
    }
    const c = all[0];
    const ext = /\.([A-Za-z0-9]+)$/.exec(c.path)?.[1]?.toLowerCase() ?? "";
    return SEP_RE.test(c.path) || c.line != null || INLINE_EXTS.has(ext) ? c : null;
}
