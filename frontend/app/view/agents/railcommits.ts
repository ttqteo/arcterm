// frontend/app/view/agents/railcommits.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the rail's Changes tab says about where its diff is measured and which commits it spans
// (docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md). The commits are the files list's own range,
// so the two always agree. No React, no Wave runtime.

import type { HistoryRow } from "./historyrows";

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
