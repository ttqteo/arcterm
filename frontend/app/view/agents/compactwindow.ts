// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which items of a compact transcript are in the DOM (compacttranscript.tsx), as pure decisions. The drawn window counts
// back from the end: it starts at RENDER_CAP items and grows by RENDER_CAP each time the reader reaches the top of what
// is drawn, so a long transcript is read back a screenful at a time instead of dropping everything past the cap. Once
// every item is drawn, reaching the top asks the caller for earlier ones. No React.
//
// Items are placed in "key space": an entry index minus the caller's `keyOffset`, which is how many entries it has put in
// front of the first one it passed at the start. A load that prepends entries shifts every entry index by that many and
// leaves every key where it was, so what is drawn, and which folds are open, stay with their items.

import type { CompactItem } from "./compacttimeline";

// items drawn at first, and added each time the top is reached; an older transcript past this draws back on demand
export const RENDER_CAP = 200;

// the keys of the entries one item holds: [start, end)
export interface ItemSpan {
    start: number;
    end: number;
}

/** Pure: an entry index's place in key space. */
export function keyFor(index: number, keyOffset: number): number {
    return index - keyOffset;
}

/** Pure: the keys one render item holds. A work item holds one entry per tool call, any other item one. */
export function itemSpan(item: CompactItem, keyOffset: number): ItemSpan {
    if (item.kind === "work") {
        const start = keyFor(item.startIndex, keyOffset);
        return { start, end: start + item.actions.length };
    }
    const start = keyFor(item.index, keyOffset);
    return { start, end: start + 1 };
}

/** Pure: the first drawn item when the last `drawn` of `itemCount` are drawn. */
export function firstDrawn(itemCount: number, drawn: number): number {
    return Math.max(0, itemCount - drawn);
}

/** Pure: `drawn` after the top of the list is reached with items hidden above: another RENDER_CAP, never past all. */
export function grownDrawn(itemCount: number, drawn: number): number {
    return Math.min(itemCount, drawn + RENDER_CAP);
}

/** Pure: the `drawn` that includes item `itemIndex`, counting back from the end. */
export function drawnToReach(itemCount: number, itemIndex: number): number {
    return itemCount - itemIndex;
}

// the first item whose entries end past `key`: the one holding it, or the first after it; spans.length when none does
function firstEndingAfter(spans: ItemSpan[], key: number): number {
    let lo = 0;
    let hi = spans.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spans[mid].end > key) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return lo;
}

/** Pure: the first drawn item. The window is remembered as the key of its first item (`anchor`, null before the first
 *  render with items), not as a count, so items added at the end never undraw the ones being read and items put in
 *  front stay hidden until the reader reaches them. An anchor past every item (another transcript) starts over. */
export function windowStart(spans: ItemSpan[], anchor: number | null): number {
    if (anchor == null) {
        return firstDrawn(spans.length, RENDER_CAP);
    }
    const at = firstEndingAfter(spans, anchor);
    return at < spans.length ? at : firstDrawn(spans.length, RENDER_CAP);
}

/** Pure: the item holding the entry with this key, or -1 when no item does. */
export function holdingItem(spans: ItemSpan[], key: number): number {
    const at = firstEndingAfter(spans, key);
    return at < spans.length && spans[at].start <= key ? at : -1;
}

export type TopAction = "grow" | "reach" | "none";

/** Pure: what the top of the list being in view means. Items hidden above: draw RENDER_CAP more. Everything drawn: ask
 *  the caller for earlier ones, once per item count (`reachedAt` is the count it last asked at), so a caller that has
 *  nothing earlier, or whose read has not landed, is not asked again in a loop while nothing changed. */
export function topAction(o: {
    topInView: boolean;
    first: number;
    itemCount: number;
    reachedAt: number | null;
}): TopAction {
    if (!o.topInView || o.itemCount === 0) {
        return "none";
    }
    if (o.first > 0) {
        return "grow";
    }
    return o.reachedAt === o.itemCount ? "none" : "reach";
}
