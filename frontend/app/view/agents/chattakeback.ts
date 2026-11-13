// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Taking a sent message back into the chat box, the way Claude Code's own box does it. Chat types a message into the
// agent's terminal, so a message Claude has not taken yet sits in Claude Code, not here: ↑ in Claude Code's box takes
// its queued messages back without stopping the turn (v2.1.69 on), and Esc before any reply stops the turn and puts the
// prompt back in its box (v2.1.83 on). Chat sends that key, waits until the text shows in Claude Code's box, clears the
// box there and puts the text in its own. A text that never shows (Claude took it, or answered first) is left alone.
// The keys and the screen are chattakebackstore.ts's; these are the rules.

import type { AgentEntry, AgentState } from "./agentsviewmodel";
import { stripResultLines } from "./chatinitiative";
import type { PendingMessage } from "./chatpending";

/** What a key takes back: `queued`, the messages sent while Claude worked (↑ in Claude Code's box); `interrupt`, the
 *  message that started a turn Claude has not answered yet (Esc in Claude Code's box stops it). `ids` are the pending
 *  bubbles that go with it. */
export interface TakeBack {
    kind: "queued" | "interrupt";
    ids: string[];
    texts: string[];
}

/** What Esc or ↑ in an empty chat box takes back, or null when nothing comes back (the composer then stops the turn for
 *  Esc, and ↑ recalls the history). Only while Claude works: idle, nothing waits; asking, the keys belong to its dialog.
 *  Esc stops the turn, as it does in Claude Code's box, which puts the queued messages (plain ones: Claude Code leaves
 *  commands queued) back in its box, or with none, the message that started a turn with no answer yet. ↑ takes the
 *  queued messages back and the turn runs on; it never stops a turn. */
export function takeBackPlan(
    key: "Escape" | "ArrowUp",
    pending: PendingMessage[],
    entries: AgentEntry[] | null,
    state: AgentState
): TakeBack | null {
    if (state !== "working") {
        return null;
    }
    const queued = pending.filter((p) => p.kind == null && p.queued === true);
    if (queued.length > 0) {
        const kind = key === "Escape" ? "interrupt" : "queued";
        return { kind, ids: queued.map((p) => p.id), texts: queued.map((p) => p.text) };
    }
    if (key !== "Escape") {
        return null;
    }
    const sending = pending.filter((p) => p.kind == null && p.queued !== true);
    if (sending.length > 0) {
        return { kind: "interrupt", ids: sending.map((p) => p.id), texts: sending.map((p) => p.text) };
    }
    const last = entries?.[entries.length - 1];
    if (last?.kind === "user") {
        // what comes back into the box is what the person wrote: the result lines Arc put in front of it are not theirs
        return { kind: "interrupt", ids: [], texts: [stripResultLines(last.text)] };
    }
    return null;
}

// a rule of Claude Code's input box: a row of ─ alone
const isRule = (row: string): boolean => {
    const t = row.trim();
    return t.length >= 8 && /^─+$/.test(t);
};

// a rule at the front of a line, and what follows it
const ruleHead = /^(\s*─{8,})(.*)$/;

// Claude Code draws its rules the terminal's full width, so xterm marks the row after one as a wrap of it and the screen
// reader (termutil.ts bufferLinesToText) joins the two: "────…────❯ text", "────…────⏵⏵ auto mode on". No rule stood
// alone, no box was ever found, and every send pressed Enter at once with nothing to check it (2026-11-13: 36 of 36
// sends logged echo=unknown). This splits the rule back off.
function splitRules(lines: string[]): string[] {
    return lines.flatMap((line) => {
        const m = ruleHead.exec(line);
        return m == null || m[2].trim() === "" ? [line] : [m[1], m[2]];
    });
}

/** The rows of Claude Code's input box at the foot of the screen: between the last two rules. null when the screen shows
 *  no box (a dialog covers it). The conversation above holds your messages too, so only these rows say what the box
 *  holds. */
export function inputBoxRows(screen: string[]): string[] | null {
    const lines = splitRules(screen);
    let bottom = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!isRule(lines[i])) {
            continue;
        }
        if (bottom < 0) {
            bottom = i;
            continue;
        }
        return lines.slice(i + 1, bottom);
    }
    return null;
}

const squash = (s: string): string => s.replace(/\s+/g, "");

/** Whether Claude Code's box holds the taken-back text: the start of its first line (wrapping aside), or the placeholder
 *  Claude Code shows for a pasted one. */
export function boxHolds(lines: string[], texts: string[]): boolean {
    const rows = inputBoxRows(lines);
    if (rows == null) {
        return false;
    }
    const box = squash(rows.map((r) => r.replace(/^\s*❯/, "")).join(""));
    if (box.includes("[Pastedtext")) {
        return true;
    }
    const first = squash((texts[0] ?? "").split("\n")[0]).slice(0, 30);
    return first !== "" && box.includes(first);
}

// the end of a typed text that has to show in the box: enough to tell it from what the box held before
const TYPED_TAIL = 24;

/** Whether Claude Code's box shows the end of `text` just typed or pasted into it (wrapping aside), or the placeholder
 *  it draws for a paste: its input reader has taken all of it, so an Enter written now is a chunk of its own. null when
 *  the screen shows no box (a dialog covers it), when there is nothing to wait for. */
export function boxShowsTyped(lines: string[], text: string): boolean | null {
    const rows = inputBoxRows(lines);
    if (rows == null) {
        return null;
    }
    const box = squash(rows.map((r) => r.replace(/^\s*❯/, "")).join("")).normalize("NFC");
    if (box.includes("[Pastedtext")) {
        return true;
    }
    const tail = squash(text).normalize("NFC").slice(-TYPED_TAIL);
    return tail === "" || box.includes(tail);
}

/** What Claude Code's box shows of a text a send just typed: `shown`, all of it (boxShowsTyped); `absent`, the box is on
 *  screen and empty, so none of it has reached Claude Code yet; `other`, the box holds something that is not the text
 *  (part of it, a draft, a bash-mode prompt drawn its own way); `unknown`, no screen or no box to read. Only `absent`
 *  says the text is missing: anything else in the box may be how it draws the text. */
export type TypedEcho = "shown" | "absent" | "other" | "unknown";

export function typedEcho(lines: string[] | null, text: string): TypedEcho {
    if (lines == null) {
        return "unknown";
    }
    const shows = boxShowsTyped(lines, text);
    if (shows == null) {
        return "unknown";
    }
    if (shows) {
        return "shown";
    }
    const rows = inputBoxRows(lines) ?? [];
    return squash(rows.map((r) => r.replace(/^\s*❯/, "")).join("")) === "" ? "absent" : "other";
}

/** What Claude Code's box shows of a sent text once its Enter is written: `gone`, the text left the box (submitted, or
 *  queued while Claude works); `linebreak`, the text is still there with an empty row under it, so the Enter went in as
 *  a line break and the message sits unsent (2026-11-13: Claude Code, slowed by a machine short of RAM, read the Enter
 *  as part of the text); `held`, the text alone, its Enter not read yet; `unknown`, no box to read. */
export type EnterEcho = "gone" | "linebreak" | "held" | "unknown";

export function enterEcho(lines: string[] | null, text: string): EnterEcho {
    if (lines == null) {
        return "unknown";
    }
    const rows = inputBoxRows(lines);
    if (rows == null) {
        return "unknown";
    }
    if (boxShowsTyped(lines, text) !== true) {
        return "gone";
    }
    const last = rows[rows.length - 1] ?? "";
    return rows.length >= 2 && squash(last.replace(/^\s*❯/, "")) === "" ? "linebreak" : "held";
}

/** The chat box after a take-back: the messages first, one per line, then what the box held, as Claude Code's box puts
 *  them back ahead of your draft. */
export function mergeTaken(texts: string[], box: string): string {
    const taken = texts.join("\n");
    return box === "" ? taken : `${taken}\n${box}`;
}

/** how long after a take-back the record it took may still reach Chat: Claude Code wrote it before the Esc, and Chat
 *  draws it at its next read of the transcript */
export const TAKEN_BACK_LANDS_MS = 5_000;

/** A message Esc took back after Claude Code had written it to the transcript. Claude Code's rewind keeps the record, and
 *  only the next prompt, branching off before it, makes it the dead branch the projection drops; until then it stood in
 *  the conversation as sent, beside its own text back in the box (2026-11-14, on Windows). `uuids` are its records found
 *  so far, `texts` the ones not found yet, which may still land until `at` + TAKEN_BACK_LANDS_MS, and `known` the user
 *  records Chat held at the take-back, which a message sent again later is never one of. */
export interface TakenBack {
    at: number;
    uuids: string[];
    texts: string[];
    known: string[];
}

// the person's messages after the agent's last reply (a message, a tool call or a command), oldest first
function trailingUsers(entries: readonly AgentEntry[]): Extract<AgentEntry, { kind: "user" }>[] {
    const out: Extract<AgentEntry, { kind: "user" }>[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "message" || e.kind === "action" || e.kind === "command") {
            break;
        }
        if (e.kind === "user") {
            out.unshift(e);
        }
    }
    return out;
}

// the trailing messages of `texts`, one record each, leaving out `skip`; and the texts no record matched
function matchTrailing(
    entries: readonly AgentEntry[],
    texts: readonly string[],
    skip: ReadonlySet<string>
): { uuids: string[]; texts: string[] } {
    const left = [...texts];
    const uuids: string[] = [];
    for (const e of trailingUsers(entries)) {
        if (e.uuid == null || skip.has(e.uuid)) {
            continue;
        }
        const i = left.indexOf(stripResultLines(e.text));
        if (i >= 0) {
            uuids.push(e.uuid);
            left.splice(i, 1);
        }
    }
    return { uuids, texts: left };
}

/** Pure: what an Esc take-back (`plan.kind` interrupt) took, against what Chat held when the key went: a message that
 *  had landed is found at once, among the person's messages since the agent's last reply. */
export function takenBackOf(plan: TakeBack, entries: readonly AgentEntry[], now: number): TakenBack {
    const known = entries.flatMap((e) => (e.kind === "user" && e.uuid != null ? [e.uuid] : []));
    const { uuids, texts } = matchTrailing(entries, plan.texts, new Set());
    return { at: now, uuids, texts, known };
}

/** Pure: `entries` without the records a take-back took, and the take-back with the records found now (null when none
 *  was), to keep, so they stay hidden past the wait. A text not found yet is looked for among the records Chat did not
 *  hold at the take-back, until TAKEN_BACK_LANDS_MS has passed. */
export function withoutTakenBack(
    entries: AgentEntry[],
    taken: TakenBack | undefined,
    now: number
): { entries: AgentEntry[]; next: TakenBack | null } {
    if (taken == null) {
        return { entries, next: null };
    }
    let next: TakenBack | null = null;
    if (taken.texts.length > 0 && now - taken.at <= TAKEN_BACK_LANDS_MS) {
        const found = matchTrailing(entries, taken.texts, new Set([...taken.known, ...taken.uuids]));
        if (found.uuids.length > 0) {
            next = { ...taken, uuids: [...taken.uuids, ...found.uuids], texts: found.texts };
        }
    }
    const hide = new Set((next ?? taken).uuids);
    if (hide.size === 0) {
        return { entries, next };
    }
    const kept = entries.filter((e) => !(e.kind === "user" && e.uuid != null && hide.has(e.uuid)));
    return { entries: kept.length === entries.length ? entries : kept, next };
}
