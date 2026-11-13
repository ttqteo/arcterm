// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's Initiatives region: the pinned cards and the compact list under them
// (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decisions 3 and 4). Which initiatives are cards, what the
// list keeps once the cards are taken out of it, and what a card and a list row say. initiativecards.tsx and
// initiativelist.tsx draw these faces and nothing else.
//
// Pure: no React.

import { formatAge } from "@/app/view/agents/agentsviewmodel";
import { capRegion, type CappedRows } from "./briefingmodel";
import { initiativeLine, isIdea, type BriefLine, type NestedCard } from "./briefrows";
import type { ChunkTone, EffortCardModel } from "./effortmodel";
import { shortDate, type InitiativeResume } from "./initiativework";

// pkg/jarvis MaxPinnedEfforts: the server refuses a seventh pin, so six is also the grid's size
export const MAX_PINNED = 6;
// the cards shown when nothing is pinned, so the region is never empty on day one
export const FALLBACK_CARDS = 6;
// the list's rows before "+N more"
export const LIST_CAP = 6;

type Pinnable = Pick<EffortCardModel, "oref" | "status" | "pinnedTs" | "done" | "remaining" | "skipped" | "topic">;

// a card or a list row is a live tracker: an archived initiative is out of both, an idea sits in Ideas
function isLive(c: Pinnable): boolean {
    return c.status !== "archived" && !isIdea(c as EffortCardModel);
}

// The card set. Once any live initiative is pinned, the cards are the pins only, oldest pin first (pin order); with
// none pinned, the first six of `ordered` (orderInitiatives' order). A pin can outnumber the grid only when two machines
// pinned at once and the vault merged both: the oldest six win.
export function pinnedCards<T extends Pinnable>(cards: T[], ordered: T[]): T[] {
    const pins = cards
        .filter((c) => isLive(c) && c.pinnedTs > 0)
        .sort((a, b) => a.pinnedTs - b.pinnedTs || a.oref.localeCompare(b.oref));
    if (pins.length > 0) {
        return pins.slice(0, MAX_PINNED);
    }
    // a topic stays in the list, where its sub-initiatives hang under it: as a card it would show no progress
    return ordered.filter((c) => isLive(c) && c.topic !== true).slice(0, FALLBACK_CARDS);
}

// N in "Pinned N of M": the live pins
export function countPinned(cards: Pinnable[]): number {
    return cards.filter((c) => isLive(c) && c.pinnedTs > 0).length;
}

// M in "Pinned N of M": the live initiatives, ideas and archived ones left out
export function countLive(cards: Pinnable[]): number {
    return cards.filter(isLive).length;
}

export function pinnedHeading(pinnedCount: number, liveCount: number): string {
    return `Pinned ${pinnedCount} of ${liveCount}`;
}

// the quiet "Pin an initiative" slot closes a grid that has room for another pin; with no pins the fallback fills it
export function showPinSlot(pinnedCount: number): boolean {
    return pinnedCount > 0 && pinnedCount < MAX_PINNED;
}

// a list row, and when the initiative it is part of is a card, that card's title: the row is drawn at the top with
// "↳ <parent>" in place of an indent under a row that is not there
export type ListItem = NestedCard & { parentCard?: string };

const CARD_PREFIX = "effort:";

// The list under the cards: `nested` (nestInitiatives' rows, already narrowed by the project tabs) with every card left
// out, fallback cards included, so nothing shows twice. A row whose parent was taken out stands at depth 0, and what
// hangs under it moves up with it. The parent is found by `parentoid`, so a card in another project is still named.
export function listAfterCards(
    nested: NestedCard[],
    cards: ReadonlyArray<{ oref: string; title: string }>
): ListItem[] {
    const cardTitle = new Map(cards.map((c) => [c.oref, c.title]));
    const depthOf = new Map<string, number>();
    const kept = new Map<string, ListItem>();
    const out: ListItem[] = [];
    for (const n of nested) {
        if (cardTitle.has(n.oref)) {
            continue;
        }
        const parentDepth = n.parentOref != null ? depthOf.get(n.parentOref) : undefined;
        const depth = parentDepth != null ? parentDepth + 1 : 0;
        depthOf.set(n.oref, depth);
        const parentCard =
            parentDepth == null && n.parentoid != null && n.parentoid !== ""
                ? cardTitle.get(CARD_PREFIX + n.parentoid)
                : undefined;
        const item: ListItem = { ...n, depth, subCount: 0, ...(parentCard != null ? { parentCard } : {}) };
        // "+N sub" counts the sub-initiatives still under it, not one that went up to the cards
        const parent = parentDepth != null ? kept.get(n.parentOref) : undefined;
        if (parent != null) {
            parent.subCount++;
        }
        kept.set(n.oref, item);
        out.push(item);
    }
    return out;
}

export function listWindow<T>(rows: T[], expanded: boolean): CappedRows<T> {
    return capRegion(rows, LIST_CAP, expanded);
}

export type StatusTone = "ok" | "asking" | "faint" | "muted";
export type StatusCell = { text: string; tone: StatusTone };

// what both a card and a list row say about one initiative
export type InitiativeFace = {
    oref: string;
    title: string;
    // the card: "arcterm · updated 2h"; a list row: the project, or "↳ <parent>" under a card
    meta: string;
    done: number;
    total: number;
    pct: string;
    segments: ChunkTone[];
    // false for a topic with no chunks of its own: the count and the bar are left out rather than drawn 0/0
    hasProgress: boolean;
    status: StatusCell;
    // "Next" (accent), "Blocked on" (amber) or "Done", with that chunk; absent when there is nothing to name
    noteLabel?: BriefLine["noteLabel"];
    note: string;
    // the day it last moved: the newest note's, else the last update's
    when: string;
    pinned: boolean;
    depth: number;
    // the sub-initiatives under it in the list ("+N sub"); 0 on a card
    subCount: number;
    // what the action button does: Work on (a new agent) or Go to agent (one is open on it); absent without a resume
    action?: InitiativeResume["kind"];
};

export type FaceInput = {
    now: number;
    // where it was left and whether an agent is open on it (initiativeResume)
    resume?: InitiativeResume;
    // "idle 2w" when the review model says it sat idle
    idle?: string;
};

function lastMoved(card: EffortCardModel): string {
    return shortDate(card.lastnote?.ts ?? card.updatedts);
}

// The status cell: stuck first (it waits on someone), then an agent on it, a paused initiative, how long it sat
// idle, else the day it last moved.
function statusCell(card: EffortCardModel, input: FaceInput): StatusCell {
    if (card.blockedChunks.length > 0) {
        return { text: "● blocked", tone: "asking" };
    }
    if (input.resume?.kind === "go") {
        return { text: "● agent open", tone: "ok" };
    }
    if (card.status === "paused") {
        return { text: "paused", tone: "muted" };
    }
    if (input.idle != null && input.idle !== "") {
        return { text: input.idle, tone: "faint" };
    }
    return { text: lastMoved(card), tone: "muted" };
}

function face(card: EffortCardModel, meta: string, depth: number, subCount: number, input: FaceInput): InitiativeFace {
    const line = initiativeLine(card);
    const p = line.progress ?? { done: 0, total: 0, pct: 0 };
    return {
        oref: card.oref,
        title: card.title,
        meta,
        done: p.done,
        total: p.total,
        pct: `${p.pct}%`,
        segments: card.segments,
        hasProgress: line.progress != null,
        status: statusCell(card, input),
        ...(line.noteLabel != null ? { noteLabel: line.noteLabel } : {}),
        note: line.note,
        when: lastMoved(card),
        pinned: card.pinnedTs > 0,
        depth,
        subCount,
        ...(input.resume != null ? { action: input.resume.kind } : {}),
    };
}

const projectOf = (card: EffortCardModel) => card.project || "no project";

export function cardFace(card: EffortCardModel, input: FaceInput): InitiativeFace {
    return face(card, `${projectOf(card)} · updated ${formatAge(input.now - card.updatedts)}`, 0, 0, input);
}

export function listRowFace(item: ListItem, input: FaceInput): InitiativeFace {
    const meta = item.parentCard != null ? `↳ ${item.parentCard}` : projectOf(item);
    return face(item, meta, item.depth, item.subCount, input);
}
