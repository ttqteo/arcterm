// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: which "before" a Doc review diffs against. After Request changes the next round should show only what the
// agent did with the comments, so a file reviewed before diffs against what that review showed; a first review
// diffs against the file at the agent session's start ref, else HEAD, else nothing (a new file: all insertions).
// The caller has already read the texts; null means that read found nothing.

export type BaselineFrom = "previous" | "session" | "head" | "new";

export function pickBaseline(input: {
    shown?: { text: string; at: number };
    atSession?: string | null;
    atHead?: string | null;
}): { text: string; from: BaselineFrom; reviewedAt?: number } {
    const { shown, atSession, atHead } = input;
    if (shown != null) {
        return { text: shown.text, from: "previous", reviewedAt: shown.at };
    }
    if (atSession != null) {
        return { text: atSession, from: "session" };
    }
    if (atHead != null) {
        return { text: atHead, from: "head" };
    }
    return { text: "", from: "new" };
}
