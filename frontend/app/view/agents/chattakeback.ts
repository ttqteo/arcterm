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
import type { PendingMessage } from "./chatpending";

/** What a key takes back: `queued`, the messages sent while Claude worked (↑ in Claude Code's box); `interrupt`, the
 *  message that started a turn Claude has not answered yet (Esc in Claude Code's box stops it). `ids` are the pending
 *  bubbles that go with it. */
export interface TakeBack {
    kind: "queued" | "interrupt";
    ids: string[];
    texts: string[];
}

/** What Esc or ↑ in an empty chat box takes back, or null when the key keeps its old job (Esc lets go of the box, ↑
 *  recalls the history). Only while Claude works: idle, nothing waits; asking, the keys belong to its dialog. A queued
 *  message (a plain one: Claude Code leaves commands queued) goes back with either key, and the turn runs on; with none,
 *  Esc stops a turn that has no answer yet, for the message that started it. ↑ never stops a turn. */
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
        return { kind: "queued", ids: queued.map((p) => p.id), texts: queued.map((p) => p.text) };
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
        return { kind: "interrupt", ids: [], texts: [last.text] };
    }
    return null;
}

// a rule of Claude Code's input box: a row of ─ alone
const isRule = (row: string): boolean => {
    const t = row.trim();
    return t.length >= 8 && /^─+$/.test(t);
};

/** The rows of Claude Code's input box at the foot of the screen: between the last two rules. null when the screen shows
 *  no box (a dialog covers it). The conversation above holds your messages too, so only these rows say what the box
 *  holds. */
export function inputBoxRows(lines: string[]): string[] | null {
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

/** The chat box after a take-back: the messages first, one per line, then what the box held, as Claude Code's box puts
 *  them back ahead of your draft. */
export function mergeTaken(texts: string[], box: string): string {
    const taken = texts.join("\n");
    return box === "" ? taken : `${taken}\n${box}`;
}
