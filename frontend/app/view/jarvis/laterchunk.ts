// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chunks saved for later (EffortChunk.later). A later chunk is a passage or task kept on Jarvis until someone resolves
// it, not the initiative's work: it is left out of the plan, the done/total count and the next arrow, and the Brief's
// Later section lists it. Pure, no jotai and no RPC: the readers of an effort's chunks filter through planChunks, and
// the places that save a passage build their op with laterChunkOp.

/** True for a chunk carrying the later mark. */
export function isLater(c: { later?: boolean }): boolean {
    return c.later === true;
}

/** The initiative's own chunks: the list without its later ones, in the same order. */
export function planChunks<T extends { later?: boolean }>(chunks: T[]): T[] {
    return chunks.filter((c) => !isLater(c));
}

/** `label`, or `label (2)`, `label (3)`… with the first number no existing label holds. A chunk's label is its key in
 *  the initiative, so two saves of one sentence must not collide. Compared exactly. */
export function uniqueLabel(existing: readonly string[], label: string): string {
    const taken = new Set(existing);
    if (!taken.has(label)) {
        return label;
    }
    for (let n = 2; ; n++) {
        const next = `${label} (${n})`;
        if (!taken.has(next)) {
            return next;
        }
    }
}

/** The addChunk op that saves one item for later. `note` is the chunk's first note (see savedBody); `session` is the
 *  agent's `agent:<tabid>` and `conversation` its conversation id, which the server records on that note when the batch
 *  comes from the cockpit. `due` is a local date, YYYY-MM-DD. Empty arguments are left off the op. */
export function laterChunkOp(args: {
    label: string;
    note: string;
    session?: string;
    conversation?: string;
    due?: string;
}): EffortOp {
    const op: EffortOp = { op: "addChunk", label: args.label, later: true, note: args.note };
    if (args.session) {
        op.session = args.session;
    }
    if (args.conversation) {
        op.conversation = args.conversation;
    }
    if (args.due) {
        op.due = args.due;
    }
    return op;
}

/** The passage a saved note quotes: the `> ` lines of a savedBody note, unquoted one level, with the blank lines at
 *  either end dropped. Null when the note quotes nothing (a note an agent wrote in plain text). */
export function quotedPassage(note: string): string | null {
    const lines = note
        .split(/\r?\n/)
        .filter((l) => l.startsWith(">"))
        .map((l) => l.replace(/^>[ \t]?/, "").trimEnd());
    while (lines.length > 0 && lines[0] === "") {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines.length > 0 ? lines.join("\n") : null;
}
