// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure model of Chat's pair cards (docs/superpowers/specs/2026-11-25-chat-pair-blocks-design.md): a pair's working
// agent ends each reply with a ```arc-pair list (`D1 text`, `O2: text`, `A3 text [yes | no]`) and a judge marks it with a
// ```arc-judge fence (`reopen D2: why`, `new: point`, `no new points`). This module parses both, decides which list in a
// conversation is the newest (the one drawn in full) and what each card shows, overlaying the pair's server view
// (PairView.decided) on the list it was computed from. No React: the view is chatpairblock.tsx.

import type { ChatItem } from "./chatmodel";
import { stepsPartKey, topFencesOf } from "./chatsteplist";
import { openReason } from "./raildecided";

export const PAIR_LANG = "arc-pair";
export const JUDGE_LANG = "arc-judge";

/** An item's section, as pkg/agentpair names it (KindAgreed, KindOpen, KindAsks) and PairItem.kind carries it. */
export type PairKind = "agreed" | "open" | "asks";

/** One line of a working agent's arc-pair list. */
export interface PairBlockItem {
    num: number;
    kind: PairKind;
    text: string;
    note: string;
    chips: string[];
}

// The line rules are pkg/agentpair/blocks.go's (itemLine, chipsTail, reopenLine, newLine, noNewLine): keep the two sides'
// patterns identical, so the card lists what the server reads.
// `D1 text`, `O2: text`, `A3 text`; a Markdown bullet before it is read past
const ITEM_LINE = /^\s*(?:[-*+]\s+)?([DOAdoa])(\d+):?\s+(\S.*?)\s*$/;
// an A item's answer chips close its line: `[Yes, 50% | No, keep 70%]`
const CHIPS_TAIL = /\s*\[([^[\]]+)\]\s*$/;
const REOPEN_LINE = /^\s*(?:[-*+]\s+)?reopen\s+d?(\d+)\s*(?::\s*(.*?))?\s*$/i;
const NEW_LINE = /^\s*(?:[-*+]\s+)?new\s*:\s*(\S.*?)\s*$/i;
const NO_NEW_LINE = /^\s*(?:[-*+]\s+)?no\s+new\s+points?\b/i;

const KIND_OF: Record<string, PairKind> = { D: "agreed", O: "open", A: "asks" };
const LETTER_OF: Record<PairKind, string> = { agreed: "D", open: "O", asks: "A" };

// a line cut at its first ` — ` (an em dash) or ` -- `: the item's text, then its note
function splitNote(s: string): { text: string; note: string } {
    let cut = -1;
    let sepLen = 0;
    for (const sep of [" — ", " -- "]) {
        const i = s.indexOf(sep);
        if (i >= 0 && (cut < 0 || i < cut)) {
            cut = i;
            sepLen = sep.length;
        }
    }
    if (cut < 0) {
        return { text: s, note: "" };
    }
    return { text: s.slice(0, cut).trim(), note: s.slice(cut + sepLen).trim() };
}

/** Pure: a list's items, in order. A line that does not parse is skipped; [] when none does. */
export function parsePairItems(body: string): PairBlockItem[] {
    const items: PairBlockItem[] = [];
    for (const line of body.split(/\r?\n/)) {
        const m = ITEM_LINE.exec(line);
        if (m == null) {
            continue;
        }
        const num = Number(m[2]);
        if (!Number.isSafeInteger(num) || num < 1) {
            continue;
        }
        const kind = KIND_OF[m[1].toUpperCase()];
        let rest = m[3];
        const chips: string[] = [];
        if (kind === "asks") {
            const cm = CHIPS_TAIL.exec(rest);
            if (cm != null) {
                for (const c of cm[1].split("|")) {
                    if (c.trim() !== "") {
                        chips.push(c.trim());
                    }
                }
                if (chips.length > 0) {
                    rest = rest.slice(0, rest.length - cm[0].length);
                }
            }
        }
        items.push({ num, kind, ...splitNote(rest), chips });
    }
    return items;
}

/** A judge's marks: the agreed items it reopens, the points it raises, and whether it said it has none. */
export interface JudgeMarks {
    reopen: { num: number; why: string }[];
    new: string[];
    noNewPoints: boolean;
}

/** Pure: a judge's marks from an arc-judge fence's body, in any case. A line that does not parse is skipped. */
export function parseJudgeMarks(body: string): JudgeMarks {
    const marks: JudgeMarks = { reopen: [], new: [], noNewPoints: false };
    for (const line of body.split(/\r?\n/)) {
        const r = REOPEN_LINE.exec(line);
        if (r != null) {
            const num = Number(r[1]);
            if (Number.isSafeInteger(num) && num >= 1) {
                marks.reopen.push({ num, why: r[2] ?? "" });
            }
            continue;
        }
        const n = NEW_LINE.exec(line);
        if (n != null) {
            marks.new.push(n[1]);
        } else if (NO_NEW_LINE.test(line)) {
            marks.noNewPoints = true;
        }
    }
    return marks;
}

/** An item's label in the number column: `D4`, `O9`, `A5`. */
export function itemLabel(kind: PairKind, num: number): string {
    return `${LETTER_OF[kind]}${num}`;
}

/** Pure: a list as one string, the same for two fences that list the same items. */
export function pairItemsKey(items: readonly PairBlockItem[]): string {
    return items.map((i) => `${itemLabel(i.kind, i.num)} ${i.text}`).join("\n");
}

/** Pure: the labels of the D items `cur` agrees that `prev` did not (by number); [] with no previous list. */
export function newlyAgreed(prev: readonly PairBlockItem[] | null, cur: readonly PairBlockItem[]): string[] {
    if (prev == null) {
        return [];
    }
    const had = new Set(prev.filter((i) => i.kind === "agreed").map((i) => i.num));
    return cur.filter((i) => i.kind === "agreed" && !had.has(i.num)).map((i) => itemLabel("agreed", i.num));
}

// ---- where each list draws ----

/** A list in the conversation: whether it is the newest (drawn in full) and the list before it (for "agreed in this
 *  reply"), null for the first. */
export interface PlacedPair {
    latest: boolean;
    previous: PairBlockItem[] | null;
}

/** The key a placed list is found by: the prose part it sits in (stepsPartKey) and its items. */
export function pairBlockKey(partKey: string, items: readonly PairBlockItem[]): string {
    return `${partKey}\u0000${pairItemsKey(items)}`;
}

/**
 * Pure: every arc-pair list of a conversation that lists an item, keyed by pairBlockKey, in order; the last is the
 * newest. A fence still open in a reply being written is left out (chatlive.ts tidyLiveText does not draw it), so the
 * newest drawn list stays the newest until the new one closes.
 */
export function placePairLists(items: readonly ChatItem[]): Map<string, PlacedPair> {
    const out = new Map<string, PlacedPair>();
    let previous: PairBlockItem[] | null = null;
    let last: PlacedPair | null = null;
    for (const item of items) {
        if (item.kind !== "agent") {
            continue;
        }
        for (const [p, part] of item.parts.entries()) {
            if (part.kind !== "prose" || !part.text.includes(PAIR_LANG)) {
                continue;
            }
            for (const fence of topFencesOf(part.text)) {
                if (fence.lang !== PAIR_LANG || (part.live && !fence.closed)) {
                    continue;
                }
                const listed = parsePairItems(fence.body);
                if (listed.length === 0) {
                    continue;
                }
                last = { latest: false, previous };
                out.set(pairBlockKey(stepsPartKey(item.key, p), listed), last);
                previous = listed;
            }
        }
    }
    if (last != null) {
        last.latest = true;
    }
    return out;
}

// ---- what a card shows ----

/** One row of a card: its label (`D4`, "" for a judge's new point), text, note, and an A item's chips and answer. */
export interface PairRow {
    key: string;
    num: number;
    label: string;
    text: string;
    note: string;
    chips: string[];
    answer: string;
    // the server's item, which a chip answers (raildecided.ts answerChip); null on a read-only card
    item: PairItem | null;
}

/** A card's three sections. `current`: the list is the pair's anchor, so the server's view overlays it and its chips
 *  answer; otherwise it is the fence as written, read-only. */
export interface PairCard {
    current: boolean;
    asks: PairRow[];
    open: PairRow[];
    agreed: PairRow[];
}

// the server's items that came from the anchor list (not a judge's new point), each under the kind it was written as
function anchorItemsOf(decided: PairDecided): { kind: PairKind; num: number; text: string }[] {
    const all = [...(decided.asks ?? []), ...(decided.agreed ?? []), ...(decided.open ?? [])];
    return all
        .filter((i) => i.newby === "")
        .map((i) => ({ kind: i.reopenedby !== "" ? "agreed" : (i.kind as PairKind), num: i.num, text: i.text }));
}

/**
 * Pure: whether a list is the server's anchor list, the one PairView.decided was computed from: its items, by kind,
 * number and text, are exactly the server's (a judge's reopen counted as the D item it was written as). A list written
 * before the pair started, or one that closed while its turn has not ended, is not.
 */
export function isAnchorList(items: readonly PairBlockItem[], decided: PairDecided | null | undefined): boolean {
    if (decided == null) {
        return false;
    }
    const keyOf = (i: { kind: PairKind; num: number; text: string }) => `${itemLabel(i.kind, i.num)}\u0000${i.text}`;
    const ours = items.map(keyOf).sort();
    const theirs = anchorItemsOf(decided).map(keyOf).sort();
    return ours.length === theirs.length && ours.every((k, i) => k === theirs[i]);
}

function rowOfFence(i: PairBlockItem): PairRow {
    const label = itemLabel(i.kind, i.num);
    return { key: label, num: i.num, label, text: i.text, note: i.note, chips: i.chips, answer: "", item: null };
}

function rowOfServer(i: PairItem, at: number, judges: number): PairRow {
    if (i.newby !== "") {
        return {
            key: `new${at}`,
            num: 0,
            label: "",
            text: i.text,
            note: openReason(i, judges),
            chips: [],
            answer: "",
            item: i,
        };
    }
    const kind: PairKind = i.reopenedby !== "" ? "agreed" : (i.kind as PairKind);
    const label = itemLabel(kind, i.num);
    const note = i.reopenedby !== "" ? openReason(i, judges) : i.note;
    return { key: label, num: i.num, label, text: i.text, note, chips: i.chips ?? [], answer: i.answer, item: i };
}

/**
 * Pure: what the newest list's card shows. When it is the pair's anchor (`view` given and isAnchorList), the server's
 * sections: an item a judge reopened sits in Still open with who reopened it as its note, a judge's new point there with
 * no number, and each A item carries its answer. Otherwise the fence as written.
 */
export function pairCardOf(items: readonly PairBlockItem[], view: PairView | null): PairCard {
    const decided = view?.decided;
    if (view != null && decided != null && isAnchorList(items, decided)) {
        const judges = (view.judges ?? []).length;
        return {
            current: true,
            asks: (decided.asks ?? []).map((i, n) => rowOfServer(i, n, judges)),
            open: (decided.open ?? []).map((i, n) => rowOfServer(i, n, judges)),
            agreed: (decided.agreed ?? []).map((i, n) => rowOfServer(i, n, judges)),
        };
    }
    const of = (kind: PairKind) => items.filter((i) => i.kind === kind).map(rowOfFence);
    return { current: false, asks: of("asks"), open: of("open"), agreed: of("agreed") };
}

/** The A items still waiting on the person: every one on a read-only card, the unanswered ones on the current card. */
export function waitingCount(card: PairCard): number {
    return card.asks.filter((r) => r.answer === "").length;
}

/** The head row's counts: `7 agreed · 1 open`. */
export function pairCounts(agreed: number, open: number): string {
    return `${agreed} agreed · ${open} open`;
}

/** The amber words for what waits on the person: `3 wait on you`, `1 waits on you`. */
export function waitingLabel(n: number): string {
    return `${n} ${n === 1 ? "waits" : "wait"} on you`;
}

/** An older list's counts, from the fence as written: `6 agreed · 2 open · 3 wait on you`, the last left out at 0. */
export function olderCounts(items: readonly PairBlockItem[]): string {
    const n = (kind: PairKind) => items.filter((i) => i.kind === kind).length;
    const asks = n("asks");
    return asks > 0
        ? `${pairCounts(n("agreed"), n("open"))} · ${waitingLabel(asks)}`
        : pairCounts(n("agreed"), n("open"));
}

// ---- the judge's card ----

/** One mark of a judge's card: its tag (`Reopens D4`, `New point`), its text, and, for a reopen, the item it reopens as
 *  the pair's newest list has it (`D4 · text`), "" without a pair view or when the list has no such item. */
export interface JudgeRow {
    key: string;
    kind: "reopen" | "new";
    tag: string;
    text: string;
    sub: string;
}

// an item of the server's newest list by number (a judge's new point has none)
function itemByNum(decided: PairDecided, num: number): PairItem | null {
    const all = [...(decided.agreed ?? []), ...(decided.open ?? []), ...(decided.asks ?? [])];
    return all.find((i) => i.newby === "" && i.num === num) ?? null;
}

/** Pure: a judge's card rows, reopens first, then new points; [] when the marks raise nothing (the No new points row). */
export function judgeRowsOf(marks: JudgeMarks, decided: PairDecided | null | undefined): JudgeRow[] {
    const reopens = marks.reopen.map((r, n): JudgeRow => {
        const label = itemLabel("agreed", r.num);
        const item = decided != null ? itemByNum(decided, r.num) : null;
        const sub = item != null ? `${label} · ${item.text}` : "";
        // a reopen with no reason reads as the item itself
        if (r.why === "" && item != null) {
            return { key: `r${n}`, kind: "reopen", tag: `Reopens ${label}`, text: item.text, sub: "" };
        }
        return { key: `r${n}`, kind: "reopen", tag: `Reopens ${label}`, text: r.why, sub };
    });
    const points = marks.new.map(
        (text, n): JudgeRow => ({ key: `n${n}`, kind: "new", tag: "New point", text, sub: "" })
    );
    return [...reopens, ...points];
}

/** The judge card's counts: `1 reopened · 2 new points`, a part left out at 0. */
export function judgeCounts(marks: JudgeMarks): string {
    const parts: string[] = [];
    if (marks.reopen.length > 0) {
        parts.push(`${marks.reopen.length} reopened`);
    }
    if (marks.new.length > 0) {
        parts.push(`${marks.new.length} new ${marks.new.length === 1 ? "point" : "points"}`);
    }
    return parts.join(" · ");
}
