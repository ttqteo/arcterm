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

// The paths below stay relative; the checkout line says once which tree they are relative to, since an
// agent reading the review may sit in another checkout of the same project.
export function reviewMarkdown(projectName: string, checkout: string, comments: readonly ReviewComment[]): string {
    const byPath = new Map<string, ReviewComment[]>();
    for (const c of comments) {
        byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);
    }
    const parts = [`# Code review: ${projectName}`, `Checkout: ${checkout}`];
    for (const path of [...byPath.keys()].sort()) {
        parts.push(`## ${path}`);
        for (const c of byPath.get(path)!.sort((a, b) => a.startLine - b.startLine)) {
            parts.push(`### ${c.path}:${lineRef(c)}\n\n> ${c.anchor}\n\n${c.note}`);
        }
    }
    return parts.join("\n\n") + "\n";
}

// the review list's rows: by path, then by line, as the review document orders them
export function reviewListRows(
    comments: readonly ReviewComment[]
): { id: string; path: string; line: number; label: string; note: string }[] {
    return [...comments]
        .sort((a, b) => (a.path === b.path ? a.startLine - b.startLine : a.path < b.path ? -1 : 1))
        .map((c) => ({ id: c.id, path: c.path, line: c.startLine, label: `${c.path}:${lineRef(c)}`, note: c.note }));
}

// Stored as [project, comments][] JSON. Anything that does not read as a comment is dropped on its own, so
// one bad entry never costs the rest of the review.
export function storedReviewsJson(r: Reviews): string {
    return JSON.stringify([...r]);
}

export function parseStoredReviews(raw: string | null): Reviews {
    const out = new Map<string, readonly ReviewComment[]>();
    if (raw == null) {
        return out;
    }
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return out;
    }
    if (!Array.isArray(value)) {
        return out;
    }
    for (const entry of value) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0] === "" || !Array.isArray(entry[1])) {
            continue;
        }
        const comments = (entry[1] as unknown[]).filter(isStoredComment);
        if (comments.length > 0) {
            out.set(entry[0], comments);
        }
    }
    return out;
}

function isStoredComment(c: unknown): c is ReviewComment {
    if (c == null || typeof c !== "object") {
        return false;
    }
    const v = c as Record<string, unknown>;
    return (
        typeof v.id === "string" &&
        typeof v.path === "string" &&
        typeof v.anchor === "string" &&
        typeof v.note === "string" &&
        Number.isInteger(v.startLine) &&
        Number.isInteger(v.endLine) &&
        (v.startLine as number) >= 1 &&
        (v.endLine as number) >= (v.startLine as number)
    );
}

// What a send to an agent pastes (agents/linereviewsend.ts, the way the Diff's line review sends): a lead line saying what
// the document is and what to do with it, then the document. The fork wrote the document to a file under ~/.arc/review and
// handed over its path in one line; ours has no such write (no CodeReviewWriteCommand), so the agent gets the document whole.
export function reviewMessage(markdown: string): string {
    return `Review comments from the Code surface. Address each one:\n\n${markdown.trimEnd()}`;
}
