// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's people, seen from above (cockpit office spec, "Drawing"): a grid per sprite, 12 columns (the
// sideways walk 14), a role code per cell, never a colour. planSpriteUrl draws one in an outfit once, through the
// shared cache (namespace "plan", capped at 600). The Run office keeps its side-view set (view/jarvis/officesprite.ts).

import { cachedSprite, tokenRgb } from "./spritecache";

// H hair, S skin, E eyes and mouth, T shirt, N tie (paper on the boss, the shirt on anyone else), P pants, K shoes,
// C the cup
export type PlanSprite =
    | "sit"
    | "nod"
    | "hand1"
    | "hand2"
    | "cheer1"
    | "cheer2"
    | "doze"
    | "yawn"
    | "stretch"
    | "back"
    | "cup"
    | "down1"
    | "down2"
    | "up1"
    | "up2"
    | "side1"
    | "side2"
    | "boss";
export type SeatPose = "sit" | "hand" | "cheer" | "doze" | "back" | "empty";
export type WalkDir = "up" | "down" | "left" | "right";

export const PLAN_W = 12;
export const SIDE_W = 14;
export const PLAN_CELL = 3;
export const PLAN_CACHE_CAP = 600;

const HEAD = [
    "....HHHH....",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..HSSSSSSH..",
    "..SSESSESS..",
    "..SSSSSSSS..",
    "...SSSSSS...",
    "....SSSS....",
];
const BACK_HEAD = [
    "....HHHH....",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..SHHHHHHS..",
    "...HHHHHH...",
    "....SSSS....",
];
const BODY = ["..TTTTTTTT..", ".TTTTTTTTTT.", ".TTTTTTTTTT.", ".TTTTTTTTTT."];
const TORSO = ["..TTTTTTTT..", ".TTTTTTTTTT.", ".TTTTTTTTTT.", ".STTTTTTTTS.", ".S.TTTTTT.S."];
const TIE = ["..TTNNNNTT..", ".TTTTNNTTTT.", ".TTTTNNTTTT.", ".STTTNNTTTS.", ".S.TTTTTT.S."];
const LEGS = ["...TTTTTT...", "...PPPPPP...", "...PP..PP...", "...PP..PP...", "...PP..PP...", "..KKK..KKK.."];
const LEGS1 = ["...TTTTTT...", "...PPPPPP...", "...PP..PP...", "...PP..PP...", "..KKK..PP...", ".......KKK.."];
const LEGS2 = ["...TTTTTT...", "...PPPPPP...", "...PP..PP...", "...PP..PP...", "...PP.KKK...", "..KKK......."];
const CHEER_TOP = [".SS......SS.", ".TT.HHHH.TT.", "..THHHHHHT.."];
const CHEER_TOP2 = ["SS........SS", "TT..HHHH..TT", ".TTHHHHHHTT."];
const SIDE_TOP = [
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
    "..TTTTTTTT....",
];
const closed = (rows: string[]) => rows.map((r) => r.replace(/E/g, "S"));

export const PLAN_SPRITES: Record<PlanSprite, string[]> = {
    sit: [...HEAD, ...BODY],
    nod: ["............", ...HEAD, ...BODY.slice(0, 3)],
    doze: closed([...HEAD, ...BODY]),
    yawn: [...HEAD.slice(0, 4), "..SSSSSSSS..", "..SSSSSSSS..", "...SSEESS...", "....SSSS....", ...BODY],
    hand1: [
        "..........SS",
        "..........TT",
        "....HHHH..TT",
        "..HHHHHHHHTT",
        "..HHHHHHHHT.",
        "..HSSSSSSH..",
        "..SSESSESS..",
        "..SSSSSSSS..",
        "...SSSSSS...",
        "....SSSS....",
        ...BODY,
    ],
    hand2: [
        ".........SS.",
        ".........TT.",
        "....HHHH.TT.",
        "..HHHHHHHTT.",
        "..HHHHHHHHT.",
        "..HSSSSSSH..",
        "..SSESSESS..",
        "..SSSSSSSS..",
        "...SSSSSS...",
        "....SSSS....",
        ...BODY,
    ],
    cheer1: [...CHEER_TOP, ...HEAD.slice(2), ...BODY],
    cheer2: [...CHEER_TOP2, ...HEAD.slice(2), ...BODY],
    stretch: closed([...CHEER_TOP, ...HEAD.slice(2), ...BODY]),
    back: [...BACK_HEAD, ...BODY],
    cup: [...HEAD, "..TTTTTTTT..", ".TTTTTTTTTT.", ".TTTTTTTTSCC", ".STTTTTTTSCC", ".S.TTTTTT...", ...LEGS],
    down1: [...HEAD, ...TIE, ...LEGS1],
    down2: [...HEAD, ...TIE, ...LEGS2],
    up1: [...BACK_HEAD, ...TORSO, ...LEGS1],
    up2: [...BACK_HEAD, ...TORSO, ...LEGS2],
    side1: [
        ...SIDE_TOP,
        "..STTTTTTS....",
        "...PPPPPP.....",
        "..PPP..PPP....",
        ".PPP....PPP...",
        "PPP......PPP..",
        "KKKK.....KKKK.",
    ],
    side2: [
        ...SIDE_TOP,
        "..STTTTTTS....",
        "...PPPPPP.....",
        "....PPPP......",
        "....PPPP......",
        "...PP.PPP.....",
        "..KKK.KKKK....",
    ],
    // the boss at a desk: its back to you, looking at it
    boss: [...BACK_HEAD, ...TORSO, ...LEGS],
};

export function spriteWidth(s: PlanSprite): number {
    return s === "side1" || s === "side2" ? SIDE_W : PLAN_W;
}

/** The sprite a seated pose shows on a frame; undefined for an empty chair. A sitting person nods on frame 1. */
export function seatSprite(pose: SeatPose, frame: 0 | 1): PlanSprite | undefined {
    switch (pose) {
        case "sit":
            return frame ? "nod" : "sit";
        case "hand":
            return frame ? "hand2" : "hand1";
        case "cheer":
            return frame ? "cheer2" : "cheer1";
        case "doze":
            return "doze";
        case "back":
            return "back";
        case "empty":
            return undefined;
    }
}

/** The sprite someone walking shows; left is the sideways sprite mirrored in CSS (mirrorOf). */
export function walkSprite(dir: WalkDir, frame: 0 | 1): PlanSprite {
    if (dir === "up") {
        return frame ? "up2" : "up1";
    }
    if (dir === "down") {
        return frame ? "down2" : "down1";
    }
    return frame ? "side2" : "side1";
}

export function mirrorOf(dir: WalkDir): boolean {
    return dir === "left";
}

// every token name spelled out in full: Tailwind 4 drops an @theme variable whose name never appears literally in
// source, so a name built from a template string would read back empty and the person would draw with no colour
export const HARNESS_SHIRT: Record<string, string> = {
    claude: "--color-office-shirt-claude",
    codex: "--color-office-shirt-codex",
    pi: "--color-office-shirt-pi",
    agy: "--color-office-shirt-agy",
};
export const OTHER_SHIRT = "--color-office-shirt-other";
export const LEAD_SHIRT = "--color-office-lead";
export const BOSS_SHIRT = "--color-office-boss";
export const LANE_SHIRTS = [
    "--color-graphlane-1",
    "--color-graphlane-2",
    "--color-graphlane-3",
    "--color-graphlane-4",
    "--color-graphlane-5",
    "--color-graphlane-6",
];
const HAIR = ["--color-office-hair-1", "--color-office-hair-2", "--color-office-hair-3", "--color-office-hair-4"];
const SKIN = ["--color-office-skin-1", "--color-office-skin-2", "--color-office-skin-3", "--color-office-skin-4"];
const PANTS = "--color-office-pants";
const INK = "--color-office-ink";
const PAPER = "--color-office-paper";
const CUP = "--color-office-cup";

/** Every property planSpriteUrl can read, for the probe's unresolved check (cockpit-office). */
export const PLAN_TOKENS: string[] = [
    ...HAIR,
    ...SKIN,
    ...Object.values(HARNESS_SHIRT),
    OTHER_SHIRT,
    LEAD_SHIRT,
    BOSS_SHIRT,
    ...LANE_SHIRTS,
    PANTS,
    INK,
    PAPER,
    CUP,
];

export interface PlanOutfit {
    shirt: string; // a --color-* token name
    look: number; // 1..4, skin and hair
    boss?: boolean;
}

export function shirtOf(harness: string | undefined): string {
    return (harness != null && HARNESS_SHIRT[harness]) || OTHER_SHIRT;
}

/** The token a cell code draws in, for an outfit; a look out of range clamps to 1..4. */
export function planToken(code: string, o: PlanOutfit): string | undefined {
    const look = Math.min(4, Math.max(1, Math.round(o.look) || 1)) - 1;
    switch (code) {
        case "H":
            return HAIR[look];
        case "S":
            return SKIN[look];
        case "E":
        case "K":
            return INK;
        case "T":
            return o.shirt;
        case "N":
            return o.boss ? PAPER : o.shirt;
        case "P":
            return PANTS;
        case "C":
            return CUP;
        default:
            return undefined;
    }
}

/** The sprite in the outfit, drawn once; "" when the page cannot draw. */
export function planSpriteUrl(s: PlanSprite, o: PlanOutfit): string {
    const key = `${s}|${o.shirt}|${o.look}|${o.boss ? 1 : 0}`;
    return cachedSprite(
        "plan",
        key,
        PLAN_SPRITES[s],
        spriteWidth(s),
        (code) => {
            const t = planToken(code, o);
            return t != null ? tokenRgb(t) : undefined;
        },
        PLAN_CACHE_CAP
    );
}
