// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The lobby Christmas tree's growth and ornaments, pure: how many finished tasks reach each milestone, how many spots
// each stage has, how a new ornament hangs and when ten merge into one of the next tier, moving an ornament by hand,
// and the arrow keys' walk between spots. The store, the hall, the close-up card and the Agent rail's pine all build
// on this; the season's dates and its count of finished tasks come from wavesrv.
// Spec: docs/superpowers/specs/2026-11-05-christmas-tree-game-design.md ("Growth", "Positions and announcements").

/** Tasks finished to reach milestones 1..7: five tiers of branches, then the lights, then the star. */
export const MILESTONES: readonly number[] = [5, 15, 50, 150, 250, 600, 1500];

/** Spots by branch stage (sapling, then 1..5 tiers); the lights and the star add none. */
export const SPOTS_BY_STAGE: readonly number[] = [4, 10, 19, 22, 25, 30];

/** The most spots a tree ever has. */
export const MAX_SPOTS = SPOTS_BY_STAGE[SPOTS_BY_STAGE.length - 1];

/** How many ornaments of one tier merge into one of the next. */
export const MERGE_SIZE = 10;

/** 0 small (red bulb, 1 task), 1 big (gold bauble, 10), 2 rare (cream diamond, 100), 3 heirloom (crimson star, 1,000). */
export type Tier = 0 | 1 | 2 | 3;

/** The highest tier; it never merges. */
export const TOP_TIER: Tier = 3;

/** An ornament holds the tasks `first..last` (inclusive), indices into the season's `done` list. */
export interface Ornament {
    tier: Tier;
    first: number;
    last: number;
}

/** The tree's spots after its first `count` finished tasks; a spot holds an ornament or is free. */
export interface Arrangement {
    count: number;
    spots: (Ornament | null)[];
}

export type XmasPhase = "season" | "newyear" | "off";

/** What the store derives and every view draws. */
export interface XmasTreeView {
    season: number;
    phase: XmasPhase;
    count: number;
    milestone: number;
    arrangement: Arrangement;
    done: readonly number[];
}

/** The milestones reached at `count` finished tasks, 0..7. */
export function milestoneAt(count: number): number {
    let m = 0;
    while (m < MILESTONES.length && count >= MILESTONES[m]) m++;
    return m;
}

/** Tiers of branches at a milestone, 0 (the sapling) to 5. */
export function branchTiers(milestone: number): number {
    return Math.max(0, Math.min(milestone, SPOTS_BY_STAGE.length - 1));
}

export function hasLights(milestone: number): boolean {
    return milestone >= 6;
}

export function hasStar(milestone: number): boolean {
    return milestone >= 7;
}

export function spotCount(milestone: number): number {
    return SPOTS_BY_STAGE[branchTiers(milestone)];
}

export function emptyArrangement(): Arrangement {
    return { count: 0, spots: new Array<Ornament | null>(SPOTS_BY_STAGE[0]).fill(null) };
}

function growTo(spots: (Ornament | null)[], n: number): void {
    while (spots.length < n) spots.push(null);
}

/** Merges the 10 oldest ornaments of the lowest tier holding at least 10; false when no tier below the top has 10. */
function mergeOldest(spots: (Ornament | null)[]): boolean {
    for (let tier = 0; tier < TOP_TIER; tier++) {
        const held: number[] = [];
        spots.forEach((o, i) => {
            if (o?.tier === tier) held.push(i);
        });
        if (held.length < MERGE_SIZE) continue;
        const oldest = held.sort((a, b) => spots[a]!.first - spots[b]!.first).slice(0, MERGE_SIZE);
        const merged: Ornament = {
            tier: (tier + 1) as Tier,
            first: Math.min(...oldest.map((i) => spots[i]!.first)),
            last: Math.max(...oldest.map((i) => spots[i]!.last)),
        };
        for (const i of oldest) spots[i] = null;
        spots[oldest[0]] = merged;
        return true;
    }
    return false;
}

/** Hangs tasks `a.count + 1 .. count`, one step each: the tree grows to the stage the task reaches, then the task's
 *  ornament takes the lowest-numbered free spot, merging the oldest ten of the lowest tier with ten when none is free.
 *  A task that finds no spot and no tier to merge still counts but hangs nothing. Returns a new arrangement. */
export function advance(a: Arrangement, count: number): Arrangement {
    if (count <= a.count) return a;
    const spots = a.spots.slice();
    growTo(spots, spotCount(milestoneAt(a.count)));
    for (let task = a.count + 1; task <= count; task++) {
        growTo(spots, spotCount(milestoneAt(task)));
        let free = spots.indexOf(null);
        if (free < 0 && mergeOldest(spots)) free = spots.indexOf(null);
        if (free >= 0) spots[free] = { tier: 0, first: task - 1, last: task - 1 };
    }
    return { count, spots };
}

/** Moves the ornament at `from` to `to`: into a free spot it moves, onto an ornament the two swap. */
export function moveOrnament(a: Arrangement, from: number, to: number): Arrangement {
    const n = a.spots.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n || a.spots[from] == null) return a;
    const spots = a.spots.slice();
    [spots[from], spots[to]] = [spots[to], spots[from]];
    return { count: a.count, spots };
}

/** How many ornaments of each tier hang on the tree. */
export function tierCounts(a: Arrangement): [number, number, number, number] {
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    for (const o of a.spots) if (o) counts[o.tier]++;
    return counts;
}

export function ornamentTasks(o: Ornament): number {
    return o.last - o.first + 1;
}

/** When the ornament's first and last tasks finished, in ms. */
export function ornamentRange(o: Ornament, done: readonly number[]): { from: number; to: number } {
    return { from: done[o.first] ?? 0, to: done[o.last] ?? 0 };
}

/** The milestone reached, the tasks left to the next one and the fraction of the way there; at 7, 0 left and 1. */
export function progress(count: number): { milestone: number; left: number; fraction: number } {
    const milestone = milestoneAt(count);
    if (milestone >= MILESTONES.length) return { milestone, left: 0, fraction: 1 };
    const prev = milestone === 0 ? 0 : MILESTONES[milestone - 1];
    const next = MILESTONES[milestone];
    return { milestone, left: next - count, fraction: (count - prev) / (next - prev) };
}

/** The milestone to announce, or null: the reached one when it is above the highest announced. */
export function milestoneToAnnounce(milestone: number, announced: number): number | null {
    return milestone > 0 && milestone > announced ? milestone : null;
}

function ordinal(n: number): string {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return `${n}th`;
    switch (n % 10) {
        case 1:
            return `${n}st`;
        case 2:
            return `${n}nd`;
        case 3:
            return `${n}rd`;
        default:
            return `${n}th`;
    }
}

/** The milestone toast's title. */
export function milestoneTitle(milestone: number): string {
    if (milestone >= 7) return "The star is on top of the tree";
    if (milestone === 6) return "The tree's lights are on";
    if (milestone <= 0) return "The tree is a sapling";
    return `The tree grew its ${ordinal(milestone)} tier`;
}

function isIndex(v: unknown): v is number {
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** Validates an arrangement read from localStorage; null when it is malformed. */
export function parseArrangement(raw: unknown): Arrangement | null {
    if (raw == null || typeof raw !== "object") return null;
    const { count, spots } = raw as { count?: unknown; spots?: unknown };
    if (!isIndex(count) || !Array.isArray(spots) || spots.length > MAX_SPOTS) return null;
    const out: (Ornament | null)[] = [];
    for (const s of spots) {
        if (s === null) {
            out.push(null);
            continue;
        }
        if (typeof s !== "object") return null;
        const { tier, first, last } = s as { tier?: unknown; first?: unknown; last?: unknown };
        if (!isIndex(tier) || tier > TOP_TIER || !isIndex(first) || !isIndex(last)) return null;
        if (first > last || last >= count) return null;
        out.push({ tier: tier as Tier, first, last });
    }
    return { count, spots: out };
}

export type Dir = "up" | "down" | "left" | "right";

/** The allowed spot nearest `from` in the arrow's direction (y grows downward), or `from` when none lies that way.
 *  A point counts when it is strictly ahead along the arrow; the distance weighs the sideways offset double, so the
 *  arrow prefers a spot in line over a closer one off to the side. Ties go to the lower index. */
export function nearestSpot(
    points: readonly { x: number; y: number }[],
    from: number,
    dir: Dir,
    allowed: readonly boolean[]
): number {
    const origin = points[from];
    if (origin == null) return from;
    let best = from;
    let bestScore = Infinity;
    points.forEach((p, i) => {
        if (i === from || !allowed[i]) return;
        const dx = p.x - origin.x;
        const dy = p.y - origin.y;
        const ahead = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
        const side = dir === "right" || dir === "left" ? dy : dx;
        if (ahead <= 0) return;
        const score = ahead * ahead + 4 * side * side;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    });
    return best;
}
