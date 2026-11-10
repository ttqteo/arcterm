// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure rules of a message sent from the chat box while Claude works: the pending bubble that stands in for it until
// the transcript holds it, the history ↑ recalls, and when a send waits for a dialog. State lives in
// chatpendingstore.ts; the views in chatpane.tsx and chatcomposer.tsx.

import type { AgentEntry } from "./agentsviewmodel";

/** A message sent and not yet in the transcript. `seen` is how many of the agent's user entries already held its text
 *  when it was sent, so an earlier identical message is not taken for this one. */
export interface PendingMessage {
    id: string;
    text: string;
    sentAt: number;
    seen: number;
}

/** A pending bubble goes after this long even when the transcript never showed the text (Claude Code dropped it, or the
 *  session was reset). */
export const PENDING_MAX_MS = 120_000;

const HISTORY_MAX = 20;

/** How many of the entries are your messages with exactly this text (edge whitespace aside). */
export function userTextCount(entries: AgentEntry[], text: string): number {
    const want = text.trim();
    let n = 0;
    for (const e of entries) {
        if (e.kind === "user" && e.text.trim() === want) {
            n++;
        }
    }
    return n;
}

/** A pending bubble also goes once the agent has sat idle this long since it was sent (or since the agent went idle,
 *  whichever is later): Claude Code submits a queued message the moment its turn ends, so one still missing after
 *  that never went in (Esc in the terminal put it back in Claude Code's own box, or it was never submitted). */
export const PENDING_IDLE_MS = 5_000;

/** The pending messages still to draw: the transcript holds the text no more often than when it was sent, the
 *  message is not older than PENDING_MAX_MS, and the agent has not sat idle on it for PENDING_IDLE_MS. `idleSince`
 *  is when the agent last went idle, null while it works. */
export function pendingStill(
    pending: PendingMessage[],
    entries: AgentEntry[],
    now: number,
    idleSince: number | null = null
): PendingMessage[] {
    return pending.filter(
        (p) =>
            now - p.sentAt < PENDING_MAX_MS &&
            (idleSince == null || now - Math.max(idleSince, p.sentAt) < PENDING_IDLE_MS) &&
            userTextCount(entries, p.text) <= p.seen
    );
}

/** Whether a send gets a pending bubble. A `/command` does not, nor a bash-mode `! cmd`: the transcript records each as
 *  a command entry, which userTextCount never matches, so its bubble would stay up for PENDING_MAX_MS beside the real
 *  command row. */
export function pendsAsBubble(text: string): boolean {
    return !text.trimStart().startsWith("/") && !text.startsWith("!");
}

/** The sent history with `text` last: newest last, at most 20, no repeat of the newest. */
export function pushSent(history: string[], text: string): string[] {
    if (history[history.length - 1] === text) {
        return history;
    }
    return [...history, text].slice(-HISTORY_MAX);
}

/** ↑ / ↓ through the history from position `at` (null: the empty box). Up from the empty box gives the newest; down
 *  from the newest gives the empty box; up at the oldest stays. */
export function recall(history: string[], at: number | null, dir: "up" | "down"): { at: number | null; text: string } {
    if (history.length === 0) {
        return { at: null, text: "" };
    }
    if (dir === "up") {
        const next = at == null ? history.length - 1 : Math.max(0, Math.min(at, history.length - 1) - 1);
        return { at: next, text: history[next] };
    }
    if (at == null || at >= history.length - 1) {
        return { at: null, text: "" };
    }
    return { at: at + 1, text: history[at + 1] };
}

/** Why a send waits, or null. Typed into Claude Code's permission or question dialog, a message's first digit would pick
 *  an option ("2 more things" picks option 2), so the send is held until the dialog is answered. */
export function sendHold(permissionPending: boolean, asking: boolean): string | null {
    if (permissionPending) {
        return "Answer the permission prompt first";
    }
    if (asking) {
        return "Answer Claude's question first";
    }
    return null;
}

/** A message longer than this goes in as a paste even on one line: Claude Code reads a big chunk of typed input as a
 *  paste, and then takes an Enter that rides in the same chunk as one more line, so the message sat in its box. */
export const PASTE_OVER = 200;

/** Whether a send puts the message in as a paste (then Enter apart), rather than typing it with its Enter. */
export function pastesBody(message: string): boolean {
    return message.includes("\n") || message.length > PASTE_OVER;
}

/** How long a send waits between putting the message in and pressing Enter: Claude Code must have taken the whole
 *  paste first, or the Enter lands inside it as a line break. 80 ms (the backend's keystroke gap is 60) and 20 ms
 *  more per 1,000 characters, at most 600. */
export function submitDelayMs(length: number): number {
    return Math.min(600, 80 + Math.floor(length / 1000) * 20);
}
