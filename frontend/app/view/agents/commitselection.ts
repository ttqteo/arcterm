// frontend/app/view/agents/commitselection.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Commit tab's ticks and its button. Ticks are kept as exceptions to the defaults, so a file that appears
// later takes its default and a file that left the list stops counting. No React.

import type { GitChange } from "./gitstatus";

export interface CommitTicks {
    off: string[]; // tracked paths the person unticked
    on: string[]; // untracked paths the person ticked
}

export const NO_TICKS: CommitTicks = { off: [], on: [] };

// a nested repository, or a submodule whose only change is inside it: a commit here cannot carry either
export function committable(f: GitChange): boolean {
    return f.note !== "repo" && f.note !== "dirty";
}

function byDefault(f: GitChange): boolean {
    return f.status !== "?";
}

export function isTicked(t: CommitTicks, f: GitChange): boolean {
    if (!committable(f)) {
        return false;
    }
    if (t.off.includes(f.path)) {
        return false;
    }
    return t.on.includes(f.path) || byDefault(f);
}

export function setTicked(t: CommitTicks, f: GitChange, on: boolean): CommitTicks {
    const next = { off: t.off.filter((p) => p !== f.path), on: t.on.filter((p) => p !== f.path) };
    if (committable(f) && on !== byDefault(f)) {
        (on ? next.on : next.off).push(f.path);
    }
    return next;
}

export function setManyTicked(t: CommitTicks, files: GitChange[], on: boolean): CommitTicks {
    return files.reduce((acc, f) => setTicked(acc, f, on), t);
}

export function pruneTicks(t: CommitTicks, files: GitChange[]): CommitTicks {
    const live = new Set(files.map((f) => f.path));
    return { off: t.off.filter((p) => live.has(p)), on: t.on.filter((p) => live.has(p)) };
}

// what GitCommitCommand receives: a rename's source travels with it, or git would keep the old path
export function tickedPaths(t: CommitTicks, files: GitChange[]): string[] {
    return files.filter((f) => isTicked(t, f)).flatMap((f) => (f.from ? [f.path, f.from] : [f.path]));
}

export function tickedCount(t: CommitTicks, files: GitChange[]): number {
    return files.filter((f) => isTicked(t, f)).length;
}

export type TickState = "all" | "some" | "none";

export function groupTickState(t: CommitTicks, files: GitChange[]): TickState {
    const rows = files.filter(committable);
    const n = rows.filter((f) => isTicked(t, f)).length;
    return n === 0 ? "none" : n === rows.length ? "all" : "some";
}

export function commitLabel(n: number, amend: boolean): string {
    return `${amend ? "Amend with" : "Commit"} ${n} ${n === 1 ? "file" : "files"}`;
}

export function canCommit(message: string, ticked: number): boolean {
    return message.trim() !== "" && ticked > 0;
}

// Amend rewrites HEAD, which is safe only while no remote has it.
export function amendAllowed(s: { head: string; upstream: string; upstreamAhead: number }): boolean {
    return s.head !== "" && (s.upstream === "" || s.upstreamAhead > 0);
}
