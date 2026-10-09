// frontend/app/view/code/codestatus.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: working-tree status as a path-keyed lookup layered over the tree's existing rows, plus the
// directory roll-up. No React, no IO.
//
// codeRowsAtom stays the single source of what rows exist; this only answers "what is this path's
// status", so the tree and the Changed column cannot disagree about which files there are.

import type { ChangeNote, GitChanges } from "@/app/view/agents/gitstatus";

export interface CodeStatus {
    status: string; // a porcelain letter: M, A, D, ?, R, C
    adds: number;
    dels: number;
    note?: ChangeNote;
}

// git emits forward slashes and so does the index (git ls-files), so no separator normalization is
// needed on either side of this lookup.
export function statusByPath(changes: GitChanges): Map<string, CodeStatus> {
    const out = new Map<string, CodeStatus>();
    for (const f of changes.files ?? []) {
        if (f.path) {
            out.set(f.path, { status: f.status, adds: f.adds, dels: f.dels, ...(f.note ? { note: f.note } : {}) });
        }
    }
    return out;
}

// the directories with at least one changed descendant — a collapsed row shows a neutral dot rather
// than an aggregate letter, because "one modified and one new file" has no honest single letter
export function changedDirs(paths: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const p of paths) {
        const segs = p.split("/").filter((s) => s !== "");
        for (let i = 1; i < segs.length; i++) {
            out.add(segs.slice(0, i).join("/"));
        }
    }
    return out;
}

export interface StatusGlyph {
    letter: string;
    className: string;
    label: string;
}

// The one place a status letter meets a color, and it returns a Tailwind class over an @theme token
// so the runtime theme picker reaches it. Deliberately NOT gitstatus.ts's STATUS_COLOR: that map
// serves the Diff surface's dense change list, where modified is the neutral majority and reads as
// accent; here a modified file is the exception among hundreds of unchanged rows, so it takes the
// warning token and untracked drops to muted.
const GLYPHS: Record<string, StatusGlyph> = {
    A: { letter: "A", className: "text-success", label: "Added" },
    M: { letter: "M", className: "text-warning", label: "Modified" },
    D: { letter: "D", className: "text-error", label: "Deleted" },
    "?": { letter: "?", className: "text-muted", label: "Untracked" },
    R: { letter: "R", className: "text-secondary", label: "Renamed" },
    C: { letter: "C", className: "text-secondary", label: "Copied" },
};

export function statusGlyph(status: string): StatusGlyph {
    return GLYPHS[status] ?? { letter: status.slice(0, 1) || "?", className: "text-muted", label: "Changed" };
}
