// frontend/app/view/agents/diffscope.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Diff surface's subject — which repository, and which range within it. Scope used to be a
// conclusion that four separate variables happened to imply, which is why the surface could display it
// and nothing could set it. Here it is one value, and every question the surface and its three git
// stores ask about scope is answered by a function in this file.

import { normalizeRepoPath, sameRepoPath } from "@/util/paths";
import type { CompareForm } from "./diffcontent";
import type { HistoryFilters } from "./historyquery";

// A project's path comes from the config registry and a run's directory and base commit were captured
// when the run started, so both answer synchronously. An agent's directory is read from its live
// transcript and can fail, so an agent origin carries only its id and the loader resolves the rest.
// A worktree is one checkout of a registered project, picked from the Diff sidebar; `project` names
// that project, since a linked worktree's own path is not registered.
export type DiffOrigin =
    | { kind: "agent"; id: string }
    | { kind: "project"; name: string; path: string }
    | { kind: "worktree"; path: string; project: string }
    | { kind: "run"; runId: string; cwd: string; baseCommit: string };

export interface DiffRepo {
    origin: DiffOrigin;
    label: string;
}

export type DiffRange =
    | { kind: "working" }
    | { kind: "session"; agentId: string }
    | { kind: "run"; runId: string; baseCommit: string }
    // `from` is the range comparison interrupted. Escape restores it instead of guessing, which is
    // also what lets the old compareAnchorAtom and its invalidation effect go away. `form` is which
    // range form the aggregate uses: merge-base (what head introduced) or tip-to-tip (the full
    // difference). It lives here rather than beside the surface so rangeKey covers it and changing it
    // drops the stale read - a file list built one way beside a pane read the other is the failure.
    | { kind: "compare"; base: string; head: string; form: CompareForm; from: DiffRange };

export interface DiffScope {
    repo: DiffRepo;
    range: DiffRange;
}

// The history pane's divider label and the name of what its synthetic top row counts. Owned here
// rather than in githistorystore because it is derived from the range and nothing else.
export interface LoadHistoryOpts {
    anchor?: string;
    anchorLabel?: string;
    rowLabel?: string;
}

export function originKey(o: DiffOrigin): string {
    switch (o.kind) {
        case "agent":
            return `agent:${o.id}`;
        case "project":
            return `project:${o.name}`;
        case "worktree":
            return `worktree:${normalizeRepoPath(o.path)}`;
        case "run":
            return `run:${o.runId}`;
    }
}

export function rangeKey(r: DiffRange): string {
    switch (r.kind) {
        case "working":
            return "working";
        case "session":
            return `session:${r.agentId}`;
        case "run":
            return `run:${r.runId}:${r.baseCommit}`;
        case "compare":
            return `compare:${r.base}..${r.head}:${r.form}`;
    }
}

// Identifies the subject a change-list read belongs to. Stale reads are dropped by comparing this,
// and a deep link names the scope it wants with it, so both sides speak one vocabulary.
export function scopeKey(scope: DiffScope): string {
    return `${originKey(scope.repo.origin)}|${rangeKey(scope.range)}`;
}

// Deliberately range-free. git's commit list depends on the directory and the filters; the range only
// labels a divider and the synthetic top row, both of which are derived from an atom. Folding the
// range in here would blank the list and scroll to the top on every range change.
export function historyKey(cwd: string, f: HistoryFilters): string {
    return `${cwd}|${f.author}|${f.path}|${f.text}`;
}

export function originCwd(o: DiffOrigin): string | null {
    switch (o.kind) {
        case "project":
        case "worktree":
            return o.path || null;
        case "run":
            return o.cwd || null;
        case "agent":
            return null;
    }
}

export function defaultRangeFor(o: DiffOrigin): DiffRange {
    switch (o.kind) {
        case "agent":
            return { kind: "session", agentId: o.id };
        case "project":
        case "worktree":
            return { kind: "working" };
        case "run":
            return { kind: "run", runId: o.runId, baseCommit: o.baseCommit };
    }
}

export function historyOptsFor(range: DiffRange, resolvedRef: string): LoadHistoryOpts {
    switch (range.kind) {
        case "session":
            return resolvedRef
                ? { anchor: resolvedRef, anchorLabel: "session start", rowLabel: "Since session start" }
                : {};
        case "run":
            return range.baseCommit
                ? { anchor: range.baseCommit, anchorLabel: "run base", rowLabel: "Run changes" }
                : {};
        case "working":
        case "compare":
            return {};
    }
}

// The diff header's "measured against" words, which follow the selection: a commit is "in
// <hash>", otherwise the range says what the file is compared with.
export function measuredAgainst(i: { range: DiffRange; commit: string | null }): string {
    if (i.commit != null) {
        return `in ${shortSha(i.commit)}`;
    }
    switch (i.range.kind) {
        case "compare":
            return `${i.range.head} vs ${i.range.base}${i.range.form === "tips" ? ", tip to tip" : ""}`;
        case "run":
            return i.range.baseCommit ? `since run base ${shortSha(i.range.baseCommit)}` : "vs HEAD";
        case "session":
            return "since session start";
        case "working":
            return "vs HEAD";
    }
}

// The registered project a scope belongs to, for finding the agents that work on it. A run's (or a
// vanished agent's) repository is matched by path; a worktree's path is not registered, so it says.
export function scopeProjectName<P extends { name: string; path: string }>(
    origin: DiffOrigin | undefined,
    projects: P[],
    repoKey: string
): string {
    if (origin?.kind === "project") {
        return origin.name;
    }
    if (origin?.kind === "worktree") {
        return origin.project;
    }
    return projects.find((p) => sameRepoPath(p.path, repoKey))?.name ?? "";
}

function shortSha(sha: string): string {
    return sha ? sha.slice(0, 7) : "";
}
