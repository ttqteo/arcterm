// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas tree game's one pixel grid (spec "One pixel grid" and "1 January"): the tree at a growth stage, the
// spots its ornaments hang on, and the 1 January fireworks. Pure, no React, plain numbers in: the hall tree, the
// close-up card and the Agent rail's pine all draw this grid at their own cell size, one rect a cell.
//
// Drawn after the rail pine it replaces (christmasrailtree.ts): tiers of needles in alternating shades, a trunk, a
// plus star; grown to five tiers. The tree stands on the grid's bottom row and grows around itself: each stage is the
// one before widened by a cell on each side of every row, with a new tip tier on top. So every needle cell of a stage
// is a needle cell of every later one, and a spot keeps its cell at every stage that has it: an ornament never jumps
// when the tree grows.

/** Grid columns, the same at every stage (the tree grows inside it): five tiers are 15 cells at their widest. */
export const XMAS_TREE_W = 15;

const MAX_TIERS = 5;
const TIER_ROWS = 4;
const STAR_ROWS = 3;
const TRUNK_ROWS = 2;
/** Grid rows: the star, five tiers and the trunk. */
export const XMAS_TREE_H = STAR_ROWS + MAX_TIERS * TIER_ROWS + TRUNK_ROWS;

const MID = (XMAS_TREE_W - 1) / 2;
// the row just above the trunk; d counts rows up from it
const BASE = XMAS_TREE_H - TRUNK_ROWS - 1;

export interface TreeGrid {
    /** One string a row, XMAS_TREE_W cells: P needles, d dark needles, T trunk, L a light, S the star, "." empty. */
    rows: readonly string[];
    /** Where ornament k hangs, k = index; always a needle cell. */
    spots: readonly { x: number; y: number }[];
}

/** Each cell's colour: theme tokens and the Christmas decor ones, never raw hex. The dark needles are the pine
 *  shaded as the Office shades it (officepalette.ts XMAS_PINE_DARK, 0.72); a light is a warm gold glow, set apart
 *  from the gold bauble. */
export const XMAS_TREE_FILL: Record<string, string> = {
    P: "var(--color-xmas-pine)",
    d: "color-mix(in srgb, var(--color-xmas-pine) 72%, black)",
    T: "var(--color-office-after-wood)",
    L: "color-mix(in srgb, var(--color-accent) 55%, var(--color-xmas-snow))",
    S: "var(--color-accent)",
};

/** An ornament's colour by tier: small red bulb, big gold bauble, rare cream piece, crimson heirloom. */
export const ORNAMENT_FILL: readonly string[] = [
    "var(--color-xmas-bulb)",
    "var(--color-accent)",
    "var(--color-xmas-snow)",
    "var(--color-xmas-crimson)",
];

// The half-width of the tree's row d (rows above the trunk) at a stage of `tiers` tiers, or -1 where it has none.
// Tier i (0 the top one) spans halves i … i+3 down its four rows; the sapling (0 tiers) is a three-row tip.
function halfAt(tiers: number, d: number): number {
    const rows = tiers === 0 ? 3 : tiers * TIER_ROWS;
    if (d < 0 || d >= rows) return -1;
    return tiers + 2 - Math.floor(d / TIER_ROWS) - (d % TIER_ROWS);
}

// The lights hang at both ends of each tier's bottom row and of its second row: the branch tips.
function isLight(tiers: number, d: number, dx: number): boolean {
    const r = d % TIER_ROWS;
    return (r === 0 || r === 2) && Math.abs(dx) === halfAt(tiers, d);
}

// Every spot, [dx from the centre, d rows above the trunk], in order: the sapling's 4 first, then each tier's new
// ones (10, 19, 22, 25, 30 in all), each set placed in the stage that adds it, off that stage's lights, so a spot
// stays a needle cell at every later stage. Later sets reach into the new tip tier to spread the ornaments up the tree.
const SPOTS: readonly [number, number][] = [
    // sapling
    [0, 1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    // 1 tier
    [2, 0],
    [-2, 1],
    [0, 2],
    [1, 1],
    [-2, 0],
    [2, 1],
    // 2 tiers
    [0, 4],
    [-3, 1],
    [2, 5],
    [-2, 4],
    [3, 1],
    [-1, 5],
    [2, 4],
    [0, 6],
    [-1, 3],
    // 3 tiers
    [0, 9],
    [-3, 6],
    [2, 8],
    // 4 tiers
    [-2, 12],
    [3, 9],
    [1, 13],
    // 5 tiers
    [0, 17],
    [-3, 9],
    [-1, 15],
    [3, 12],
    [2, 16],
];

/**
 * The tree at a stage: `tiers` 0 is the sapling, 1–5 the branch tiers grown so far; `lights` the string of lights,
 * `star` the star on top. Lists `spotCount` spots on needle cells; a spot the stage cannot hold where it stands (or
 * past the 30 placed) takes the nearest free needle cell and keeps its index. Never more spots than needle cells.
 */
export function treeGrid(tiers: number, lights: boolean, star: boolean, spotCount: number): TreeGrid {
    const t = Math.max(0, Math.min(MAX_TIERS, Math.floor(tiers)));
    const rows: string[][] = Array.from({ length: XMAS_TREE_H }, () => Array(XMAS_TREE_W).fill("."));
    let top = BASE;
    for (let d = 0; halfAt(t, d) >= 0; d++) {
        const y = BASE - d;
        top = y;
        const half = halfAt(t, d);
        // shade by tier counted from the top, as the rail pine does, so the tip is always the light green
        const tierFromTop = t === 0 ? 0 : t - 1 - Math.floor(d / TIER_ROWS);
        for (let dx = -half; dx <= half; dx++) {
            rows[y][MID + dx] = lights && isLight(t, d, dx) ? "L" : tierFromTop % 2 === 0 ? "P" : "d";
        }
    }
    const trunkHalf = t === 0 ? 0 : 1;
    for (let y = BASE + 1; y < XMAS_TREE_H; y++) {
        for (let dx = -trunkHalf; dx <= trunkHalf; dx++) rows[y][MID + dx] = "T";
    }
    if (star) {
        for (const [dx, dy] of [
            [0, -3],
            [-1, -2],
            [0, -2],
            [1, -2],
            [0, -1],
        ]) {
            rows[top + dy][MID + dx] = "S";
        }
    }
    return { rows: rows.map((r) => r.join("")), spots: placeSpots(rows, Math.max(0, Math.floor(spotCount))) };
}

function placeSpots(rows: readonly string[][], want: number): { x: number; y: number }[] {
    const needle = (x: number, y: number) => rows[y]?.[x] === "P" || rows[y]?.[x] === "d";
    let cells = 0;
    rows.forEach((row, y) => row.forEach((_, x) => needle(x, y) && cells++));
    // capped first, so every moved spot below finds a free cell
    const count = Math.min(want, cells);
    const taken = new Set<string>();
    const out: { x: number; y: number }[] = [];
    // first the placed spots that stand on this stage, so a moved one never takes the cell of a later fixed one
    const fixed: ({ x: number; y: number } | null)[] = [];
    for (let k = 0; k < count; k++) {
        const s = SPOTS[k];
        const p = s ? { x: MID + s[0], y: BASE - s[1] } : null;
        if (p && needle(p.x, p.y) && !taken.has(`${p.x},${p.y}`)) {
            taken.add(`${p.x},${p.y}`);
            fixed.push(p);
        } else {
            fixed.push(null);
        }
    }
    for (let k = 0; k < count; k++) {
        let p = fixed[k];
        if (!p) {
            p = nearestFree(rows, needle, taken, SPOTS[k])!;
            taken.add(`${p.x},${p.y}`);
        }
        out.push(p);
    }
    return out;
}

// The free needle cell nearest the spot's own cell (or the tree's centre when it has none), ties to the lower row,
// then the left: deterministic.
function nearestFree(
    rows: readonly string[][],
    needle: (x: number, y: number) => boolean,
    taken: Set<string>,
    want: readonly [number, number] | undefined
): { x: number; y: number } | null {
    const wx = MID + (want?.[0] ?? 0);
    const wy = BASE - (want?.[1] ?? 0);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let y = rows.length - 1; y >= 0; y--) {
        for (let x = 0; x < XMAS_TREE_W; x++) {
            if (!needle(x, y) || taken.has(`${x},${y}`)) continue;
            const dist = (x - wx) ** 2 + (y - wy) ** 2;
            if (dist < bestD) {
                bestD = dist;
                best = { x, y };
            }
        }
    }
    return best;
}

/** Frames in one cycle of the 1 January fireworks; a renderer steps through them while the Christmas motion runs and
 *  draws one still frame under reduced motion. */
export const FIREWORK_FRAMES = 12;

// four rockets, each rising and bursting a quarter cycle after the one before: where it bursts (a share of the
// width and height) and its colour
const ROCKETS: readonly { fx: number; fy: number; offset: number; fill: string }[] = [
    { fx: 0.2, fy: 0.3, offset: 0, fill: "var(--color-xmas-bulb)" },
    { fx: 0.62, fy: 0.22, offset: 3, fill: "var(--color-accent)" },
    { fx: 0.85, fy: 0.42, offset: 6, fill: "var(--color-xmas-snow)" },
    { fx: 0.42, fy: 0.45, offset: 9, fill: "var(--color-xmas-pine)" },
];
const RISE_FRAMES = 3;
const BURST_FRAMES = 6;
const DIRS: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
];

/** The fireworks over a w × h cell area on a frame (any integer; the cycle repeats every FIREWORK_FRAMES): each
 *  rocket rises as a short trail, bursts into eight sparks that spread and thin out, then the sky rests a frame. */
export function fireworkCells(frame: number, w: number, h: number): { x: number; y: number; fill: string }[] {
    const W = Math.floor(w);
    const H = Math.floor(h);
    if (W <= 0 || H <= 0) return [];
    const out: { x: number; y: number; fill: string }[] = [];
    const seen = new Set<string>();
    const put = (x: number, y: number, fill: string) => {
        const cx = Math.round(x);
        const cy = Math.round(y);
        if (cx < 0 || cx >= W || cy < 0 || cy >= H || seen.has(`${cx},${cy}`)) return;
        seen.add(`${cx},${cy}`);
        out.push({ x: cx, y: cy, fill });
    };
    const f = ((Math.floor(frame) % FIREWORK_FRAMES) + FIREWORK_FRAMES) % FIREWORK_FRAMES;
    const maxR = Math.max(1, Math.round(Math.min(W, H) / 6));
    for (const r of ROCKETS) {
        const t = (f + r.offset) % FIREWORK_FRAMES;
        const bx = r.fx * (W - 1);
        const by = r.fy * (H - 1);
        if (t < RISE_FRAMES) {
            // the trail climbs from the bottom to the burst point
            const y = H - 1 - ((H - 1 - by) * (t + 1)) / (RISE_FRAMES + 1);
            put(bx, y, "var(--color-accent)");
            put(bx, y + 1, r.fill);
        } else if (t < RISE_FRAMES + BURST_FRAMES) {
            const b = t - RISE_FRAMES; // 0 … 5
            const radius = 1 + ((maxR - 1) * b) / (BURST_FRAMES - 1);
            if (b === 0) put(bx, by, "var(--color-xmas-snow)");
            DIRS.forEach(([dx, dy], i) => {
                // the last two frames thin out: every other spark goes dark
                if (b >= BURST_FRAMES - 2 && (i + b) % 2 === 0) return;
                put(bx + dx * radius, by + dy * radius, r.fill);
            });
        }
    }
    return out;
}
