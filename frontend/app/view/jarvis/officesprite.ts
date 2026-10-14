// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run office's people as data (run office spec, "Drawing"): every pose a grid of cell codes, and the one function
// that turns a grid into pixels. Pure, like petsprite.ts: the model names a pose without knowing its cells, and the
// rasteriser (officesprites.ts) draws one without knowing why.
//
// A grid is 14 columns, 18 rows sitting and 22 standing, `.` empty, feet on the last row, facing right. A code is a
// role (hair, skin, eye, shirt, pants, shoes, paper, box); officesprites.ts resolves a role to a --color-* property.

// what a desk shows: officemodel.ts picks one per task, spriteFor below names its grid
export type DeskPose = "empty" | "stand" | "type" | "slump" | "lean" | "hands" | "box" | "handup";

export type SpritePose =
    | "type1"
    | "type2"
    | "handup1"
    | "handup2"
    | "slump"
    | "lean"
    | "hands"
    | "stand"
    | "clip"
    | "box";

export type CellRole = "H" | "S" | "E" | "T" | "P" | "K" | "W" | "B";

export const SPRITE_W = 14;

const HEAD = [
    "..............",
    "....HHHH......",
    "...HHHHHH.....",
    "...HHHSSS.....",
    "...HHSSES.....",
    "...HHSSSSS....",
    "....SSSS......",
    ".....SS.......",
];
// the seated body from the waist down, behind the chair's seat
const LAP = [
    "...TTTTTT.....",
    "...TTTTTT.....",
    "...TTTTTT.....",
    "...PPPPPPPP...",
    "...PPPPPPPPP..",
    "..........PP..",
    "..........PP..",
    ".........KKKK.",
];
const STAND_TOP = [
    "....HHHH......",
    "...HHHHHH.....",
    "...HHHSSS.....",
    "...HHSSES.....",
    "...HHSSSSS....",
    "....SSSS......",
    ".....SS.......",
    "...TTTTTT.....",
    "..TTTTTTTT....",
    "..TTTTTTTT....",
];
const STAND_LEGS = [
    "..STTTTTTS....",
    "...PPPPPP.....",
    "...PPPPPP.....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "...PPP.PPP....",
    "..KKKK.KKKK...",
];
const HAND_UP = (top: string, side: string) => [
    top,
    side,
    "...HHHHHH.TT..",
    "...HHHSSS.TT..",
    "...HHSSES.TT..",
    "...HHSSSSSTT..",
    "....SSSS.TT...",
    ".....SS.TT....",
    "...TTTTTT.....",
    "...TTTTTT.....",
];

export const POSES: Record<SpritePose, string[]> = {
    type1: [...HEAD, "...TTTTTT.....", "...TTTTTTTTSS.", ...LAP],
    type2: [...HEAD, "...TTTTTT.....", "...TTTTTTTT...", "...TTTTTT...SS", ...LAP.slice(1)],
    handup1: [...HAND_UP("..........SS..", "....HHHH..TT.."), ...LAP],
    handup2: [...HAND_UP(".........SS...", "....HHHH.TT..."), ...LAP],
    slump: [
        "..............",
        "..............",
        "..............",
        "..............",
        "..............",
        "......HHHH....",
        ".....HHHHHH...",
        ".....HHHSSSS..",
        "...TTTTTTSSSS.",
        "...TTTTTTTTSS.",
        ...LAP,
    ],
    lean: [
        "..............",
        "...HHHH.......",
        "..HHHHHH......",
        ".SHHHSSS......",
        ".SHHSSES......",
        ".STHSSSSS.....",
        "..TTSSSS......",
        "...TTSS.......",
        "..TTTTTT......",
        "..TTTTTT......",
        "..TTTTTT......",
        "..TTTTTT......",
        "...TTTTTT.....",
        "...PPPPPPPP...",
        "...PPPPPPPPP..",
        "..........PP..",
        "..........PP..",
        ".........KKKK.",
    ],
    hands: [
        "..............",
        "....HHHH......",
        "..SSHHHHSS....",
        "..TTHHSSST....",
        "..T.HSSEST....",
        "..T.HSSSST....",
        "..TT.SSSSTT...",
        "...TTTSSTT....",
        "...TTTTTT.....",
        "...TTTTTT.....",
        ...LAP,
    ],
    stand: [...STAND_TOP, "..TTTTTTTT....", "..TTTTTTTT....", ...STAND_LEGS],
    clip: [...STAND_TOP, "..TTTTTTTT.WW.", "..TTTTTTTTSWW.", "..STTTTTTT....", ...STAND_LEGS.slice(1)],
    box: [...STAND_TOP, "..TTTTTTBBBB..", "..TTTTTTBBBB..", "..STTTTSBBBB..", ...STAND_LEGS.slice(1)],
};

/** The grid a desk pose shows on a frame; undefined for an empty chair. */
export function spriteFor(pose: DeskPose, frame: 0 | 1): SpritePose | undefined {
    switch (pose) {
        case "type":
            return frame ? "type2" : "type1";
        case "handup":
            return frame ? "handup2" : "handup1";
        case "empty":
            return undefined;
        default:
            return pose;
    }
}

/** RGBA bytes for a grid, row-major, SPRITE_W × rows; an empty cell, or a role with no colour, stays clear. */
export function gridPixels(
    grid: string[],
    color: (role: CellRole) => [number, number, number] | undefined
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(SPRITE_W * grid.length * 4);
    grid.forEach((row, y) => {
        for (let x = 0; x < SPRITE_W; x++) {
            const c = row[x];
            if (c == null || c === ".") {
                continue;
            }
            const rgb = color(c as CellRole);
            if (rgb == null) {
                continue;
            }
            const i = (y * SPRITE_W + x) * 4;
            out[i] = rgb[0];
            out[i + 1] = rgb[1];
            out[i + 2] = rgb[2];
            out[i + 3] = 255;
        }
    });
    return out;
}

/** A computed custom property's value ("#rrggbb" or "rgb(r, g, b)") as bytes; anything else undefined. */
export function parseColor(value: string): [number, number, number] | undefined {
    const v = value.trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}
