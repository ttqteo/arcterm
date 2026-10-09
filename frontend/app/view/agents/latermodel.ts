// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sessions marked for later: a session you mean to come back to, marked from its row's menu and cleared with Done.
// The marks live on the workspace (`session:later`, session id -> when it was marked), keyed by the session's id, the
// stem of its transcript file, so a mark outlives the agent: closed, its conversation keeps it, and a resume that writes
// the same transcript brings it back on the live row. Pure, no React or jotai: laterstore.ts reads and writes the meta.

import type { ConversationEntry } from "./agentsidebarmodel";
import { sessionIdFromTranscript } from "./launch";

export type LaterMarks = Readonly<Record<string, number>>;

/** Pure: the key a session's mark is filed under, from its transcript path; undefined when it has none yet (a plain
 *  terminal, or an agent that has not written its transcript), which cannot be marked. */
export function laterKey(transcriptPath: string | undefined): string | undefined {
    return sessionIdFromTranscript(transcriptPath);
}

/** Pure: when the session at `transcriptPath` was marked for later, or undefined when it is not. */
export function laterSince(marks: LaterMarks, transcriptPath: string | undefined): number | undefined {
    const key = laterKey(transcriptPath);
    return key != null ? marks[key] : undefined;
}

/** Pure: the marks with `key` marked (at `now`) or cleared. A key already marked keeps its first time. */
export function withLater(marks: LaterMarks, key: string, on: boolean, now: number): Record<string, number> {
    const next = { ...marks };
    if (on) {
        next[key] ??= now;
    } else {
        delete next[key];
    }
    return next;
}

function entryLater(marks: LaterMarks, e: ConversationEntry): boolean {
    return e.kind === "session" && laterSince(marks, e.session.transcriptpath) != null;
}

/** Pure: each project's ended conversations with the ones marked for later first, so a page of "Show more" never hides
 *  one; the order within each part is kept. */
export function laterFirst(
    ended: ReadonlyMap<string, ConversationEntry[]>,
    marks: LaterMarks
): Map<string, ConversationEntry[]> {
    const out = new Map<string, ConversationEntry[]>();
    for (const [project, list] of ended) {
        const marked = list.filter((e) => entryLater(marks, e));
        out.set(project, marked.length === 0 ? list : [...marked, ...list.filter((e) => !entryLater(marks, e))]);
    }
    return out;
}

/** Pure: a mark's tooltip, "Later · marked 2d ago". */
export function laterTitle(since: number, now: number, age: (ms: number) => string): string {
    return `Later · marked ${age(Math.max(0, now - since))} ago`;
}
