// frontend/app/view/agents/reviewlist.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: a selection's review patch (GitReviewPatchCommand) to the Review mode's render model — one
// section per file, its rows numbered per side, long unchanged runs folded. No React.

import { DiffLine, diffFileView } from "./gitdiff";

// Structurally the generated ReviewPatchFile; declared here so this model does not wait on the RPC.
export interface ReviewPatchFileLike {
    path: string;
    oldpath?: string;
    diff?: string;
    untracked?: boolean;
    content?: string;
    toolarge?: boolean;
    size?: number;
}

// A row is named by the side it is commented on: `new:42` is line 42 of the new file (an added or
// context row), `old:12` line 12 of the old file (a removed row).
export type ReviewRow =
    | {
          kind: "line";
          key: string;
          side: "new" | "old";
          line: number;
          oldNo: string;
          newNo: string;
          sign: string;
          text: string;
          change: "add" | "del" | "ctx";
      }
    | { kind: "fold"; id: string; hidden: number };

type LineRow = Extract<ReviewRow, { kind: "line" }>;

export interface ReviewSection {
    path: string;
    name: string;
    dir: string;
    oldPath?: string;
    adds: number;
    dels: number;
    rows: ReviewRow[]; // folds already applied
    empty?: "binary" | "toolarge" | "renamed" | "nochange"; // why there are no rows
    size?: number; // for "toolarge"
}

export const FOLD_CONTEXT = 3;

function lineRow(l: DiffLine): LineRow {
    const side = l.kind === "del" ? "old" : "new";
    const line = parseInt(side === "old" ? l.gOld : l.gNew, 10);
    return {
        kind: "line",
        key: `${side}:${line}`,
        side,
        line,
        oldNo: l.gOld,
        newNo: l.gNew,
        sign: l.sign,
        text: l.text,
        change: l.kind as LineRow["change"],
    };
}

// One hunk's rows with its long unchanged runs folded. The hunk's own start and end stand in for the
// file's: a run there has nothing above (or below) it to give context to, so it keeps its inner side only.
function foldHunk(path: string, rows: LineRow[], expanded: ReadonlySet<string>): ReviewRow[] {
    const out: ReviewRow[] = [];
    let i = 0;
    while (i < rows.length) {
        if (rows[i].change !== "ctx") {
            out.push(rows[i++]);
            continue;
        }
        let j = i;
        while (j < rows.length && rows[j].change === "ctx") {
            j++;
        }
        const run = rows.slice(i, j);
        const keepTop = i === 0 ? 0 : FOLD_CONTEXT;
        const keepBottom = j === rows.length ? 0 : FOLD_CONTEXT;
        const hidden = run.slice(keepTop, run.length - keepBottom);
        // the fold row is named by the first row it hides, which no other fold in the file starts on
        const id = hidden.length ? `${path}#${hidden[0].key}` : "";
        if (run.length <= 2 * FOLD_CONTEXT + 1 || expanded.has(id)) {
            out.push(...run);
        } else {
            out.push(
                ...run.slice(0, keepTop),
                { kind: "fold", id, hidden: hidden.length },
                ...run.slice(run.length - keepBottom)
            );
        }
        i = j;
    }
    return out;
}

function splitPath(path: string): { name: string; dir: string } {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? { name: path, dir: "" } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

function reviewSection(file: ReviewPatchFileLike, expanded: ReadonlySet<string>): ReviewSection {
    const view = diffFileView(file);
    // hunk header rows are not rendered; they only split the file into the hunks that fold apart
    const hunks: LineRow[][] = [];
    let cur: LineRow[] | null = null;
    for (const l of view.lines) {
        if (l.kind === "hunk") {
            cur = null;
            continue;
        }
        if (cur == null) {
            cur = [];
            hunks.push(cur);
        }
        cur.push(lineRow(l));
    }
    const rows = hunks.flatMap((h) => foldHunk(file.path, h, expanded));
    const section: ReviewSection = {
        path: file.path,
        ...splitPath(file.path),
        adds: view.adds,
        dels: view.dels,
        rows,
    };
    const oldPath = file.oldpath || view.renamedFrom;
    if (oldPath) {
        section.oldPath = oldPath;
    }
    if (view.tooLarge != null) {
        section.empty = "toolarge";
        section.size = view.tooLarge;
    } else if (view.binary) {
        section.empty = "binary";
    } else if (rows.length === 0) {
        section.empty = view.renamedFrom ? "renamed" : "nochange";
    }
    return section;
}

export function reviewSections(files: ReviewPatchFileLike[], expandedFolds: ReadonlySet<string>): ReviewSection[] {
    return files.map((f) => reviewSection(f, expandedFolds));
}

// The rows a range covers, from either end to the other: the side's rows only, since a range never mixes
// sides. Null across sides, or when either end is not a row the section shows.
export function rowsInRange(section: ReviewSection, from: string, to: string): ReviewRow[] | null {
    const a = section.rows.findIndex((r) => r.kind === "line" && r.key === from);
    const b = section.rows.findIndex((r) => r.kind === "line" && r.key === to);
    if (a < 0 || b < 0) {
        return null;
    }
    const side = (section.rows[a] as LineRow).side;
    if ((section.rows[b] as LineRow).side !== side) {
        return null;
    }
    return section.rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter((r) => r.kind === "line" && r.side === side);
}
