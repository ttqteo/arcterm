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
