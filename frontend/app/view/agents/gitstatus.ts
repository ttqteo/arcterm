// frontend/app/view/agents/gitstatus.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: join `git status --porcelain=v1 -z` with `git diff --numstat HEAD` into the Files render
// model. No React, no Wave imports. Fixture-tested.

// Why a row has no line counts to show, where +0 −0 would claim an empty change:
//   bin   — git counts no lines in a binary file (numstat "-")
//   repo  — an untracked directory porcelain collapses even under -uall: a nested git repository
//   dirty — a tracked path with no numstat row: a submodule whose own working tree changed
export type ChangeNote = "bin" | "repo" | "dirty";

export interface GitChange {
    path: string;
    status: string; // "M" | "A" | "D" | "?" | "R" | "C" ...
    adds: number;
    dels: number;
    note?: ChangeNote;
    from?: string; // a rename's or copy's source path
}

export const CHANGE_NOTE_TITLE: Record<ChangeNote, string> = {
    bin: "Binary file: git counts no lines",
    repo: "A nested git repository: its own changes are not counted here",
    dirty: "A submodule with uncommitted changes inside it",
};

export interface GitChanges {
    files: GitChange[];
    adds: number; // totals
    dels: number;
}

// porcelain -z: NUL-separated entries "XY path"; rename/copy entries carry an extra NUL old-path.
function parseStatusZ(statusZ: string): { path: string; status: string; from?: string }[] {
    const out: { path: string; status: string; from?: string }[] = [];
    const parts = statusZ.split("\0");
    for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (!entry) {
            continue;
        }
        const xy = entry.slice(0, 2);
        const path = entry.slice(3);
        const status = xy.includes("?") ? "?" : (xy.trim()[0] ?? "?");
        let from: string | undefined;
        if (xy[0] === "R" || xy[0] === "C") {
            from = parts[i + 1] || undefined; // the next field is the rename/copy source path
            i++;
        }
        out.push(from ? { path, status, from } : { path, status });
    }
    return out;
}

// A rename is named by both its ends in --numstat: "old => new", or "pre/{old => new}/post" when the
// two paths share a prefix or suffix. Porcelain keys the change list by the NEW path alone, so an
// unresolved arrow key never matches and the file reads as +0 −0 — silently wrong for a rename that
// also edited content, and it drops those lines from the totals too.
export function numstatPath(raw: string): string {
    const expanded = raw.replace(/\{([^{}]*) => ([^{}]*)\}/g, "$2").replace(/\/{2,}/g, "/");
    const arrow = expanded.indexOf(" => ");
    return arrow === -1 ? expanded : expanded.slice(arrow + " => ".length);
}

function parseNumstat(numstat: string): Map<string, { adds: number; dels: number; binary: boolean }> {
    const m = new Map<string, { adds: number; dels: number; binary: boolean }>();
    for (const line of numstat.split("\n")) {
        if (!line.trim()) {
            continue;
        }
        const cols = line.split("\t");
        const a = cols[0];
        const d = cols[1];
        const path = numstatPath(cols.slice(2).join("\t"));
        if (!path) {
            continue;
        }
        m.set(path, {
            adds: a === "-" ? 0 : parseInt(a, 10) || 0,
            dels: d === "-" ? 0 : parseInt(d, 10) || 0,
            binary: a === "-" || d === "-",
        });
    }
    return m;
}

export function parseGitChanges(statusZ: string, numstat: string): GitChanges {
    const stat = parseNumstat(numstat);
    const files: GitChange[] = [];
    let adds = 0;
    let dels = 0;
    for (const { path, status, from } of parseStatusZ(statusZ)) {
        const n = stat.get(path);
        const change: GitChange = { path, status, adds: n?.adds ?? 0, dels: n?.dels ?? 0 };
        if (from) {
            change.from = from;
        }
        if (path.endsWith("/")) {
            change.note = "repo";
        } else if (n?.binary) {
            change.note = "bin";
        } else if (n == null && status !== "?") {
            change.note = "dirty";
        }
        files.push(change);
        adds += change.adds;
        dels += change.dels;
    }
    return { files, adds, dels };
}

// Tailwind text-color per git status — shared by the Files surface and the Agent details rail.
export const STATUS_COLOR: Record<string, string> = {
    A: "text-success",
    M: "text-accent",
    R: "text-accent",
    C: "text-accent",
    D: "text-error",
    "?": "text-ink-mid",
};

export const statusColor = (s: string): string => STATUS_COLOR[s] ?? "text-ink-mid";

// Pure: cap a changed-file list for a narrow surface (the 296px rail). Returns the first `cap`
// files and the count hidden behind a "+N more" affordance.
export function capFiles(files: GitChange[], cap: number): { shown: GitChange[]; more: number } {
    if (files.length <= cap) {
        return { shown: files, more: 0 };
    }
    return { shown: files.slice(0, cap), more: files.length - cap };
}
