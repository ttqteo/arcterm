// frontend/app/view/code/codeblame.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The blame column's model. The backend returns porcelain groups unmerged, and git splits one commit's
// lines into several groups when they came from different original positions, so the merge into one
// entry per run of consecutive lines happens here, where it can be tested.

export interface BlameEntry {
    start: number;
    lines: number;
    sha: string;
    short: string;
    author: string;
    authorTime: number;
    subject: string;
    committed: boolean;
    run?: { runId: string; goal: string };
}

// `path` is whatever key the store loaded under; the column only shows a state whose path and modtime
// match the open file, since blame describes the saved file.
export type BlameState =
    | { kind: "idle" }
    | { kind: "loading"; path: string }
    | { kind: "ready"; path: string; modtime: number; entries: BlameEntry[] }
    | { kind: "error"; path: string; message: string };

export type BlameClick = { kind: "open-run"; runId: string } | { kind: "copy-sha"; sha: string } | { kind: "none" };

const SHORT_SHA = 7;

const isZeroSha = (sha: string) => /^0+$/.test(sha);

function uncommitted(start: number, lines: number): BlameEntry {
    return { start, lines, sha: "", short: "", author: "", authorTime: 0, subject: "", committed: false };
}

export function blameEntries(rtn: CommandGitBlameRtnData, lineCount: number): BlameEntry[] {
    if (!rtn.isrepo) {
        return [];
    }
    if (rtn.untracked) {
        return [uncommitted(1, lineCount)];
    }
    const out: BlameEntry[] = [];
    for (const h of rtn.hunks ?? []) {
        const last = out[out.length - 1];
        if (last != null && last.sha === h.sha && last.start + last.lines === h.start) {
            last.lines += h.lines;
            continue;
        }
        if (isZeroSha(h.sha)) {
            out.push({ ...uncommitted(h.start, h.lines), sha: h.sha });
            continue;
        }
        const run = rtn.runs?.[h.sha];
        out.push({
            start: h.start,
            lines: h.lines,
            sha: h.sha,
            short: h.sha.slice(0, SHORT_SHA),
            author: h.author,
            authorTime: h.authortime,
            subject: h.subject,
            committed: true,
            ...(run != null ? { run: { runId: run.runid, goal: run.goal } } : {}),
        });
    }
    return out;
}

export function blameClick(e: BlameEntry): BlameClick {
    if (!e.committed) {
        return { kind: "none" };
    }
    return e.run != null ? { kind: "open-run", runId: e.run.runId } : { kind: "copy-sha", sha: e.sha };
}

export function blameIsCurrent(state: BlameState, path: string, modtime: number): boolean {
    return state.kind === "ready" && state.path === path && state.modtime === modtime;
}

// past this many cells (changed saved lines times changed buffer lines) the middle is not diffed: the table
// would cost too much per keystroke, so the changed region shows no blame instead
const MAX_DIFF_CELLS = 2_000_000;

// For each buffer line, the 1-based saved line it is, or null for an inserted or edited line. Blame
// describes the saved file, so an unsaved draft must be mapped back onto it.
export function mapBlameLines(saved: string, buffer: string): (number | null)[] {
    const a = saved.split("\n");
    const b = buffer.split("\n");
    const out: (number | null)[] = new Array(b.length).fill(null);
    const shorter = Math.min(a.length, b.length);
    let pre = 0;
    while (pre < shorter && a[pre] === b[pre]) {
        out[pre] = pre + 1;
        pre++;
    }
    let suf = 0;
    while (suf < shorter - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) {
        out[b.length - 1 - suf] = a.length - suf;
        suf++;
    }
    const n = a.length - pre - suf;
    const m = b.length - pre - suf;
    if (n === 0 || m === 0 || n * m > MAX_DIFF_CELLS) {
        return out;
    }
    for (const [bi, ai] of commonLines(a.slice(pre, pre + n), b.slice(pre, pre + m))) {
        out[pre + bi] = pre + ai + 1;
    }
    return out;
}

// the matched [b index, a index] pairs of a line-level longest common subsequence
function commonLines(a: string[], b: string[]): [number, number][] {
    const n = a.length;
    const m = b.length;
    const w = m + 1;
    // an lcs is at most min(n, m), which the cell cap keeps under 1415, so 16 bits hold every cell
    const lcs = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i * w + j] =
                a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
        }
    }
    const pairs: [number, number][] = [];
    for (let i = 0, j = 0; i < n && j < m; ) {
        if (a[i] === b[j]) {
            pairs.push([j, i]);
            i++;
            j++;
        } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
            i++;
        } else {
            j++;
        }
    }
    return pairs;
}

// The runs of consecutive buffer lines that are not in the saved file (inserted or edited, `map`'s nulls), so the
// column can mark them: blame has nothing to say about a line git has never seen.
export function unsavedRuns(map: (number | null)[]): { start: number; lines: number }[] {
    const out: { start: number; lines: number }[] = [];
    for (let i = 0; i < map.length; i++) {
        if (map[i] != null) {
            continue;
        }
        const last = out[out.length - 1];
        if (last != null && last.start + last.lines === i + 1) {
            last.lines++;
        } else {
            out.push({ start: i + 1, lines: 1 });
        }
    }
    return out;
}

export interface BlamePlacement {
    entry: BlameEntry;
    start: number;
    lines: number;
}

// Each entry at the buffer lines that are its saved lines, one placement per run of consecutive buffer
// lines; an entry with no line left in the buffer gets none. `map` is mapBlameLines' answer, whose saved
// lines only ever increase, so one pass over the sorted entries finds every owner.
export function placeBlame(entries: BlameEntry[], map: (number | null)[]): BlamePlacement[] {
    const out: BlamePlacement[] = [];
    let k = 0;
    for (let i = 0; i < map.length; i++) {
        const saved = map[i];
        if (saved == null) {
            continue;
        }
        while (k < entries.length && entries[k].start + entries[k].lines <= saved) {
            k++;
        }
        const entry = entries[k];
        if (entry == null || entry.start > saved) {
            continue;
        }
        const line = i + 1;
        const last = out[out.length - 1];
        if (last != null && last.entry === entry && last.start + last.lines === line) {
            last.lines++;
        } else {
            out.push({ entry, start: line, lines: 1 });
        }
    }
    return out;
}
