// frontend/app/view/agents/diffscope.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Diff surface's subject — which repository, and which range within it. Scope used to be a
// conclusion that four separate variables happened to imply, which is why the surface could display it
// and nothing could set it. Here it is one value, and every question the surface and its three git
// stores ask about scope is answered by a function in this file.

import { normalizeRepoPath, sameRepoPath } from "@/util/paths";
import { editsApply } from "./agentedits";
import type { CompareForm } from "./diffcontent";
import type { HistoryFilters } from "./historyquery";

// A project's path comes from the config registry and a run's directory and base commit were captured
// when the run started, so both answer synchronously. An agent's directory is read from its live
// transcript and can fail, so an agent origin carries only its id (and its runtime, which decides whether it has an
// edits range) and the loader resolves the rest.
// A worktree is one checkout of a registered project, picked from the Diff sidebar; `project` names
// that project, since a linked worktree's own path is not registered. A run's headCommit is its landed
// tip; absent, the run is live and reads up to HEAD.
export type DiffOrigin =
    | { kind: "agent"; id: string; runtime?: string }
    | { kind: "project"; name: string; path: string }
    | { kind: "worktree"; path: string; project: string }
    | { kind: "run"; runId: string; cwd: string; baseCommit: string; headCommit?: string };

export interface DiffRepo {
    origin: DiffOrigin;
    label: string;
}

export type DiffRange =
    | { kind: "working" }
    | { kind: "session"; agentId: string }
    // the agent's own Edit/Write calls, rebuilt by the backend into two synthetic commits (agentedits.ts)
    | { kind: "edits"; agentId: string }
    | { kind: "run"; runId: string; baseCommit: string; headCommit?: string }
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
// rather than in githistorystore because it is derived from the range and nothing else. `ref` is where
// git log starts walking; absent walks every ref (--all), as it always has.
export interface LoadHistoryOpts {
    anchor?: string;
    anchorLabel?: string;
    rowLabel?: string;
    ref?: string;
    // no commit list at all, only the scope's own row: the edits range's two commits are synthetic
    noCommits?: boolean;
}

// Which of an agent's two ranges its scope opens on. The person's choice, kept per agent (diffrangechoice.ts).
export type RangeChoice = "edits" | "session";

export const EDITS_LABEL = "Agent's edits";

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
        case "edits":
            return `edits:${r.agentId}`;
        case "run":
            // the tip is appended only when bounded, so an unbounded run keeps the key its review marks
            // were saved under
            return r.headCommit ? `run:${r.runId}:${r.baseCommit}:${r.headCommit}` : `run:${r.runId}:${r.baseCommit}`;
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
// range in here would blank the list and scroll to the top on every range change. The one thing of the
// range that git answers differently is the ref the walk starts from (a landed run's tip), so it joins
// the key, and only when set: a walk of every ref keeps the key it always had.
export function historyKey(cwd: string, f: HistoryFilters, ref = ""): string {
    const base = `${cwd}|${f.author}|${f.path}|${f.text}`;
    return ref ? `${base}|${ref}` : base;
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

// A Claude agent opens on its own edits unless the person chose its session range; any other runtime has no edits
// range to open on.
export function defaultRangeFor(o: DiffOrigin, choice?: RangeChoice): DiffRange {
    switch (o.kind) {
        case "agent":
            return editsApply(o.runtime) && choice !== "session"
                ? { kind: "edits", agentId: o.id }
                : { kind: "session", agentId: o.id };
        case "project":
        case "worktree":
            return { kind: "working" };
        case "run":
            return o.headCommit
                ? { kind: "run", runId: o.runId, baseCommit: o.baseCommit, headCommit: o.headCommit }
                : { kind: "run", runId: o.runId, baseCommit: o.baseCommit };
    }
}

export function historyOptsFor(range: DiffRange, resolvedRef: string): LoadHistoryOpts {
    switch (range.kind) {
        case "session":
            return resolvedRef
                ? { anchor: resolvedRef, anchorLabel: "session start", rowLabel: "Since session start" }
                : {};
        // B and H are synthetic commits: no history to read, and the scope's own row is the only row
        case "edits":
            return { noCommits: true, rowLabel: EDITS_LABEL };
        case "run": {
            // a landed run walks from its own tip: --all would list the commits that landed after it above its base
            const walk = range.headCommit ? { ref: range.headCommit } : {};
            return range.baseCommit
                ? { anchor: range.baseCommit, anchorLabel: "run base", rowLabel: "Run changes", ...walk }
                : walk;
        }
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
        case "edits":
            return "by this agent";
        case "working":
            return "vs HEAD";
    }
}

// The Agent's edits caption under the scope's own row: how many files, and the Bash calls the rebuild cannot see into.
// With no base there is nothing to count, and the backend's own reason says why.
export function editsCaption(i: { files: number; bashcalls: number; reason: string; hasBase: boolean }): string {
    if (!i.hasBase) {
        return i.reason || "no edits to show";
    }
    const files = `${i.files} ${i.files === 1 ? "file" : "files"} by this agent`;
    return i.bashcalls > 0
        ? `${files} · ${i.bashcalls} Bash ${i.bashcalls === 1 ? "call" : "calls"} may have changed files not shown`
        : files;
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
