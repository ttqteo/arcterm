// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure rules of a message sent from the chat box while Claude works: the pending bubble that stands in for it until
// the transcript holds it, the history ↑ recalls, and when a send waits for a dialog. State lives in
// chatpendingstore.ts; the views in chatpane.tsx and chatcomposer.tsx.

import type { AgentEntry } from "./agentsviewmodel";
import { stripResultLines } from "./chatinitiative";
import { unwrapWholePaste } from "./chattagblocks";
import type { EnterEcho, TypedEcho } from "./chattakeback";
import { opensPanel } from "./slashcommands";

/** What a pending command stands for until its row lands: a side question the arc mod is answering (`btw`), a panel
 *  open on Claude Code's own screen (`panel`), which writes its row only once it closes, or a bash-mode `! cmd` running
 *  (`bash`), whose row Claude Code writes only once it finishes or goes to the background at 120 s. */
export type PendingKind = "btw" | "panel" | "bash";

/** A message sent and not yet in the transcript. `seen` is how many of the agent's user entries already held its text
 *  when it was sent, so an earlier identical message is not taken for this one. */
export interface PendingMessage {
    id: string;
    text: string;
    sentAt: number;
    seen: number;
    kind?: PendingKind;
    /** Sent while the agent worked: Claude Code holds it for the turn's next gap, so it reads Queued and Send now can
     *  push it. Decided at the send, not from the agent's state as it draws: a message sent to an idle agent starts the
     *  turn that sets the agent working, and read live it flashed Queued before the transcript took it. */
    queued?: boolean;
}

/** The pending message for `text` sent at `now`: how many of `entries` (the transcript as drawn then) already hold its
 *  text, and whether the agent was `busy`, which makes it Queued. */
export function pendingMessage(
    id: string,
    text: string,
    entries: AgentEntry[],
    now: number,
    busy: boolean
): PendingMessage {
    const kind = pendingKind(text);
    return {
        id,
        text,
        sentAt: now,
        seen: userTextCount(entries, text),
        queued: busy,
        ...(kind != null ? { kind } : {}),
    };
}

/** The one line under the pending messages' bubbles, or null: the harness's starting line while a session starts, else
 *  Queued ("2 queued" for more) while messages sent as the agent worked wait. Messages sent to an idle agent have none:
 *  the transcript takes them in a moment, and a Sending… line there only blinked as the transcript's copy replaced the
 *  bubble. A command's card (a /btw, a panel, a `! cmd`) says what it waits on itself. */
export function pendingLine(pending: PendingMessage[], starting?: string): string | null {
    const messages = pending.filter((p) => p.kind == null);
    if (messages.length === 0) {
        return null;
    }
    if (starting != null) {
        return starting;
    }
    const queued = messages.filter((p) => p.queued === true).length;
    return queued === 0 ? null : queued === 1 ? "Queued" : `${queued} queued`;
}

/** Whether a message bubble captioned Queued is up, which Ctrl+Enter in the empty box sends now. */
export function queuedBubbleUp(pending: PendingMessage[]): boolean {
    return pending.some((p) => p.kind == null && p.queued === true);
}

/** A side question's or a panel's pending card goes after this long even when the transcript never showed its row. */
export const PENDING_MAX_MS = 120_000;

/** A message's Queued bubble goes after this long even when the transcript never showed it (Claude Code dropped it, or
 *  the session was reset). Claude Code takes a queued message only at the turn's next gap, so a long tool call holds it
 *  for minutes: at two minutes the bubble went while the message still waited. An idle agent drops it sooner
 *  (PENDING_IDLE_MS). */
export const PENDING_QUEUED_MAX_MS = 30 * 60_000;

const HISTORY_MAX = 20;

// a command as it was typed, every run of whitespace one space: the transcript keeps a /btw's question on one line
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

// the command of a bash-mode `! cmd`, every run of whitespace one space, or null for anything else (a bare ! included)
function bashCommand(text: string): string | null {
    const t = text.trimStart();
    if (!t.startsWith("!")) {
        return null;
    }
    const cmd = flat(t.slice(1));
    return cmd !== "" ? cmd : null;
}

/** How many of the entries are your messages with exactly this text (edge whitespace aside), or commands typed as it.
 *  A message Claude Code wrapped whole as a paste (a send with a picture or a line break goes in as one) counts as its
 *  body, or its Queued bubble never goes. A `! cmd` counts as its bash row (name `!`, the command as args). */
export function userTextCount(entries: AgentEntry[], text: string): number {
    const want = text.trim();
    const wantFlat = flat(text);
    const bash = bashCommand(text);
    let n = 0;
    for (const e of entries) {
        // the result lines Arc put in front of the message are no part of what the person wrote (stripResultLines also
        // unwraps a whole paste, so a message that carried them is compared by its own text)
        if (e.kind === "user" && unwrapWholePaste(stripResultLines(e.text)).trim() === want) {
            n++;
        } else if (e.kind === "command" && e.name === "!") {
            if (bash != null && flat(e.args ?? "") === bash) {
                n++;
            }
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
 *  question, a bare built-in whose panel shows on Claude Code's own screen, or a bash-mode `! cmd` running. */
export function pendingKind(text: string): PendingKind | undefined {
    if (btwQuestion(text) != null) {
        return "btw";
    }
    if (bashCommand(text) != null) {
        return "bash";
    }
    const bare = /^\/([^\s/]+)$/u.exec(text.trim());
    return bare != null && opensPanel(bare[1]) ? "panel" : undefined;
}

/** A pending bubble also goes once the agent has sat idle this long since it was sent (or since the agent went idle,
 *  whichever is later): Claude Code submits a queued message the moment its turn ends, so one still missing after
 *  that never went in (Esc in the terminal put it back in Claude Code's own box, or it was never submitted). */
export const PENDING_IDLE_MS = 5_000;

/** The pending messages still to draw: the transcript holds the text no more often than when it was sent, it is not
 *  older than PENDING_QUEUED_MAX_MS (a side question or a panel: PENDING_MAX_MS), and the agent has not sat idle on it
 *  for PENDING_IDLE_MS. `idleSince` is when the agent last went idle, null while it works. A side question or a panel
 *  waits on the agent while it sits idle (the answer comes from a fork, the panel's row once it closes), so only
 *  PENDING_MAX_MS ends those. */
export function pendingStill(
    pending: PendingMessage[],
    entries: AgentEntry[],
    now: number,
    idleSince: number | null = null
): PendingMessage[] {
    return pending.filter(
        (p) =>
            now - p.sentAt < (p.kind != null ? PENDING_MAX_MS : PENDING_QUEUED_MAX_MS) &&
            (p.kind != null || idleSince == null || now - Math.max(idleSince, p.sentAt) < PENDING_IDLE_MS) &&
            userTextCount(entries, p.text) <= p.seen
    );
}

/** Whether a send gets a pending bubble. A message does, and so does a command with a pending kind (a /btw, a bare
 *  panel command, a `! cmd`), which the chat would otherwise show nothing of for a while. Any other `/command` does
 *  not, nor a bare `!`: each lands as its command row at once, and some (a /clear) never land in this transcript. */
export function pendsAsBubble(text: string): boolean {
    if (pendingKind(text) != null) {
        return true;
    }
    return !text.trimStart().startsWith("/") && !text.startsWith("!");
}

/** Pure: whether a key in the chat box is Send now's: Ctrl+Enter, Cmd+Enter on a Mac, nothing else held. */
export function isSendNowKey(
    e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
    mac: boolean
): boolean {
    return e.key === "Enter" && !e.shiftKey && !e.altKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
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

/** The line over the box while a send waits (sendHold): what to answer first, and that Send keeps the message until then;
 *  once Send was pressed, that the message goes by itself when the prompt is answered. Null when nothing holds. */
export function holdLine(hold: string | null, held: boolean): string | null {
    if (hold == null) {
        return null;
    }
    return held ? "Queued · sends once you answer" : `${hold} · Send queues your message`;
}

/** Whether a message queued behind a prompt goes now: the prompt is answered and the box can send. */
export function releasesHeld(held: boolean, hold: string | null, sendable: boolean): boolean {
    return held && hold == null && sendable;
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
    // `echo`: after `ms`, keep waiting (at most ECHO_WAIT_MAX_MS) until the box shows this text (boxShowsTyped)
    | { kind: "wait"; ms: number; echo?: string }
    | { kind: "enter" };

/** How long a send waits at most for Claude Code's box to show the message before it presses Enter anyway. */
export const ECHO_WAIT_MAX_MS = 2_000;

/** How long a send waits on a box that stays empty before it gives up without pressing Enter. Longer than
 *  ECHO_WAIT_MAX_MS: Claude Code draws what it read only when its event loop is free, so a busy turn can show the text
 *  late, and a text that shows after the send gave up sits in its box unsent. */
export const ECHO_ABSENT_MAX_MS = 8_000;

/** Pure: what a send does after waiting `waitedMs` on the box's echo (chattakeback.ts typedEcho): press Enter, wait
 *  more, or fail. Only a box that stays empty fails: the text never reached Claude Code, and an Enter would submit
 *  nothing (a chat message read Queued for good, 2026-11-13). A box holding something else gets Enter after
 *  ECHO_WAIT_MAX_MS as before, since the text may be drawn in a way the read does not match. */
export function echoStep(echo: TypedEcho, waitedMs: number): "enter" | "wait" | "fail" {
    switch (echo) {
        case "shown":
        case "unknown":
            return "enter";
        case "other":
            return waitedMs >= ECHO_WAIT_MAX_MS ? "enter" : "wait";
        case "absent":
            return waitedMs >= ECHO_ABSENT_MAX_MS ? "fail" : "wait";
    }
}

/** How long a send watches Claude Code's box after its Enter for the text to leave it. Past it the send is taken as
 *  done: an Enter not read yet is still on its way. */
export const ENTER_CONFIRM_MAX_MS = 10_000;

/** How many times a send takes back an Enter that went in as a line break and presses it again before it gives up. */
export const ENTER_RETRIES = 2;

/** Pure: what a send does `waitedMs` after its Enter, from what the box shows (chattakeback.ts enterEcho) and how many
 *  retries it made: `done` once the text left the box (or there is no box to read, or the watch is over), `retry` when
 *  the Enter went in as a line break (Backspace, then Enter again), `fail` when it did so after every retry, so the
 *  message waits in Claude Code's box for an Enter of the person's. */
export function enterStep(echo: EnterEcho, waitedMs: number, retries: number): "done" | "wait" | "retry" | "fail" {
    switch (echo) {
        case "gone":
        case "unknown":
            return "done";
        case "held":
            return waitedMs >= ENTER_CONFIRM_MAX_MS ? "done" : "wait";
        case "linebreak":
            return retries < ENTER_RETRIES ? "retry" : "fail";
    }
}

/** Where a send failed: `type`, writing the text into the terminal; `echo`, the text never showed in Claude Code's box;
 *  `enter`, the Enter after a text that did show. */
export type SubmitStage = "type" | "echo" | "enter";

export class SubmitError extends Error {
    constructor(
        readonly stage: SubmitStage,
        message: string
    ) {
        super(message);
        this.name = "SubmitError";
    }
}

/** What the person is told of a failed send, and whether the text goes back into the chat box: it does when none of it
 *  is in Claude Code's box (typing failed, or it never showed there), not when only the Enter failed, where it waits in
 *  Claude Code's box and sending it again would put it there twice. Any other error counts as a failed typing. */
export interface SendFailure {
    stage: SubmitStage;
    reason: string;
    restore: boolean;
    message: string;
}

export function sendFailure(e: unknown): SendFailure {
    const stage: SubmitStage = e instanceof SubmitError ? e.stage : "type";
    const reason = e instanceof Error ? e.message : String(e);
    switch (stage) {
        case "enter":
            return {
                stage,
                reason,
                restore: false,
                message: `It is in Claude Code's box but the Enter did not go through (${reason}): press Enter in the terminal.`,
            };
        case "echo":
            return {
                stage,
                reason,
                restore: true,
                message: "Claude Code never showed it in its box, so it was not sent. It is back in the chat box.",
            };
        default:
            return {
                stage,
                reason,
                restore: true,
                message: `It could not be typed into the terminal (${reason}). It is back in the chat box.`,
            };
    }
}

/** The waveapp.log line of a failed send: the block's short id, the stage, the text's length (never the text) and the
 *  reason on one line. */
export function sendFailLogLine(blockId: string, text: string, f: SendFailure): string {
    const err = f.reason.replace(/\s+/g, " ").replace(/"/g, '\\"');
    return `[chat-send] fail block=${blockId.slice(0, 8)} stage=${f.stage} len=${Array.from(text).length} err="${err}"`;
}

/** Pure: how a line goes into an agent's TUI and is submitted. Enter is always a write of its own, after the box shows
 *  the text: Claude Code's input reader reads "\r" as Enter only when it arrives as its own chunk, and a "text\r" read in
 *  one chunk is one text token whose "\r" is a line break in the box, so the message sat there unsent. A fixed wait
 *  between the two writes was not enough: Claude Code reads its input only when its event loop is free, and both writes
 *  waiting there land in one read (a 65-character message to an idle Claude took the next message's text on the line
 *  after it, and both went as one prompt). Once the box shows the text it has been read, so the Enter comes alone. A line
 *  with a break or past PASTE_OVER goes as a paste, any other is typed. */
export function submitSteps(text: string): SubmitStep[] {
    if (text === "") {
        return [{ kind: "enter" }];
    }
    return [
        pastesBody(text) ? { kind: "paste", text } : { kind: "type", text },
        { kind: "wait", ms: submitDelayMs(text.length), echo: text },
        { kind: "enter" },
    ];
}

/** How long a send waits between putting the message in and pressing Enter: Claude Code must have taken the whole
 *  paste first, or the Enter lands inside it as a line break. 80 ms (the backend's keystroke gap is 60) and 20 ms
 *  more per 1,000 characters, at most 600. */
export function submitDelayMs(length: number): number {
    return Math.min(600, 80 + Math.floor(length / 1000) * 20);
}
