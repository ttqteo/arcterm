// frontend/app/view/agents/historyrows.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: raw commit log -> the rows the history pane draws. Ref-chip classification, relative time,
// the synthetic uncommitted row, the scope anchor's divider and what is selected by default all live
// here so the pane stays a renderer. Lane assignment is gitgraph.ts; coordinates are gitgraphgeom.ts.

import { formatAge } from "./agentsviewmodel";
import { EDITS_LABEL, editsCaption, type DiffRange } from "./diffscope";
import type { FilesState } from "./filesstore";
import type { GraphCommit } from "./gitgraph";

// Sentinel hash for the synthetic uncommitted row. Empty on purpose: gitgraphgeom skips falsy hashes
// when indexing rows, so nothing can draw an edge *into* the working tree — which is correct, it has
// no children. Its own edge to HEAD still draws, because that reads its parents.
export const WORKING_TREE = "";

export type RefKind = "head" | "remote" | "branch" | "tag";

export interface RefChip {
    label: string;
    kind: RefKind;
}

export interface HistoryRow extends GraphCommit {
    subject: string;
    author: string;
    email: string;
    ts: number;
    when: string;
    refs: RefChip[];
    // only the synthetic top row has one; it stands where a commit's author would
    fileCount?: number;
}

export interface BuildRowsOpts {
    // current HEAD; the uncommitted row hangs off it
    head: string;
    // how many files the scope's change set holds; 0 suppresses the uncommitted row entirely
    dirtyFileCount: number;
    // What dirtyFileCount is actually counting. Only repo scope reads working-tree-vs-HEAD; agent
    // scope is anchored at the session-start commit and run scope at the run's base commit, so both
    // include committed work and must not be labelled "in the working tree". Omitted = repo scope.
    rowLabel?: string;
    // scope anchor (agent session-start commit, run base commit). Gets a labelled divider; commits
    // older than it are context and render dimmed.
    anchor?: string;
    anchorLabel?: string;
    // The Agent's edits range: its commits are synthetic, so whatever commits were loaded for another range are not
    // its rows, and the scope's own row stands even at 0 files (with no commits either, the pane would have no row
    // to select and no caption to show).
    noCommits?: boolean;
    now: number;
}

// git's %D decoration under --decorate=full, one entry at a time: "HEAD -> refs/heads/main",
// "refs/remotes/origin/main", "tag: refs/tags/v0.9.4", "refs/heads/feature/x". HistoryLog asks for the
// full form deliberately: under --decorate=short a local branch "feature/x" and a remote branch
// "origin/main" are the same string, so the namespace is the only thing that separates them. The label
// is the namespace stripped off, which is what the user recognises.
export function classifyRef(raw: string): RefChip | null {
    const s = raw.trim();
    if (!s) {
        return null;
    }
    if (s.startsWith("tag: ")) {
        return { label: stripNamespace(s.slice(5).trim()), kind: "tag" };
    }
    if (s.startsWith("HEAD -> ")) {
        return { label: stripNamespace(s.slice(8).trim()), kind: "head" };
    }
    if (s === "HEAD") {
        return { label: s, kind: "head" };
    }
    if (s.startsWith("refs/remotes/")) {
        return { label: s.slice("refs/remotes/".length), kind: "remote" };
    }
    if (s.startsWith("refs/tags/")) {
        return { label: s.slice("refs/tags/".length), kind: "tag" };
    }
    // refs/heads/x, or a bare name if some caller ever hands us short-form decoration. A bare slashed
    // name is ambiguous by construction, so it reads as the local branch — the safer of the two.
    return { label: stripNamespace(s), kind: "branch" };
}

const NAMESPACES = ["refs/heads/", "refs/remotes/", "refs/tags/"];

function stripNamespace(ref: string): string {
    const ns = NAMESPACES.find((n) => ref.startsWith(n));
    return ns ? ref.slice(ns.length) : ref;
}

// Tailwind classes for a ref chip, kept beside the type it describes — the same shape as
// gitstatus.ts's statusColor, so both panes share one mapping instead of duplicating it.
export function refChipClass(kind: RefKind): string {
    switch (kind) {
        case "head":
            return "text-accent-soft bg-accentbg border-accent/30";
        case "tag":
            return "text-warning bg-warning/12 border-warning/25";
        case "branch":
            return "text-graphlane-2 bg-success/12 border-success/25";
        default:
            return "text-muted bg-surface-raised border-edge-mid";
    }
}

function ageLabel(ts: number, now: number): string {
    const ms = now - ts;
    return ms < 60_000 ? "now" : formatAge(ms);
}

// One commit -> one row, with no scope-anchor decoration. buildRows layers divider/before on top;
// comparerows.ts reuses it unchanged, so the history pane and the compare column classify refs and
// format ages through exactly one code path.
export function toRow(c: HistoryCommit, now: number): HistoryRow {
    return {
        hash: c.hash,
        parents: c.parents ?? [],
        subject: c.subject,
        author: c.author,
        email: c.email,
        ts: c.ts,
        when: ageLabel(c.ts, now),
        refs: (c.refs ?? []).map(classifyRef).filter((r): r is RefChip => r != null),
        before: false,
    };
}

export function buildRows(loaded: HistoryCommit[], opts: BuildRowsOpts): HistoryRow[] {
    const commits = opts.noCommits ? [] : loaded;
    const anchorIdx = opts.anchor ? commits.findIndex((c) => c.hash === opts.anchor) : -1;
    const rows: HistoryRow[] = commits.map((c, i) => ({
        ...toRow(c, opts.now),
        divider: anchorIdx >= 0 && i === anchorIdx ? opts.anchorLabel : undefined,
        before: anchorIdx >= 0 && i > anchorIdx,
    }));
    if (opts.dirtyFileCount <= 0 && !opts.noCommits) {
        return rows;
    }
    rows.unshift({
        hash: WORKING_TREE,
        parents: opts.head ? [opts.head] : [],
        workingTree: true,
        subject: opts.rowLabel ?? "Uncommitted changes",
        fileCount: opts.dirtyFileCount,
        author: "you",
        email: "",
        ts: opts.now,
        when: "now",
        refs: [],
        before: false,
    });
    return rows;
}

// The row's round author mark, where the 340px panel has no room for a name: the first and last word's initials
// ("Trần Tú Quang" -> "TQ"), or a lone word's first two letters ("ttqteo" -> "TT"). Words are runs of letters, so a bot
// or a dotted handle still gets a mark ("dependabot[bot]" -> "DB"); NFC first, so a decomposed accent stays inside its
// word.
export function authorInitials(name: string): string {
    const words = name
        .normalize("NFC")
        .split(/[^\p{L}\p{M}]+/u)
        .filter(Boolean);
    if (words.length === 0) {
        return "?";
    }
    if (words.length === 1) {
        return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
    }
    return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}

// The row's hover title: who made the commit and exactly when, which the row itself only shows as initials and an
// age. The uncommitted row has no author, so no title.
export function rowTitle(row: HistoryRow): string | undefined {
    if (row.workingTree) {
        return undefined;
    }
    const who = row.email ? `${row.author} <${row.email}>` : row.author;
    const when = new Date(row.ts).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    return `${who} · ${when}`;
}

// Commits loaded, which is every row but the synthetic uncommitted one: that row is not a commit, so a label that
// counts rows would read one too many on a dirty tree.
export function commitCount(rows: HistoryRow[]): number {
    return rows.filter((r) => !r.workingTree).length;
}

// The working-tree pane's one-line answer to "measured from what". HEAD is not a branch, so a
// detached checkout says so rather than printing "On HEAD". A session whose start has not resolved yet (ref "")
// says it is measured from HEAD rather than naming no commit; a landed run is bounded at its tip.
export function worktreeCaption(range: DiffRange, branch: string, head: string, ref: string): string {
    const on = branch && branch !== "HEAD" ? `On ${branch}` : "Detached HEAD";
    switch (range.kind) {
        case "session":
            return ref
                ? `${on}, measured from session start ${ref.slice(0, 7)}`
                : `${on}, measured from HEAD (no session start yet)`;
        case "run":
            return range.headCommit
                ? `${on}, measured from run base ${range.baseCommit.slice(0, 7)} to its landed tip ${range.headCommit.slice(0, 7)}`
                : `${on}, measured from run base ${range.baseCommit.slice(0, 7)}`;
        default:
            return `${on}, measured from ${head.slice(0, 7)}`;
    }
}

// The caption under the scope's own row. The edits range has its own words (B is synthetic, so no sha would name
// anything the reader can find); worktreeCaption's `default:` would swallow it as a plain working tree, which is why
// the choice is made here and not there. A state with no edits facts is another range's read, still on screen for the
// frame before the edits load replaces it: it says nothing rather than something about the wrong files.
export function paneCaption(
    range: DiffRange,
    state: Pick<FilesState, "branch" | "head" | "ref" | "changes" | "edits">
): string {
    if (range.kind === "edits") {
        if (state.edits == null) {
            return "";
        }
        return editsCaption({
            files: state.changes?.files.length ?? 0,
            bashcalls: state.edits.bashcalls,
            reason: state.edits.reason,
            hasBase: state.ref !== "",
        });
    }
    return worktreeCaption(range, state.branch, state.head, state.ref);
}

// The commit pane's region label over the scope's own row. The edits range's two commits are rebuilt from the
// transcript, not read from the working tree, so "Working tree" would misname what the row lists.
export function worktreeHeading(range: DiffRange): string {
    return range.kind === "edits" ? EDITS_LABEL : "Working tree";
}

// What the surface selects when history first arrives: uncommitted work if there is any, else the tip.
export function defaultSelection(rows: HistoryRow[]): string | null {
    if (rows.length === 0) {
        return null;
    }
    return rows[0].workingTree ? WORKING_TREE : rows[0].hash;
}

// Selection across a reload: keep where the user was if that row is still present, else fall back to
// the default. Used both when a filter narrows the list and on the reload that runs when the surface
// remounts — an unconditional default there is what used to throw you back to row zero on every
// return to the surface. `selected` may legitimately be "" (the uncommitted row), so the guard is an
// explicit null check, never a truthiness test.
export function keepSelection(rows: HistoryRow[], selected: string | null): string | null {
    if (selected != null && rows.some((r) => r.hash === selected)) {
        return selected;
    }
    return defaultSelection(rows);
}
