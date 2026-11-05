// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The small pine in the Agent details rail's Overview corner while the Christmas decor shows, drawn after the Office lobby's tree of
// the Christmas tree game (.superpowers/design/christmas-tree-game, board A): four tiers of needles in alternating
// shades on a brown trunk, small red baubles, big gold ones, one rare cream piece, and a gold star. Pure: the grid and
// its colours; christmasrailtreeview.tsx draws it, one rect a cell. Static: it does not grow yet (the game's season count
// is not built), so it is drawn full.

export const RAIL_TREE_W = 15;

// tier n (0 at the top) spans rows TIER_TOP + 4n .. +3, widths 2n+1, 2n+3, 2n+5, 2n+7, centred
const TIERS = 4;
const TIER_TOP = 3;
const TRUNK_ROWS = 2;
export const RAIL_TREE_H = TIER_TOP + TIERS * 4 + TRUNK_ROWS;

// the ornaments, [x, y, cell]: r a small red bauble, y a big gold one, w the rare cream piece
const ORNAMENTS: readonly [number, number, string][] = [
    [7, 5, "r"],
    [6, 9, "y"],
    [9, 10, "r"],
    [5, 12, "r"],
    [8, 13, "y"],
    [4, 14, "y"],
    [10, 14, "r"],
    [7, 11, "w"],
    [3, 17, "r"],
    [6, 16, "r"],
    [9, 17, "y"],
    [10, 16, "r"],
    [7, 18, "y"],
];

function buildRows(): string[] {
    const rows: string[][] = Array.from({ length: RAIL_TREE_H }, () => Array(RAIL_TREE_W).fill("."));
    const mid = (RAIL_TREE_W - 1) / 2;
    // the star: a plus on the top rows
    rows[0][mid] = "S";
    rows[1][mid - 1] = "S";
    rows[1][mid] = "S";
    rows[1][mid + 1] = "S";
    rows[2][mid] = "S";
    for (let t = 0; t < TIERS; t++) {
        const shade = t % 2 === 0 ? "P" : "d";
        for (let i = 0; i < 4; i++) {
            const half = t + i;
            for (let x = mid - half; x <= mid + half; x++) {
                rows[TIER_TOP + t * 4 + i][x] = shade;
            }
        }
    }
    for (let y = RAIL_TREE_H - TRUNK_ROWS; y < RAIL_TREE_H; y++) {
        for (let x = mid - 1; x <= mid + 1; x++) {
            rows[y][x] = "T";
        }
    }
    for (const [x, y, c] of ORNAMENTS) {
        rows[y][x] = c;
    }
    return rows.map((r) => r.join(""));
}

/** The tree, one string a row, RAIL_TREE_W cells wide; "." is empty. */
export const RAIL_TREE: readonly string[] = buildRows();

/** Each cell's colour: theme tokens and the Christmas decor ones, never raw hex. The darker needles are the pine
 *  shaded as the Office shades it (officepalette.ts XMAS_PINE_DARK, 0.72). */
export const RAIL_TREE_FILL: Record<string, string> = {
    S: "var(--color-accent)",
    P: "var(--color-xmas-pine)",
    d: "color-mix(in srgb, var(--color-xmas-pine) 72%, black)",
    T: "var(--color-office-after-wood)",
    r: "var(--color-xmas-bulb)",
    y: "var(--color-accent)",
    w: "var(--color-xmas-snow)",
};
