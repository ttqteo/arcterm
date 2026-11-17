// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The commit suggestion in Chat, the pure model (docs/superpowers/specs/2026-11-17-chat-commit-card-design.md): the
// ```arc-commit block an agent writes where it would otherwise stop and ask before committing, read into a message and
// its files; the reply cut around it (with the ```arc-review blocks, chatverdict.ts, in one pass); what the card is doing
// (`commitMode`, the verdict card's modes); the line Commit sends; the ✓ row it folds into; and the send record, which
// shares the verdict's (VERDICT_TOPIC). No React, no jotai, no RPC: chatcommitcard.tsx draws, chatmodel.ts finds it.

import { plural } from "./brainstormmodel";
import type { SentAnswer } from "./chatbrainstorm";
import { parseReviewBlock, REVIEW_LANG, splitFences, VERDICT_TOPIC, type Verdict } from "./chatverdict";

export const COMMIT_LANG = "arc-commit";

/** What the agent suggests committing: the message as written (inner lines untouched), and the paths, in order. */
export type CommitSuggestion = { message: string; files: string[] };

/** What became of a commit card, as its ✓ row says: you pressed Commit (how many files went), you answered in your own
 *  words (`replied`), or the agent wrote on without waiting (`moved-on`). */
export type CommitOutcome = { kind: "sent"; files: number } | { kind: "replied" } | { kind: "moved-on" };

export type CommitMode = { mode: "waiting" | "working" | "static" } | { mode: "folded"; outcome: CommitOutcome | null };

// the line between the message and the files
const SEPARATOR = "---";

/** Pure: the body of an ```arc-commit block: the message, a line that is exactly `---`, then one path per line. The last
 *  `---` line is the separator (a path is never `---`, a message may hold one). The message keeps its inner lines and
 *  loses the blank lines around it; a path line is trimmed, a leading `- ` stripped, a blank or repeated one dropped.
 *  Null with no separator, an empty message or no files: the block then draws as code. */
export function parseCommitBlock(raw: string): CommitSuggestion | null {
    const lines = raw.split("\n").map((l) => l.replace(/\r$/, ""));
    let sep = -1;
    lines.forEach((l, i) => {
        if (l.trim() === SEPARATOR) {
            sep = i;
        }
    });
    if (sep < 0) {
        return null;
    }
    const message = lines
        .slice(0, sep)
        .join("\n")
        .replace(/^(?:[ \t]*\n)+/, "")
        .trimEnd();
    const files: string[] = [];
    for (const l of lines.slice(sep + 1)) {
        const path = l.replace(/^\s*-(?:\s+|$)/, "").trim();
        if (path !== "" && !files.includes(path)) {
            files.push(path);
        }
    }
    if (message.trim() === "" || files.length === 0) {
        return null;
    }
    return { message, files };
}

export type CardPiece =
    | { kind: "prose"; text: string }
    | { kind: "verdict"; verdict: Verdict }
    | { kind: "commit"; commit: CommitSuggestion };

/** Whether a reply may hold a card block, before it is split. */
export function hasCardBlock(text: string): boolean {
    return text.includes(REVIEW_LANG) || text.includes(COMMIT_LANG);
}

/** Pure: a reply as its prose and the cards cut out of it, in order: an ```arc-review block that parses is a verdict, an
 *  ```arc-commit block that parses a commit suggestion; everything else stays prose (splitFences). */
export function splitCardBlocks(text: string): CardPiece[] {
    const read = (lang: string, body: string): CardPiece | null => {
        if (lang === REVIEW_LANG) {
            const verdict = parseReviewBlock(body);
            return verdict != null ? { kind: "verdict", verdict } : null;
        }
        if (lang === COMMIT_LANG) {
            const commit = parseCommitBlock(body);
            return commit != null ? { kind: "commit", commit } : null;
        }
        return null;
    };
    return splitFences(text, read).map((p) => (p.kind === "prose" ? p : p.block));
}

// a fence longer than any run of backticks in the text, so a message that holds one stays inside
function fenceFor(text: string): string {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    return "`".repeat(Math.max(3, longest + 1));
}

/** The line Commit sends: the instruction, the message in a fence, then one `- <path>` per file, in the order given. */
export function commitLine(message: string, files: readonly string[]): string {
    const fence = fenceFor(message);
    return [
        "Commit exactly these files with exactly this message, unchanged:",
        "",
        fence,
        message,
        fence,
        "",
        ...files.map((f) => `- ${f}`),
    ].join("\n");
}

/** Pure: what the card does now, the verdict card's rules (chatverdict.ts verdictMode). `last` is whether it is the last
 *  part of the conversation, `live` that the agent is running, `working` that it is mid-turn, `nextIsYou` that your
 *  message follows the card; `record` is the card's send record, once Commit was pressed.
 *
 *  - a record: folded, Commit sent;
 *  - not the last part: folded, `replied` when your message follows, `moved-on` when the agent wrote on;
 *  - the last part of an agent that exited or of an ended session: static (no ticks, no button);
 *  - the last part while the agent works: `working`;
 *  - otherwise `waiting`: editable, with Commit. */
export function commitMode(i: {
    last: boolean;
    live: boolean;
    working: boolean;
    nextIsYou: boolean;
    record: Pick<SentAnswer, "files"> | null;
    c: CommitSuggestion;
}): CommitMode {
    if (i.record != null) {
        return { mode: "folded", outcome: { kind: "sent", files: i.record.files ?? i.c.files.length } };
    }
    if (!i.last) {
        return { mode: "folded", outcome: { kind: i.nextIsYou ? "replied" : "moved-on" } };
    }
    if (!i.live) {
        return { mode: "static" };
    }
    return { mode: i.working ? "working" : "waiting" };
}

/** The card's header: "Commit suggestion · 2 files". */
export function commitHead(n: number): string {
    return `Commit suggestion · ${plural(n, "file", "files")}`;
}

/** The ✓ row the card folds into: "Commit suggestion · 2 files — Commit sent" (the files that went), "… — You replied",
 *  and no tail for an agent that went on or a card nobody waited on. */
export function commitDoneLine(c: CommitSuggestion, outcome: CommitOutcome | null): string {
    if (outcome?.kind === "sent") {
        return `${commitHead(outcome.files)} — Commit sent`;
    }
    return commitHead(c.files.length) + (outcome?.kind === "replied" ? " — You replied" : "");
}

/** The record to keep once the Commit line was sent: under VERDICT_TOPIC beside the verdict cards' (a `verdict` record,
 *  so the line's message draws nothing), with the card's `key` (`commit:<entry index>`) and how many files went. `seen` is
 *  how many of the agent's user messages already held exactly `line` before the send (userTextCount). */
export function commitRecord(key: string, files: number, line: string, seen: number, now: number): SentAnswer {
    return {
        topic: VERDICT_TOPIC,
        n: 0,
        part: "",
        text: line,
        sentAt: now,
        seen,
        kind: "verdict",
        verdictKey: key,
        verdictOutcome: "commit",
        files,
    };
}
