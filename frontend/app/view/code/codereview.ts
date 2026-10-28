// frontend/app/view/code/codereview.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the model behind multi-comment code reviews. Comments are kept per project, anchored to the
// text of their first line so they survive an agent shifting the file, and rendered into one
// markdown document that is handed to an agent (or the clipboard) as a single message.

export interface ReviewComment {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    anchor: string;
    note: string;
}

export type Reviews = ReadonlyMap<string, readonly ReviewComment[]>;

export function projectComments(r: Reviews, project: string): readonly ReviewComment[] {
    return r.get(project) ?? [];
}

export function fileComments(r: Reviews, project: string, path: string): readonly ReviewComment[] {
    return projectComments(r, project).filter((c) => c.path === path);
}

// the single write path: an empty list drops its key, an empty project key is never stored
function withProject(r: Reviews, project: string, list: readonly ReviewComment[]): Reviews {
    if (project === "") {
        return r;
    }
    const next = new Map(r);
    if (list.length === 0) {
        next.delete(project);
    } else {
        next.set(project, list);
    }
    return next;
}

export function addComment(r: Reviews, project: string, c: ReviewComment): Reviews {
    return withProject(r, project, [...projectComments(r, project), c]);
}

export function removeComment(r: Reviews, project: string, id: string): Reviews {
    return withProject(
        r,
        project,
        projectComments(r, project).filter((c) => c.id !== id)
    );
}

export function clearProject(r: Reviews, project: string): Reviews {
    return withProject(r, project, []);
}

// a selection that ends at column 1 of a later line covers only the lines above it
export function selectionLines(sel: { startLine: number; endLine: number; endColumn: number }): {
    startLine: number;
    endLine: number;
} {
    const endLine = sel.endColumn === 1 && sel.endLine > sel.startLine ? sel.endLine - 1 : sel.endLine;
    return { startLine: sel.startLine, endLine };
}

export function reanchor(c: ReviewComment, lines: readonly string[]): { startLine: number; endLine: number } {
    if (lines[c.startLine - 1] === c.anchor) {
        return { startLine: c.startLine, endLine: c.endLine };
    }
    let best = -1;
    for (let i = 0; i < lines.length; i++) {
        // strict < keeps the earlier match on a tie
        if (lines[i] === c.anchor && (best < 0 || Math.abs(i + 1 - c.startLine) < Math.abs(best + 1 - c.startLine))) {
            best = i;
        }
    }
    if (best < 0) {
        return { startLine: c.startLine, endLine: c.endLine };
    }
    const startLine = best + 1;
    return { startLine, endLine: Math.min(startLine + (c.endLine - c.startLine), lines.length) };
}

function lineRef(c: ReviewComment): string {
    return c.endLine === c.startLine ? `L${c.startLine}` : `L${c.startLine}-L${c.endLine}`;
}

export function reviewMarkdown(projectName: string, comments: readonly ReviewComment[]): string {
    const byPath = new Map<string, ReviewComment[]>();
    for (const c of comments) {
        byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);
    }
    const parts = [`# Code review: ${projectName}`];
    for (const path of [...byPath.keys()].sort()) {
        parts.push(`## ${path}`);
        for (const c of byPath.get(path)!.sort((a, b) => a.startLine - b.startLine)) {
            parts.push(`### ${c.path}:${lineRef(c)}\n\n> ${c.anchor}\n\n${c.note}`);
        }
    }
    return parts.join("\n\n") + "\n";
}

// ControllerInputCommand submits at the first newline, so this is always one line
export function reviewHandoffLine(absPath: string): string {
    return `review comments in ${absPath.replace(/[\r\n]+/g, " ")} — address each one`;
}
