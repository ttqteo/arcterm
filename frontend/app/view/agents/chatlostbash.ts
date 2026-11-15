// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A `! cmd` sent from Chat that arcterm's restart cut short. Claude Code writes a bash-mode command to the transcript
// only once it finishes, so one that closes arcterm and the Claude Code running it (`! task install`) never lands, and
// its pending bubble, which lives only in the page, goes with the restart: nothing showed the command was run. Chat keeps
// each `!` it sends, with the last transcript record before it as its place, and after a restart draws one the
// transcript still lacks as its `!` row there, with a note that its output was lost. Pure; the kept list is
// chatlostbashstore.ts's (localStorage).

import type { AgentEntry } from "./agentsviewmodel";
import type { ChatItem } from "./chatmodel";
import { pendingKind, userTextCount } from "./chatpending";

/** A kept `!` is dropped this long after it was sent, landed or not. */
export const LOST_BASH_KEEP_MS = 14 * 24 * 60 * 60_000;

/** The most `!` sends kept, newest kept first. */
export const LOST_BASH_MAX = 50;

/** The note under a `!` row the restart cut short. */
export const LOST_BASH_NOTE = "Sent before arcterm restarted · its output was not kept";

/** A `!` sent from Chat: in which session (its transcript's path), what was typed, when, how many of the transcript's
 *  rows already read the same then (as a pending bubble counts them), and the last transcript record before it. */
export interface LostBash {
    session: string;
    text: string;
    sentAt: number;
    seen: number;
    after: string;
}

// the uuid of the last entry that has one: a message of yours or of the agent's
function lastUuid(entries: AgentEntry[]): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if ((e.kind === "user" || e.kind === "message") && e.uuid) {
            return e.uuid;
        }
    }
    return undefined;
}

/** Pure: the record to keep for `text` sent to `session` at `now`, or null when it is no `! cmd`, or the transcript has
 *  no record yet to place it after (a first message: its row would have nowhere to go). */
export function lostBashOf(session: string, text: string, entries: AgentEntry[], now: number): LostBash | null {
    if (session === "" || pendingKind(text) !== "bash") {
        return null;
    }
    const after = lastUuid(entries);
    if (after == null) {
        return null;
    }
    return { session, text, sentAt: now, seen: userTextCount(entries, text), after };
}

/** Pure: `kept` with `rec` added, newest last, the oldest dropped past LOST_BASH_MAX. */
export function keepLostBash(kept: readonly LostBash[], rec: LostBash): LostBash[] {
    return [...kept, rec].slice(-LOST_BASH_MAX);
}

/** Pure: whether the transcript holds the command now, so it ran to its end and lands as its own row. */
function landed(rec: LostBash, entries: AgentEntry[]): boolean {
    return userTextCount(entries, rec.text) > rec.seen;
}

/** Pure: `kept` without what no longer needs keeping: the records of `session` the transcript now holds (whose `after`
 *  record it reads too, so the transcript shown is the one the record was made against), and any record past
 *  LOST_BASH_KEEP_MS. Answers `kept` itself when nothing goes. */
export function pruneLostBash(
    kept: readonly LostBash[],
    session: string,
    entries: AgentEntry[],
    now: number
): readonly LostBash[] {
    const shown = new Set(
        entries.flatMap((e) => ((e.kind === "user" || e.kind === "message") && e.uuid ? [e.uuid] : []))
    );
    const next = kept.filter(
        (r) =>
            now - r.sentAt < LOST_BASH_KEEP_MS && !(r.session === session && shown.has(r.after) && landed(r, entries))
    );
    return next.length === kept.length ? kept : next;
}

/** Pure: the records of `session` to draw: sent before this page loaded (`loadedAt`: one sent since still has its
 *  pending bubble), and still missing from the transcript. */
export function lostBashToDraw(
    kept: readonly LostBash[],
    session: string,
    entries: AgentEntry[],
    loadedAt: number
): LostBash[] {
    return kept.filter((r) => r.session === session && r.sentAt < loadedAt && !landed(r, entries));
}

// whether the item holds the record `uuid`: a message of yours, or a part of the agent's group
function holds(item: ChatItem, uuid: string): boolean {
    if (item.kind === "you") {
        return "text" in item && item.uuid === uuid;
    }
    if (item.kind === "agent") {
        return item.parts.some((p) => p.kind === "prose" && p.uuid === uuid);
    }
    return false;
}

/** Pure: `items` with each lost `!` drawn as its row right after the item holding the record it was sent after, in the
 *  order they were sent. One whose record is not among the items (an earlier stretch not loaded) is left out. Answers
 *  `items` itself when nothing is drawn. */
export function withLostBash(items: ChatItem[], lost: readonly LostBash[]): ChatItem[] {
    if (lost.length === 0) {
        return items;
    }
    const byItem = new Map<number, LostBash[]>();
    for (const r of [...lost].sort((a, b) => a.sentAt - b.sentAt)) {
        const at = items.findIndex((item) => holds(item, r.after));
        if (at >= 0) {
            byItem.set(at, [...(byItem.get(at) ?? []), r]);
        }
    }
    if (byItem.size === 0) {
        return items;
    }
    const out: ChatItem[] = [];
    items.forEach((item, i) => {
        out.push(item);
        for (const r of byItem.get(i) ?? []) {
            out.push({
                kind: "you",
                key: `you:lost:${r.sentAt}`,
                command: `! ${r.text.trimStart().slice(1).trim()}`,
                lost: LOST_BASH_NOTE,
            });
        }
    });
    return out;
}
