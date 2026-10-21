// frontend/app/view/agents/railcommits.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the rail's Changes tab says about where its diff is measured and which commits it spans
// (docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md). The commits are the files list's own range,
// so the two always agree. No React, no Wave runtime.

import { worktreeName } from "./agentrailmodel";
import { buildRows, type HistoryRow } from "./historyrows";
import type { RailChangesRange, RailGitState } from "./railstore";

const FOLD_ABOVE = 5;

export const RAIL_COMMITS_CAP = 20;
// a 300px rail: a third lane folds into the second
export const RAIL_MAX_LANES = 2;
export const RAIL_ROW_H = 26;

export interface RailWhere {
    branch: string;
    place: string; // the worktree's short name, or the checkout's project
    kind: "worktree" | "checkout";
    path: string; // the full cwd, for the tooltip
}

export interface CommitRange {
    from: string; // the commit the range starts after: the merge base, or the session's start
    root: "branch" | "session";
    base?: string; // the default branch, on Branch
}

export interface RailCommitRows {
    rows: HistoryRow[];
    count: number; // the commits shown, without the uncommitted and root rows
    more: boolean; // the read found more than the cap
}

export function railWhere(
    s: Pick<RailGitState, "cwd" | "branch" | "isRepo" | "worktree">,
    project: string
): RailWhere | null {
    if (s.cwd == null || !s.isRepo) {
        return null;
    }
    if (s.worktree) {
        return { branch: s.branch, place: worktreeName(s.worktree), kind: "worktree", path: s.cwd };
    }
    const folder = s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd;
    return { branch: s.branch, place: project || folder, kind: "checkout", path: s.cwd };
}

// the files list's own choice: Branch only where there is a branch view, else Session
export function commitRange(range: RailChangesRange, s: Pick<RailGitState, "ref" | "branchDiff">): CommitRange | null {
    if (range === "branch" && s.branchDiff != null) {
        return { from: s.branchDiff.ref, root: "branch", base: s.branchDiff.base };
    }
    return s.ref ? { from: s.ref, root: "session" } : null;
}

// commits: newest first, as GitHistoryCommand reads `<from>..HEAD` with a limit of the cap plus one
export function railCommitRows(
    commits: HistoryCommit[],
    range: CommitRange,
    opts: { head: string; uncommitted: number; now: number }
): RailCommitRows {
    const more = commits.length > RAIL_COMMITS_CAP;
    const shown = commits.slice(0, RAIL_COMMITS_CAP);
    if (shown.length === 0 && opts.uncommitted <= 0) {
        return { rows: [], count: 0, more: false };
    }
    const rows = buildRows(shown, {
        head: opts.head,
        dirtyFileCount: opts.uncommitted,
        rowLabel: "Uncommitted changes",
        now: opts.now,
    });
    // the root is drawn only next to the commit it parents; past the cap the list runs on instead
    if (!more) {
        rows.push({
            hash: range.from,
            parents: [],
            boundary: true,
            subject: range.root === "branch" ? "branched off here" : "session started here",
            author: "",
            email: "",
            ts: 0,
            when: "",
            refs: range.root === "branch" && range.base ? [{ label: range.base, kind: "branch" }] : [],
            before: false,
        });
    }
    return { rows, count: shown.length, more };
}

// a commit row's tooltip: the rail draws no author mark, so the author is here
export function railCommitTitle(row: HistoryRow): string {
    return [row.hash.slice(0, 7), row.subject, row.author, row.when].filter(Boolean).join(" · ");
}

export function commitsOpenByDefault(count: number): boolean {
    return count <= FOLD_ABOVE;
}

// the folded header's one line
export function commitsSummary(v: RailCommitRows, range: CommitRange): string {
    const newest = v.rows.find((r) => !r.workingTree && !r.boundary);
    if (newest == null) {
        return "";
    }
    return range.root === "branch" && range.base
        ? `newest ${newest.when} · since ${range.base}`
        : `newest ${newest.when}`;
}
