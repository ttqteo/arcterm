// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure rules of a message sent from the chat box while Claude works: the pending bubble that stands in for it until
// the transcript holds it, the history ↑ recalls, and when a send waits for a dialog. State lives in
// chatpendingstore.ts; the views in chatpane.tsx and chatcomposer.tsx.

import type { AgentEntry } from "./agentsviewmodel";
import { opensPanel } from "./slashcommands";

/** What a pending command stands for until its row lands: a side question the arc mod is answering (`btw`), or a panel
 *  open on Claude Code's own screen (`panel`), which writes its row only once it closes. */
export type PendingKind = "btw" | "panel";

/** A message sent and not yet in the transcript. `seen` is how many of the agent's user entries already held its text
 *  when it was sent, so an earlier identical message is not taken for this one. */
export interface PendingMessage {
    id: string;
    text: string;
    sentAt: number;
    seen: number;
    kind?: PendingKind;
}

/** A pending bubble goes after this long even when the transcript never showed the text (Claude Code dropped it, or the
 *  session was reset). */
export const PENDING_MAX_MS = 120_000;

const HISTORY_MAX = 20;

// a command as it was typed, every run of whitespace one space: the transcript keeps a /btw's question on one line
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

/** How many of the entries are your messages with exactly this text (edge whitespace aside), or commands typed as it. */
export function userTextCount(entries: AgentEntry[], text: string): number {
    const want = text.trim();
    const wantFlat = flat(text);
    let n = 0;
    for (const e of entries) {
        if (e.kind === "user" && e.text.trim() === want) {
            n++;
        } else if (e.kind === "command" && !e.isSkill && flat(e.args ? `${e.name} ${e.args}` : e.name) === wantFlat) {
            n++;
        }
    }
    return n;
}

const BTW = /^\/btw\s+(\S[\s\S]*)$/;

/** Pure: the question of a `/btw <question>` sent from the box, or null for anything else (a bare /btw included). */
export function btwQuestion(text: string): string | null {
    return BTW.exec(text.trim())?.[1].trim() ?? null;
}

/** Pure: what a send stands for until its row lands, when it is a command with a pending bubble of its own: a side
 *  question, or a bare built-in whose panel shows on Claude Code's own screen. */
export function pendingKind(text: string): PendingKind | undefined {
    if (btwQuestion(text) != null) {
        return "btw";
    }
    const bare = /^\/([^\s/]+)$/u.exec(text.trim());
    return bare != null && opensPanel(bare[1]) ? "panel" : undefined;
}

/** A pending bubble also goes once the agent has sat idle this long since it was sent (or since the agent went idle,
 *  whichever is later): Claude Code submits a queued message the moment its turn ends, so one still missing after
 *  that never went in (Esc in the terminal put it back in Claude Code's own box, or it was never submitted). */
export const PENDING_IDLE_MS = 5_000;

/** The pending messages still to draw: the transcript holds the text no more often than when it was sent, the
 *  message is not older than PENDING_MAX_MS, and the agent has not sat idle on it for PENDING_IDLE_MS. `idleSince`
 *  is when the agent last went idle, null while it works. A side question or a panel waits on the agent while it sits
 *  idle (the answer comes from a fork, the panel's row once it closes), so only PENDING_MAX_MS ends those. */
export function pendingStill(
    pending: PendingMessage[],
    entries: AgentEntry[],
    now: number,
    idleSince: number | null = null
): PendingMessage[] {
    return pending.filter(
        (p) =>
            now - p.sentAt < PENDING_MAX_MS &&
            (p.kind != null || idleSince == null || now - Math.max(idleSince, p.sentAt) < PENDING_IDLE_MS) &&
            userTextCount(entries, p.text) <= p.seen
    );
}

/** Whether a send gets a pending bubble. A message does, and so does a command with a pending kind (a /btw, a bare
 *  panel command), which the chat would otherwise show nothing of for a while. Any other `/command` does not, nor a
 *  bash-mode `! cmd`: each lands as its command row at once, and some (a /clear) never land in this transcript. */
export function pendsAsBubble(text: string): boolean {
    if (pendingKind(text) != null) {
        return true;
    }
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

/** One step of typing a line into an agent's TUI and submitting it (agentsubmit.ts runs them). */
export type SubmitStep =
    | { kind: "type"; text: string }
    | { kind: "paste"; text: string }
    | { kind: "wait"; ms: number }
    | { kind: "enter" };

/** Pure: how a line goes into an agent's TUI and is submitted. Enter is always a write of its own, after a wait: Claude
 *  Code's input reader reads "\r" as Enter only when it arrives as its own chunk, and a "text\r" read in one chunk is one
 *  text token whose "\r" is a line break in the box, so the message sat there unsent (whether the PTY splits a single
 *  write is luck). A line with a break or past PASTE_OVER goes as a paste, any other is typed. */
export function submitSteps(text: string): SubmitStep[] {
    if (text === "") {
        return [{ kind: "enter" }];
    }
    return [
        pastesBody(text) ? { kind: "paste", text } : { kind: "type", text },
        { kind: "wait", ms: submitDelayMs(text.length) },
        { kind: "enter" },
    ];
}

/** How long a send waits between putting the message in and pressing Enter: Claude Code must have taken the whole
 *  paste first, or the Enter lands inside it as a line break. 80 ms (the backend's keystroke gap is 60) and 20 ms
 *  more per 1,000 characters, at most 600. */
export function submitDelayMs(length: number): number {
    return Math.min(600, 80 + Math.floor(length / 1000) * 20);
}
