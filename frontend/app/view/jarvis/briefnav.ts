// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's j/k cursor. The ids it walks are the drawn lines' own (briefrows.ts builds them, region-
// prefixed, because one object can sit in two regions), so a filtered or folded row is never navigable.

/**
 * The cursor the surface should actually render. The Brief re-derives every row on each snapshot
 * refresh, so the row under the cursor can resolve out from under it — an ask gets answered, a session
 * finishes. A cursor naming a row that no longer exists would leave j/k dead with nothing highlighted,
 * so it falls back to the first row rather than persisting a reference to something gone.
 */
export function resolveBriefCursor(ids: string[], cursor: string | undefined): string | undefined {
    if (ids.length === 0) {
        return undefined;
    }
    return cursor != null && ids.includes(cursor) ? cursor : ids[0];
}

// A card and a list row are both one initiative, keyed by its oref; the prefix keeps the two apart, as the region
// prefix keeps a line apart from the same object in another region. An idea is a BriefLine ("initiatives:<oref>").
const CARD = "card:";
const LIST = "list:";
const IDEA = "initiatives:";

export const cardNavId = (oref: string) => CARD + oref;
export const listNavId = (oref: string) => LIST + oref;

/** The initiative a cursor id stands on — a card, a list row or an idea — or null for any other row. */
export function navInitiative(id: string | null | undefined): string | null {
    if (id == null) {
        return null;
    }
    for (const prefix of [CARD, LIST, IDEA]) {
        if (id.startsWith(prefix) && id.slice(prefix.length).startsWith("effort:")) {
            return id.slice(prefix.length);
        }
    }
    return null;
}

/** The cards' oref under the cursor, for the card grid's focus ring (null when the cursor is not on a card). */
export function cardAt(id: string | null | undefined): string | null {
    return id != null && id.startsWith(CARD) ? id.slice(CARD.length) : null;
}

export function listRowAt(id: string | null | undefined): string | null {
    return id != null && id.startsWith(LIST) ? id.slice(LIST.length) : null;
}

// What the page draws, each part as the ids of its rows in drawn order (spec 2026-11-05-jarvis-revamp-design.md,
// Keyboard): the Waiting strip's item (or its rows, with Show all open), the cards row by row, the list, Activity, then
// the side column's Since you looked, Shipped and Ideas.
export type BriefNavParts = {
    strip: string[];
    // effort orefs, in the grid's order: left to right, then the next row
    cards: string[];
    // effort orefs, the list's rows as drawn
    list: string[];
    activity: string[];
    behind: string[];
    shipped: string[];
    ideas: string[];
};

/** The page's j/k order. */
export function briefNavIds(p: BriefNavParts): string[] {
    return [
        ...p.strip,
        ...p.cards.map(cardNavId),
        ...p.list.map(listNavId),
        ...p.activity,
        ...p.behind,
        ...p.shipped,
        ...p.ideas,
    ];
}
