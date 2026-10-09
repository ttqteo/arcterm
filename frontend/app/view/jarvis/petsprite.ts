// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sprout's pixels: every pose and mark as data, and the one function that turns them into cells. The grids
// live here and nowhere else (sprout spec §2, §4). Pure — no React, no atoms — so the walker can name a pose
// without knowing what it looks like, and the renderer can draw one without knowing why.
//
// A grid is 16 rows of 16 cell codes, `.` empty. Each code is a theme token rather than a colour, so a
// runtime theme repaints the creature through the same --color-* properties it overrides everywhere else.

export type PetPose =
    | "walk1"
    | "walk2"
    | "stand"
    | "sit"
    | "sleep"
    | "tired"
    | "speak"
    | "dangle"
    // the pastimes a rest is spent in (petwalk.ts PASTIMES), two frames each
    | "read1"
    | "read2"
    | "music1"
    | "music2"
    | "work1"
    | "work2"
    | "ball1"
    | "ball2";

export type PetMark = "gate" | "escalation" | "blocked" | "z" | "drop" | "unread";

// What it wears in Vietnam's colours, chosen in Settings (petoutfit.ts): the flag shirt over a pose, or the flag in
// its hand behind one.
export type PetOutfit = "vn-shirt" | "vn-flag";

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
    R: "--color-flag-red", // the flag shirt
    Y: "--color-flag-star", // the shirt's star
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
    // Pastimes. None draws a `k` outside the face, which dressInFlag reads as the eyes, and each keeps the unread
    // mark's cells clear.
    // studying: sat with an open book on its lap, eyes running along the lines
    read1: [
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
        "..bbbbbbbbbbbb..",
        "..bbbbkbbbbkbb..",
        "..brwwwwrwwwwr..",
        "..brmmwwrmmwwr..",
        "...rrrrrrrrrrdd.",
    ],
    read2: [
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
        "..bbbbbbbbbbbb..",
        "..bbbkbbbbkbbb..",
        "..brwwwwrwwwwr..",
        "..brwwmmrwwmmr..",
        "...rrrrrrrrrrdd.",
    ],
    // listening to music: headphones on, eyes shut, notes drifting up while the sprout sways
    music1: [
        "............yy..",
        "..yy........y...",
        "..y.........y...",
        ".yy....d...yy...",
        "......dddd......",
        ".......d........",
        "....mmmdmmmm....",
        "...mllbbbbbbm...",
        "..mlbbbbbbbbbm..",
        ".rrbbbbbbbbbbrr.",
        ".rrbbbbbbbbbbrr.",
        ".rrbkkbbbbkkbrr.",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    music2: [
        "..yy............",
        "..y..........yy.",
        ".yy..........y..",
        "......d......y..",
        "......dddd..yy..",
        ".......d........",
        "....mmmdmmmm....",
        "...mllbbbbbbm...",
        "..mlbbbbbbbbbm..",
        ".rrbbbbbbbbbbrr.",
        ".rrbbbbbbbbbbrr.",
        ".rrbkkbbbbkkbrr.",
        "..bbbbbbbbbbbb..",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    // working: sat at a laptop seen side-on, its screen lighting the face, a key lit as it types and the code mark
    // blinking over its head
    work1: [
        ".......w...w.w..",
        "......w...w...w.",
        ".......w.w...w..",
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb.m.",
        "..bbbbbbbbbbblm.",
        "..bbbbkbbbbkblm.",
        "..bbbbkbbbbkblm.",
        "..bbbbbbbbbbblm.",
        "..bbbbbbbmwmmmm.",
        "...bbbbbbbbbbdd.",
    ],
    work2: [
        ".......m...m.m..",
        "......m...m...m.",
        ".......m.m...m..",
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb.m.",
        "..bbbbbbbbbbbwm.",
        "..bbbbkbbbbkbwm.",
        "..bbbbkbbbbkbwm.",
        "..bbbbbbbbbbbwm.",
        "..bbbbbbbmmmwmm.",
        "...bbbbbbbbbbdd.",
    ],
    // playing sport: dribbling a basketball at its side, high then low
    ball1: [
        E,
        E,
        E,
        ".......d........",
        "......dddd......",
        ".......d........",
        ".......d........",
        "....llbbbbbb....",
        "...lbbbbbbbbb...",
        "..bbbbbbbbbbbyy.",
        "..bbbbkbbbbkyyyy",
        "..bbbbkbbbbkyyyy",
        "..bbbbbbbbbbbyy.",
        "..bbbbbbbbbbbb..",
        "...bbbbbbbbbb...",
        "....dd....dd....",
    ],
    ball2: [
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
        "..bbbbkbbbbkbb..",
        "..bbbbkbbbbkbb..",
        "..bbbbbbbbbbbyy.",
        "..bbbbbbbbbbyyyy",
        "...bbbbbbbbbyyyy",
        "....dd....dd.yy.",
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

const isBody = (code: string | undefined) => code === "b" || code === "l";

// The shirt's star: a point up, the arms across, two legs.
const FLAG_STAR = ["..Y..", "..Y..", "YYYYY", ".YYY.", ".Y.Y."];

// The flag shirt over a pose. Below today's face the body is three rows, too short for a star that reads as one, so
// the face (eyes, and the mouth while speaking) moves up two rows and every body cell below it becomes the shirt,
// with the star's point centred on its first row. Only recolours: the outline and the sprout stay as they are, so
// the marks still sit clear of the body and the creature still stands on the ledge.
function dressInFlag(rows: readonly string[]): string[] {
    const g = rows.map((row) => [...row]);
    const face: [number, number][] = [];
    rows.forEach((row, y) => [...row].forEach((code, x) => code === "k" && face.push([x, y])));
    for (const [x, y] of face) {
        g[y][x] = "b";
    }
    for (const [x, y] of face) {
        if (isBody(g[y - 2]?.[x])) {
            g[y - 2][x] = "k";
        }
    }
    const top = Math.max(...face.map(([, y]) => y - 2)) + 1;
    for (let y = top; y < PET_GRID; y++) {
        for (let x = 0; x < PET_GRID; x++) {
            if (isBody(g[y][x])) {
                g[y][x] = "R";
            }
        }
    }
    const shirt = g[top].flatMap((code, x) => (code === "R" ? [x] : []));
    const x0 = Math.floor((shirt[0] + shirt[shirt.length - 1]) / 2) - Math.floor(FLAG_STAR[0].length / 2);
    FLAG_STAR.forEach((row, dy) =>
        [...row].forEach((code, dx) => {
            if (code === "Y" && g[top + dy]?.[x0 + dx] === "R") {
                g[top + dy][x0 + dx] = "Y";
            }
        })
    );
    return g.map((row) => row.join(""));
}

const DRESSED = {} as Record<PetPose, readonly string[]>;
for (const pose of Object.keys(POSES) as PetPose[]) {
    DRESSED[pose] = dressInFlag(POSES[pose]);
}

/** A pose's grid in an outfit: dressed in the shirt, else the pose itself (the flag is held, not worn). */
export function outfitRows(pose: PetPose, outfit: PetOutfit | null): readonly string[] {
    return outfit === "vn-shirt" ? DRESSED[pose] : POSES[pose];
}

// How many rows the flag rises above the sprite's top: its cloth flies over the head, where the grid has no room for
// a star that reads as one. The renderer lets the svg overflow upward to draw it.
export const PET_FLAG_RISE = 4;

// The 9×7 cloth: the full star inside a one-cell red border.
const FLAG_CLOTH = ["RRRRRRRRR", "RRRRYRRRR", "RRRRYRRRR", "RRYYYYYRR", "RRRYYYRRR", "RRRYRYRRR", "RRRRRRRRR"];

// The flag held at its left: the pole in column 0 from the cloth's top down to the ledge, the cloth beside it. Drawn
// behind the body and never mirrored, so it stays on the left whichever way the creature walks, clear of the marks
// stamped at the right; where the body crosses it (the dangling sprout), the body is on top.
const FLAG_CELLS: PetCell[] = [];
for (let y = -PET_FLAG_RISE; y < PET_GRID; y++) {
    FLAG_CELLS.push({ x: 0, y, token: "--color-muted" });
}
FLAG_CLOTH.forEach((row, dy) =>
    [...row].forEach((code, dx) =>
        FLAG_CELLS.push({ x: 1 + dx, y: dy - PET_FLAG_RISE, token: PET_TOKENS[code as PetCode] })
    )
);

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
 * one twice draws it once — so there is no way to stack them into a tally. `back` is drawn under the body and,
 * like the marks, never mirrored: the flag in hand, whose cloth rises above row 0 (PET_FLAG_RISE).
 */
export function spriteFor(
    pose: PetPose,
    marks: readonly PetMark[],
    outfit: PetOutfit | null = null
): { back: PetCell[]; body: PetCell[]; overlay: PetCell[] } {
    // drawn first, under the body: the flag in hand
    const back = outfit === "vn-flag" ? [...FLAG_CELLS] : [];
    const body: PetCell[] = [];
    stamp(outfitRows(pose, outfit), 0, 0, body);
    const overlay: PetCell[] = [];
    for (const mark of new Set(marks)) {
        const { x, y, rows } = MARKS[mark];
        stamp(rows, x, y, overlay);
    }
    return { back, body, overlay };
}
