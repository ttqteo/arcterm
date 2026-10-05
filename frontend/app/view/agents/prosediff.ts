// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: a prose diff of two reading views (docprose.ts), what the Doc review view's Changes tab draws. Sections pair
// by title, then by order; paragraphs by order, then by overlap; sentences by LCS on their text. A deleted and an
// inserted sentence at the same place that share most of their words are one edited sentence with a word diff, not
// a struck sentence beside a new one.

import type { ProseDoc, ProseParagraph, ProseSection, ProseSentence, ProseToken } from "./docprose";

export type ChangeStatus = "same" | "changed" | "added" | "removed";

export interface WordChange {
    op: "same" | "insert" | "delete";
    token: ProseToken;
}

export interface SentenceChange {
    op: "same" | "insert" | "delete" | "modify";
    before?: ProseSentence;
    after?: ProseSentence;
    afterIndex?: number; // the sentence's index among the paragraph's after sentences (not for delete)
    words?: WordChange[]; // modify only
}

// `index` is the 1-based ¶ number in the after-document; a removed paragraph keeps its before-document number
export interface ParagraphChange {
    status: ChangeStatus;
    index: number;
    list?: boolean;
    sentences: SentenceChange[];
}

export interface SectionChange {
    status: ChangeStatus;
    level: number;
    label: string;
    title: string;
    beforeTitle?: string; // a paired section whose title changed: the title it had before
    index: number; // 0-based position in the after-document (a removed section: in the before-document)
    paragraphs: ParagraphChange[];
    counts: { insert: number; delete: number; modify: number };
}

export const MODIFY_SIMILARITY = 0.6;

export function diffProse(before: ProseDoc, after: ProseDoc): SectionChange[] {
    const b = before.sections;
    const a = after.sections;
    const bags = new Map<ProseSection, Map<string, number>>();
    const bagOf = (s: ProseSection) => {
        if (!bags.has(s)) {
            bags.set(s, wordBag(s.paragraphs.flatMap((p) => p.sentences)));
        }
        return bags.get(s);
    };
    const pairs = pairSections(b, a, (i, j) => dice(bagOf(b[i]), bagOf(a[j])));
    return interleave(b.length, a.length, pairs).map((slot) => {
        if (slot.b === undefined) {
            return sectionChange(a[slot.a], slot.a, "added", addedParagraphs(a[slot.a].paragraphs));
        }
        if (slot.a === undefined) {
            return sectionChange(b[slot.b], slot.b, "removed", removedParagraphs(b[slot.b].paragraphs));
        }
        const was = b[slot.b];
        const now = a[slot.a];
        const paragraphs = diffParagraphs(was.paragraphs, now.paragraphs);
        const same = was.title === now.title && paragraphs.every((p) => p.status === "same");
        const change = sectionChange(now, slot.a, same ? "same" : "changed", paragraphs);
        if (was.title !== now.title) {
            change.beforeTitle = was.title;
        }
        return change;
    });
}

function sectionChange(
    section: ProseSection,
    index: number,
    status: ChangeStatus,
    paragraphs: ParagraphChange[]
): SectionChange {
    const counts = { insert: 0, delete: 0, modify: 0 };
    for (const p of paragraphs) {
        for (const s of p.sentences) {
            if (s.op !== "same") {
                counts[s.op]++;
            }
        }
    }
    return { status, level: section.level, label: section.label, title: section.title, index, paragraphs, counts };
}

// ---------------------------------------------------------------------------------------------------------------
// pairing

type Pair = [number, number];

// every pair also earns this, so among pairings of equal score the one with more pairs wins: two items with nothing
// in common still pair when they sit at the same place
const ORDER_BONUS = 1e-3;

// a monotone pairing of before items 0..n with after items 0..m that maximizes the summed score; a null score means
// the two can't pair. Ties go to the earlier pair.
function align(n: number, m: number, score: (i: number, j: number) => number | null): Pair[] {
    const w = m + 1;
    // best[i * w + j]: the best total for before i..n and after j..m; step: 1 pair, 2 skip before, 3 skip after
    const best = new Float64Array((n + 1) * w);
    const step = new Uint8Array((n + 1) * w);
    for (let i = n; i >= 0; i--) {
        for (let j = m; j >= 0; j--) {
            if (i === n || j === m) {
                step[i * w + j] = i === n ? 3 : 2;
                continue;
            }
            const s = score(i, j);
            let top = -1;
            if (s !== null) {
                top = s + ORDER_BONUS + best[(i + 1) * w + j + 1];
                step[i * w + j] = 1;
            }
            if (best[(i + 1) * w + j] > top) {
                top = best[(i + 1) * w + j];
                step[i * w + j] = 2;
            }
            if (best[i * w + j + 1] > top) {
                top = best[i * w + j + 1];
                step[i * w + j] = 3;
            }
            best[i * w + j] = top;
        }
    }
    const pairs: Pair[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        const s = step[i * w + j];
        if (s === 1) {
            pairs.push([i, j]);
            i++;
            j++;
        } else if (s === 2) {
            i++;
        } else {
            j++;
        }
    }
    return pairs;
}

interface Slot {
    b?: number;
    a?: number;
}

// both sides as one sequence in the after-document's order: each after item with its before partner, and each
// unpaired before item right after the partner of the paired item before it (so deletes come before the inserts
// at the same place). The pairs need not be monotone: a section moved by title keeps its after-document place.
function interleave(n: number, m: number, pairs: Pair[]): Slot[] {
    const partnerOfBefore = new Map<number, number>();
    const partnerOfAfter = new Map<number, number>();
    for (const [i, j] of pairs) {
        partnerOfBefore.set(i, j);
        partnerOfAfter.set(j, i);
    }
    const unpairedAfter = new Map<number, number[]>(); // after index, -1 for the start → unpaired before items
    let anchor = -1;
    for (let i = 0; i < n; i++) {
        if (partnerOfBefore.has(i)) {
            anchor = partnerOfBefore.get(i);
        } else if (unpairedAfter.has(anchor)) {
            unpairedAfter.get(anchor).push(i);
        } else {
            unpairedAfter.set(anchor, [i]);
        }
    }
    const out: Slot[] = [];
    const flush = (key: number) => {
        for (const i of unpairedAfter.get(key) ?? []) {
            out.push({ b: i });
        }
    };
    flush(-1);
    for (let j = 0; j < m; j++) {
        out.push(partnerOfAfter.has(j) ? { b: partnerOfAfter.get(j), a: j } : { a: j });
        flush(j);
    }
    return out;
}

const normTitle = (title: string) => title.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// sections pair by normalized title, wherever they sit (a moved section keeps its partner); a title several
// sections share pairs its occurrences by content. What's left pairs by order: the unpaired sections that follow the
// same title-paired section on both sides.
function pairSections(b: ProseSection[], a: ProseSection[], similar: (i: number, j: number) => number): Pair[] {
    const pairs: Pair[] = [];
    const byTitle = new Map<string, { b: number[]; a: number[] }>();
    const group = (title: string) => {
        const key = normTitle(title);
        if (!byTitle.has(key)) {
            byTitle.set(key, { b: [], a: [] });
        }
        return byTitle.get(key);
    };
    b.forEach((s, i) => group(s.title).b.push(i));
    a.forEach((s, j) => group(s.title).a.push(j));
    for (const g of byTitle.values()) {
        pairs.push(...alignSubsets(g.b, g.a, similar));
    }

    const pairedBefore = new Map(pairs.map(([i, j]) => [i, j]));
    const pairedAfter = new Map(pairs.map(([i, j]) => [j, i]));
    // keyed by the before index of the title-paired section they follow, -1 for none
    const gaps = new Map<number, { b: number[]; a: number[] }>();
    const gap = (key: number) => {
        if (!gaps.has(key)) {
            gaps.set(key, { b: [], a: [] });
        }
        return gaps.get(key);
    };
    let anchor = -1;
    for (let i = 0; i < b.length; i++) {
        if (pairedBefore.has(i)) {
            anchor = i;
        } else {
            gap(anchor).b.push(i);
        }
    }
    anchor = -1;
    for (let j = 0; j < a.length; j++) {
        if (pairedAfter.has(j)) {
            anchor = pairedAfter.get(j);
        } else {
            gap(anchor).a.push(j);
        }
    }
    for (const g of gaps.values()) {
        pairs.push(...alignSubsets(g.b, g.a, similar));
    }
    return pairs;
}

// align over two index lists, returning pairs of the original indices
function alignSubsets(bs: number[], as: number[], score: (i: number, j: number) => number | null): Pair[] {
    if (bs.length === 0 || as.length === 0) {
        return [];
    }
    return align(bs.length, as.length, (x, y) => score(bs[x], as[y])).map(([x, y]) => [bs[x], as[y]]);
}

// ---------------------------------------------------------------------------------------------------------------
// paragraphs

function diffParagraphs(b: ProseParagraph[], a: ProseParagraph[]): ParagraphChange[] {
    const bBags = b.map((p) => wordBag(p.sentences));
    const aBags = a.map((p) => wordBag(p.sentences));
    const pairs = align(b.length, a.length, (i, j) => dice(bBags[i], aBags[j]));
    return interleave(b.length, a.length, pairs).map((slot) => {
        if (slot.b === undefined) {
            return addedParagraph(a[slot.a], slot.a);
        }
        if (slot.a === undefined) {
            return removedParagraph(b[slot.b], slot.b);
        }
        const sentences = diffSentences(b[slot.b].sentences, a[slot.a].sentences);
        const status: ChangeStatus = sentences.every((s) => s.op === "same") ? "same" : "changed";
        return withList({ status, index: slot.a + 1, sentences }, a[slot.a]);
    });
}

function withList(change: ParagraphChange, p: ProseParagraph): ParagraphChange {
    if (p.list) {
        change.list = true;
    }
    return change;
}

function addedParagraph(p: ProseParagraph, j: number): ParagraphChange {
    const sentences = p.sentences.map((after, k): SentenceChange => ({ op: "insert", after, afterIndex: k }));
    return withList({ status: "added", index: j + 1, sentences }, p);
}

function removedParagraph(p: ProseParagraph, i: number): ParagraphChange {
    const sentences = p.sentences.map((before): SentenceChange => ({ op: "delete", before }));
    return withList({ status: "removed", index: i + 1, sentences }, p);
}

const addedParagraphs = (ps: ProseParagraph[]) => ps.map(addedParagraph);
const removedParagraphs = (ps: ProseParagraph[]) => ps.map(removedParagraph);

// ---------------------------------------------------------------------------------------------------------------
// sentences and words

// an image sentence's text is its alt, so the src takes part too: a replaced image is a change
function sentenceKey(s: ProseSentence): string {
    const srcs = s.tokens.filter((t) => t.kind === "image").map((t) => t.href ?? "");
    return srcs.length === 0 ? s.text : [s.text, ...srcs].join("\u0000");
}

function diffSentences(b: ProseSentence[], a: ProseSentence[]): SentenceChange[] {
    const bKeys = b.map(sentenceKey);
    const aKeys = a.map(sentenceKey);
    const same = align(b.length, a.length, (i, j) => (bKeys[i] === aKeys[j] ? 1 : null));

    // between two unchanged sentences, deletes and inserts that share enough words pair as edits
    const bUnits = b.map((s) => unitsOf(s.tokens));
    const aUnits = a.map((s) => unitsOf(s.tokens));
    const edits: Pair[] = [];
    let prev: Pair = [-1, -1];
    for (const next of [...same, [b.length, a.length] as Pair]) {
        const bs = range(prev[0] + 1, next[0]);
        const as = range(prev[1] + 1, next[1]);
        edits.push(
            ...alignSubsets(bs, as, (i, j) => {
                const sim = similarity(bUnits[i], aUnits[j]);
                return sim >= MODIFY_SIMILARITY ? sim : null;
            })
        );
        prev = next;
    }
    const edited = new Set(edits.map(([i]) => i));

    return interleave(b.length, a.length, [...same, ...edits]).map((slot): SentenceChange => {
        if (slot.b === undefined) {
            return { op: "insert", after: a[slot.a], afterIndex: slot.a };
        }
        if (slot.a === undefined) {
            return { op: "delete", before: b[slot.b] };
        }
        const pair = { before: b[slot.b], after: a[slot.a], afterIndex: slot.a };
        if (!edited.has(slot.b)) {
            return { op: "same", ...pair };
        }
        return { op: "modify", ...pair, words: diffWords(bUnits[slot.b], aUnits[slot.a]) };
    });
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

// a word and the separators after it: the " " docprose puts after math, an image or a placeholder is no word of
// its own, so it neither counts toward similarity nor diffs apart from the token it follows
interface Unit {
    key: string;
    tokens: ProseToken[];
}

const isSeparator = (t: ProseToken) => t.text.trim() === "";

function tokenKey(t: ProseToken): string {
    const key = t.kind + "\u0000" + t.text.trim();
    return t.kind === "image" ? key + "\u0000" + (t.href ?? "") : key;
}

function unitsOf(tokens: ProseToken[]): Unit[] {
    const units: Unit[] = [];
    let lead: ProseToken[] = [];
    for (const t of tokens) {
        if (!isSeparator(t)) {
            units.push({ key: tokenKey(t), tokens: [...lead, t] });
            lead = [];
        } else if (units.length > 0) {
            units[units.length - 1].tokens.push(t);
        } else {
            lead.push(t);
        }
    }
    return units;
}

const sameWords = (b: Unit[], a: Unit[]) => align(b.length, a.length, (i, j) => (b[i].key === a[j].key ? 1 : null));

// shared words over all words, both sides: 2·LCS / (|before| + |after|)
function similarity(b: Unit[], a: Unit[]): number {
    const total = b.length + a.length;
    return total === 0 ? 0 : (2 * sameWords(b, a).length) / total;
}

// a same word is drawn from the after sentence, so the non-deleted tokens are exactly the after sentence's tokens
function diffWords(b: Unit[], a: Unit[]): WordChange[] {
    return interleave(b.length, a.length, sameWords(b, a)).flatMap((slot) => {
        if (slot.a === undefined) {
            return b[slot.b].tokens.map((token): WordChange => ({ op: "delete", token }));
        }
        const op = slot.b === undefined ? "insert" : "same";
        return a[slot.a].tokens.map((token): WordChange => ({ op, token }));
    });
}

// the words of some sentences as a multiset, for how much two paragraphs or sections overlap
function wordBag(sentences: ProseSentence[]): Map<string, number> {
    const bag = new Map<string, number>();
    for (const s of sentences) {
        for (const t of s.tokens) {
            if (!isSeparator(t)) {
                const key = tokenKey(t);
                bag.set(key, (bag.get(key) ?? 0) + 1);
            }
        }
    }
    return bag;
}

function dice(x: Map<string, number>, y: Map<string, number>): number {
    let shared = 0;
    let total = 0;
    for (const [key, n] of x) {
        shared += Math.min(n, y.get(key) ?? 0);
        total += n;
    }
    for (const n of y.values()) {
        total += n;
    }
    return total === 0 ? 0 : (2 * shared) / total;
}
