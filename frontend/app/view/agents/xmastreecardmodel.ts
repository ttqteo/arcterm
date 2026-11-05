// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The lobby tree's close-up card, pure (spec "Moving ornaments", "Close-up card keys"; board A of the Prototype): the
// card's state (the cursor's spot and the lifted ornament's), its reducer over the tree layer's keys and its close, and
// the side column's texts. xmastreecard.tsx draws it; the Office owns the keys and persists a put-down's move through
// the tree store. No React, no Wave runtime imports.

import { treeGrid } from "./xmastreegrid";
import {
    MILESTONES,
    branchTiers,
    hasLights,
    hasStar,
    nearestSpot,
    ornamentRange,
    ornamentTasks,
    progress,
    tierCounts,
    type Arrangement,
    type Dir,
    type Ornament,
    type Tier,
} from "./xmastreemodel";

/** The card's state: the spot under the dashed ring, and the spot whose ornament is lifted (null while none is). */
export interface CardState {
    cursor: number;
    lifted: number | null;
}

export type CardAction = { do: "treeMove"; dir: Dir } | { do: "treeLift" } | { do: "close" };

export interface CardContext {
    /** Each spot's cell on the grid the card draws (cardPoints). */
    points: readonly { x: number; y: number }[];
    arrangement: Arrangement;
}

/** A put-down onto another spot: the Office persists it through the tree store's moveXmasOrnament (moveOrnament). */
export interface CardMove {
    from: number;
    to: number;
}

/** The card as it opens: the cursor on the first ornament (spot 0 when none hangs), nothing lifted. */
export function openCard(a: Arrangement): CardState {
    const first = a.spots.findIndex((o) => o != null);
    return { cursor: Math.max(0, first), lifted: null };
}

/** Each spot's cell on the tree drawn at the milestone: the same grid the card, the hall and the rail draw. */
export function cardPoints(milestone: number, a: Arrangement): { x: number; y: number }[] {
    return treeGrid(branchTiers(milestone), hasLights(milestone), hasStar(milestone), a.spots.length).spots.slice();
}

// the spots the cursor can stand on: those with a cell on the grid
function spotsShown(ctx: CardContext): number {
    return Math.min(ctx.points.length, ctx.arrangement.spots.length);
}

function clampCursor(cursor: number, n: number): number {
    return n <= 0 ? 0 : Math.max(0, Math.min(cursor, n - 1));
}

/** One step of the card. treeMove: the nearest spot in the arrow's direction, over ornaments only while nothing is
 *  lifted and every spot while one is. treeLift: lift the ornament under the cursor (nothing from a free spot), or put
 *  the lifted one down: on another spot it is a move (into a free spot it moves, onto an ornament the two swap, as
 *  moveOrnament does), on its own spot it goes back. close: a lifted ornament goes back, the cursor with it. */
export function treeCardStep(s: CardState, act: CardAction, ctx: CardContext): { state: CardState; move?: CardMove } {
    const n = spotsShown(ctx);
    const spots = ctx.arrangement.spots;
    const cursor = clampCursor(s.cursor, n);
    // a lifted ornament can be gone (a merge while the card was open): the lift drops
    const lifted = s.lifted != null && s.lifted < n && spots[s.lifted] != null ? s.lifted : null;
    switch (act.do) {
        case "treeMove": {
            const allowed = Array.from({ length: n }, (_, i) => lifted != null || spots[i] != null);
            return { state: { cursor: nearestSpot(ctx.points.slice(0, n), cursor, act.dir, allowed), lifted } };
        }
        case "treeLift": {
            if (lifted == null) {
                return { state: { cursor, lifted: spots[cursor] != null ? cursor : null } };
            }
            if (lifted === cursor) {
                return { state: { cursor, lifted: null } };
            }
            return { state: { cursor, lifted: null }, move: { from: lifted, to: cursor } };
        }
        case "close":
            return { state: { cursor: lifted ?? cursor, lifted: null } };
    }
}

function plural(n: number, one: string, many: string): string {
    return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The season's finished tasks, the side column's big number: "214 tasks". */
export function countText(count: number): string {
    return plural(count, "task", "tasks");
}

// what the tree is at each milestone, and what the next one adds
const REACHED = [
    "a sapling",
    "one tier",
    "two tiers",
    "three tiers",
    "four tiers",
    "five tiers",
    "the lights",
    "the star on top",
];
const NEXT = [
    "the first tier",
    "the second tier",
    "the third tier",
    "the fourth tier",
    "the fifth tier",
    "the lights",
    "the star",
];

/** "Milestone 4 / 7: four tiers. 36 tasks to the fifth tier."; at the star, "The tree is complete." */
export function milestoneLine(count: number): string {
    const { milestone, left } = progress(count);
    const head = `Milestone ${milestone} / ${MILESTONES.length}: ${REACHED[milestone]}.`;
    if (milestone >= MILESTONES.length) return `${head} The tree is complete.`;
    return `${head} ${plural(left, "task", "tasks")} to ${NEXT[milestone]}.`;
}

const NAMES = ["Small ornament", "Big bauble", "Rare ornament", "Heirloom"];

export function ornamentName(tier: Tier): string {
    return NAMES[tier];
}

// day/month, as board A writes a date
function dayMonth(ms: number): string {
    const d = new Date(ms);
    return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** What a lifted ornament holds: "Merged from 10 tasks, 8/11 to 12/11" (one day named once), or "1 task, 8/11". */
export function ornamentDetail(o: Ornament, done: readonly number[]): string {
    const n = ornamentTasks(o);
    const { from, to } = ornamentRange(o, done);
    const a = dayMonth(from);
    const b = dayMonth(to);
    if (n === 1) return `1 task, ${a}`;
    return `Merged from ${n.toLocaleString("en-US")} tasks, ${a === b ? a : `${a} to ${b}`}`;
}

export interface KeyRow {
    tier: Tier;
    label: string;
    onTree: string;
}

const TIER_TASKS = [1, 10, 100, 1000];

/** The card's key: small, big and rare always, the heirloom once one hangs, each with how many hang. */
export function keyRows(a: Arrangement): KeyRow[] {
    const counts = tierCounts(a);
    const tiers: Tier[] = counts[3] > 0 ? [0, 1, 2, 3] : [0, 1, 2];
    return tiers.map((tier) => ({
        tier,
        label: `${NAMES[tier]}: ${plural(TIER_TASKS[tier], "task", "tasks")}`,
        onTree: `${counts[tier]} on the tree`,
    }));
}
