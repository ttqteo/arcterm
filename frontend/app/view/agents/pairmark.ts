// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The judge round's mark in the working agent's own Chat (docs/superpowers/specs/2026-11-26-judge-on-reply-design.md,
// decision 3), pure: which reply a round started from, which turns its bar covers, and the words of the line under that
// reply. chatpairmark.tsx draws it; chatconversation.tsx puts the lines in their own rows and the bar on the rows.
//
// A pair's first worker message is the reply the judge owes an answer to, and its last is where an ended round's bar stops.
// Both are found in Chat by their text: `PairMessage.text` is Go's `agentpair.Body(raw)` (the last arc-pair and arc-judge
// fences and a leading `> ` line taken out) while a Chat prose part holds the raw reply, so `replyBody` ports the text half
// of `Body` and a reply matches when its body equals the message's text. No stored field, and one rule for both ends. A
// first message that is not in the loaded Chat (a reply of an earlier session) marks nothing. When two replies match, the
// later one wins.
// Times in a mark are Unix ms.

import type { ChatItem } from "./chatmodel";
import { JUDGE_LANG, PAIR_LANG } from "./pairblocks";

// a fence opening (``` or ~~~, three or more, at most three spaces in) and its info string's first word, and a fence
// closing: pkg/agentpair/blocks.go fencesOf and chatsteplist.ts topFencesOf read the same way
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
// the line a reply answers, opening it: `> the line` (the line's text is not needed here)
const QUOTE_LINE = /^ {0,3}>/;

interface Fence {
    lang: string;
    /** line indexes: the opening line, and the closing one (the last line when the fence is left open) */
    start: number;
    end: number;
}

/** The top-level fences of a reply, in order: a fence closes on a line of the same character at least as long, so a block
 *  shown inside a longer fence is not one; a fence left open runs to the end, as Markdown draws it. */
function fencesOf(lines: readonly string[]): Fence[] {
    const out: Fence[] = [];
    let open: { marker: string; lang: string; start: number } | null = null;
    for (let i = 0; i < lines.length; i++) {
        if (open == null) {
            const m = FENCE_OPEN.exec(lines[i]);
            if (m != null) {
                open = { marker: m[1], lang: m[2], start: i };
            }
            continue;
        }
        const close = FENCE_CLOSE.exec(lines[i]);
        if (close != null && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
            out.push({ lang: open.lang, start: open.start, end: i });
            open = null;
        }
    }
    if (open != null) {
        out.push({ lang: open.lang, start: open.start, end: lines.length - 1 });
    }
    return out;
}

function trimBlankLines(lines: string[]): string[] {
    let from = 0;
    let to = lines.length;
    while (from < to && lines[from].trim() === "") {
        from++;
    }
    while (to > from && lines[to - 1].trim() === "") {
        to--;
    }
    return lines.slice(from, to);
}

/** Pure: the text of an agent's reply as the pair keeps it, the text half of Go's `agentpair.Body`: the last top-level
 *  arc-pair fence and the last arc-judge fence taken out, the blank lines around what is left trimmed, and a leading `> `
 *  line dropped. */
export function replyBody(raw: string): string {
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const drop = new Set<number>();
    // a reply with neither name has no fence of either to take out (Go's lastFence says the same)
    if (raw.includes(PAIR_LANG) || raw.includes(JUDGE_LANG)) {
        const fences = fencesOf(lines);
        for (const lang of [PAIR_LANG, JUDGE_LANG]) {
            for (let i = fences.length - 1; i >= 0; i--) {
                if (fences[i].lang === lang) {
                    for (let l = fences[i].start; l <= fences[i].end; l++) {
                        drop.add(l);
                    }
                    break;
                }
            }
        }
    }
    let kept = trimBlankLines(drop.size === 0 ? lines : lines.filter((_, i) => !drop.has(i)));
    if (kept.length > 0 && QUOTE_LINE.test(kept[0])) {
        kept = trimBlankLines(kept.slice(1));
    }
    return kept.join("\n");
}

// ---- which reply a round started from, and the turns it covers ----

/** One judge round's line under the reply it started from. `startTs` is when the round began (the view's `createdts`: on an
 *  older reply that is later than the reply's own time), `endTs` the time of its last message (`lastts`), `agreed` and `open`
 *  the counts of its Decided list. */
export type PairMarkLine = {
    pairId: string;
    state: "reading" | "live" | "ended";
    startTs: number;
    endTs: number;
    agreed: number;
    open: number;
};

/** The round whose bar an item carries, and whether that round has ended (a grey bar). */
export type PairBar = { pairId: string; ended: boolean };

/** What Chat draws for an agent's pairs, both keyed by Chat item key: the lines under an item (an item that started two
 *  rounds has two, the older round first) and the owner of an item's bar (the newer round where two cover the item). */
export type PairMarks = {
    lines: Map<string, PairMarkLine[]>;
    bars: Map<string, PairBar>;
};

/** The pairs this agent is the working agent of, by id, among the active ones and the project's history (which holds the
 *  active ones too): each once. */
export function agentPairIds(
    agentId: string,
    live: readonly PairInfo[],
    history: readonly PairInfo[] | null | undefined
): string[] {
    const ids = new Set<string>();
    for (const pair of [...live, ...(history ?? [])]) {
        if (pair.worker?.tab === agentId) {
            ids.add(pair.id);
        }
    }
    return [...ids];
}

/** Pure: the marks of the pairs of one working agent over its Chat items. A pair marks the agent item whose prose (as
 *  `replyBody` reads it) equals its first worker message's text; its bar runs from that item to the last item while the pair
 *  is not ended, and to the item of its last worker message once it is (the first item alone when that message is not
 *  found). Where bars overlap the newer pair (the later `createdts`) owns the item. A pair with no worker message, or whose
 *  first one is not found, marks nothing. */
export function pairMarks(items: readonly ChatItem[], pairs: readonly PairView[]): PairMarks {
    const marks: PairMarks = { lines: new Map(), bars: new Map() };
    if (pairs.length === 0 || items.length === 0) {
        return marks;
    }
    // what each agent item's prose parts say as the pair keeps it, read once for all the pairs and only if one needs it
    let bodies: (string[] | null)[] | null = null;
    const indexOfReply = (text: string): number => {
        bodies ??= items.map((item) =>
            item.kind === "agent"
                ? item.parts.flatMap((part) => (part.kind === "prose" ? [replyBody(part.text).trim()] : []))
                : null
        );
        for (let i = bodies.length - 1; i >= 0; i--) {
            if (bodies[i]?.includes(text)) {
                return i;
            }
        }
        return -1;
    };

    const owners: (PairBar | undefined)[] = new Array(items.length);
    // oldest first: a later round's bar is written over an earlier one's, and its line comes after
    for (const view of [...pairs].sort((a, b) => a.createdts - b.createdts)) {
        const messages = view.messages ?? [];
        const firstAt = messages.findIndex((m) => m.from === "worker");
        const firstText = firstAt < 0 ? "" : messages[firstAt].text.trim();
        if (firstText === "") {
            continue;
        }
        const start = indexOfReply(firstText);
        if (start < 0) {
            continue;
        }
        const ended = view.state === "ended";
        let end = items.length - 1;
        if (ended) {
            const lastText =
                messages
                    .filter((m) => m.from === "worker")
                    .at(-1)
                    ?.text.trim() ?? "";
            end = Math.max(start, lastText === "" ? start : indexOfReply(lastText));
        }
        const judged = messages.slice(firstAt + 1).some((m) => m.from === "judge");
        const line: PairMarkLine = {
            pairId: view.id,
            state: ended ? "ended" : judged ? "live" : "reading",
            startTs: view.createdts,
            endTs: view.lastts,
            agreed: view.decided?.agreed?.length ?? 0,
            open: view.decided?.open?.length ?? 0,
        };
        const key = items[start].key;
        const lines = marks.lines.get(key);
        if (lines != null) {
            lines.push(line);
        } else {
            marks.lines.set(key, [line]);
        }
        for (let i = start; i <= end; i++) {
            owners[i] = { pairId: view.id, ended };
        }
    }
    // in the order of the conversation, as its rows are drawn
    owners.forEach((owner, i) => {
        if (owner != null) {
            marks.bars.set(items[i].key, owner);
        }
    });
    return marks;
}

// ---- the line's words ----

const pad2 = (n: number) => String(n).padStart(2, "0");

/** local `HH:MM` */
function clock(ts: number): string {
    const at = new Date(ts);
    return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

const OPEN_PAIR = "Open pair";

/** Pure: the line's text and the action at its end, in Vietnamese when `vi` (the person writes it), else English. A round
 *  still waiting for the judge's first answer counts the seconds since it began, never below 0; a live one says where it
 *  starts; an ended one gives its times and counts and has no action of its own (the whole line opens the pair in Library).
 *  An ended round whose last message is older than its start (it ended with only the reply it began from) reads from its
 *  start to its start. */
export function markWords(line: PairMarkLine, vi: boolean, nowMs: number): { text: string; action: string } {
    switch (line.state) {
        case "reading": {
            const secs = Math.max(0, Math.floor((nowMs - line.startTs) / 1000));
            const text = vi ? `Judge đang chấm reply này · ${secs} s` : `The judge is reading this reply · ${secs} s`;
            return { text, action: OPEN_PAIR };
        }
        case "live":
            return {
                text: vi ? "⚖ Vòng judge bắt đầu ở đây" : "⚖ The judge round starts here",
                action: OPEN_PAIR,
            };
        case "ended": {
            const span = `${clock(line.startTs)}–${clock(Math.max(line.endTs, line.startTs))}`;
            const text = vi
                ? `⚖ Vòng judge ${span} · ${line.agreed} chốt, ${line.open} còn mở`
                : `⚖ Judge round ${span} · ${line.agreed} agreed, ${line.open} open`;
            return { text, action: "" };
        }
    }
}
