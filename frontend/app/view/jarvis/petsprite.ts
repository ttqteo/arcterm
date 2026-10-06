// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sprout's pixels: every pose and mark as data, and the one function that turns them into cells. The grids
// live here and nowhere else (sprout spec §2, §4). Pure — no React, no atoms — so the walker can name a pose
// without knowing what it looks like, and the renderer can draw one without knowing why.
//
// A grid is 16 rows of 16 cell codes, `.` empty. Each code is a theme token rather than a colour, so a
// runtime theme repaints the creature through the same --color-* properties it overrides everywhere else.

export type PetPose = "walk1" | "walk2" | "stand" | "sit" | "sleep" | "tired" | "speak" | "dangle";

export type PetMark = "gate" | "escalation" | "blocked" | "z" | "drop" | "unread";

export const PET_GRID = 16;
export const PET_CELL_PX = 3;
export const PET_PX = PET_GRID * PET_CELL_PX;

// Cell code → the --color-* property its rect is filled with.
export const PET_TOKENS = {
    b: "--color-accent", // body
    d: "--color-accent-600", // sprout, legs
    l: "--color-accent-200", // highlight, sweat drop
    k: "--color-background", // eyes, mouth, the eye mark's pupil
    w: "--color-primary", // the review-gate eye mark
    m: "--color-muted", // the sleep z
    r: "--color-error", // the escalation !
    y: "--color-asking", // the blocked-worker ?
} as const satisfies Record<string, `--color-${string}`>;

type PetCode = keyof typeof PET_TOKENS;

const E = "................";

// Rows 0-3 are kept clear for the marks; the bottom row is the one that stands on the ledge. The sprout is
// the `t` of arcterm's mark: its crossbar is the leaves.
export const POSES: Record<PetPose, readonly string[]> = {
    walk1: [
        E,
        E,
        E,
        "........d.......",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "...dd......dd...",
    ],
    walk2: [
        E,
        E,
        E,
        "......d.........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        ".....dd..dd.....",
    ],
    stand: [
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    sit: [
        E,
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbbdd.",
    ],
    sleep: [
        E,
        E,
        E,
        E,
        E,
        E,
        ".......d........",
        ".....dd.dd......",
        ".......d........",
        "....llbbbbbb....",
        "..lbbbbbbbbbbb..",
        ".bbbbbbbbbbbbbb.",
        ".bbbkkbbbbkkbbb.",
        ".bbbbbbbbbbbbbb.",
        ".bbbbbbbbbbbbbb.",
        "..bbbbbbbbbbbb..",
    ],
    tired: [
        E,
        E,
        E,
        E,
        ".......d........",
        ".....dd.dd......",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    speak: [
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbkbbbbkbbb..",
        "..bbbbbkkbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    // being dragged: held by the sprout, legs hanging
    dangle: [
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbb..",
        "..bbbkkbbkkbbb..",
        "..bbbkkbbkkbbb..",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....d......d....",
        "....d......d....",
        "....d......d....",
    ],
};

// Each mark is a shape stamped at a fixed cell, never a count: the creature does not draw a number (pet spec
// §3), and each pairs its colour with a shape because status is never colour alone (DESIGN.md). Every one
// sits clear of the body of the pose it is stamped on (sprout spec §2), so stamping never hides a pixel.
export const MARKS: Record<PetMark, { x: number; y: number; rows: readonly string[] }> = {
    // review gate, on stand: an eye — "look at this"
    gate: { x: 11, y: 0, rows: [".www.", "wwkww", ".www."] },
    // escalation, on stand: !
    escalation: { x: 13, y: 0, rows: ["rr", "rr", "rr", "..", "rr"] },
    // blocked worker, on stand: ?
    blocked: { x: 13, y: 0, rows: ["yyy", "..y", ".yy", "...", ".y."] },
    // sleep, on sleep
    z: { x: 11, y: 0, rows: ["mmmm", "..m.", ".m..", "mmmm"] },
    // sweat drop, on tired
    drop: { x: 14, y: 4, rows: ["l.", "ll", "ll"] },
    // unread, on any pose
    unread: { x: 1, y: 5, rows: ["bb", "bb"] },
};

export interface PetCell {
    x: number;
    y: number;
    token: string;
}

function stamp(rows: readonly string[], x0: number, y0: number, out: PetCell[]): void {
    rows.forEach((row, dy) => {
        for (let dx = 0; dx < row.length; dx++) {
            const code = row[dx];
            if (code !== ".") {
                out.push({ x: x0 + dx, y: y0 + dy, token: PET_TOKENS[code as PetCode] });
            }
        }
    });
}

/**
 * The drawn cells of a pose and its marks, in grid cells (multiply by PET_CELL_PX for px).
 *
 * The pose's cells and the marks' cells come back apart because the renderer mirrors only the body when the
 * creature walks left: a `?` drawn inside the mirrored group would read backwards. Marks are a set — naming
 * one twice draws it once — so there is no way to stack them into a tally.
 */
export function spriteFor(pose: PetPose, marks: readonly PetMark[]): { body: PetCell[]; overlay: PetCell[] } {
    const body: PetCell[] = [];
    stamp(POSES[pose], 0, 0, body);
    const overlay: PetCell[] = [];
    for (const mark of new Set(marks)) {
        const { x, y, rows } = MARKS[mark];
        stamp(rows, x, y, overlay);
    }
    return { body, overlay };
}
