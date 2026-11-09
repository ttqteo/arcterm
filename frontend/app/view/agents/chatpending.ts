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

/** The pending messages still to draw: the transcript holds the text no more often than when it was sent, and the
 *  message is not older than PENDING_MAX_MS. */
export function pendingStill(pending: PendingMessage[], entries: AgentEntry[], now: number): PendingMessage[] {
    return pending.filter((p) => now - p.sentAt < PENDING_MAX_MS && userTextCount(entries, p.text) <= p.seen);
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
export function recall(
    history: string[],
    at: number | null,
    dir: "up" | "down"
): { at: number | null; text: string } {
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
