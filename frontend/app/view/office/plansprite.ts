// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's people, seen from above (cockpit office spec, "Drawing"): the chibi set, 14 columns (20 with a
// raised arm), a role code per cell, never a colour. O outline, H hair, h hair light, S skin, s skin shade, E eyes,
// T shirt, t shirt shade, P pants, p pants shade, K shoes, C cup, B the boss's cap, W cap badge or tie, R chair,
// r chair shade, _ ground shadow. planSpriteUrl draws one in an outfit, a phase and a shade once, through the shared
// cache (namespace "plan", capped at 600).
// The grids are the prototype's (prototype/sprites.mjs): when they disagree, it wins.

import { NEAR_CHAIR } from "./officegrids";
import { liftRgb, PHASE_TOKENS, shadeRgb, type OfficePhase } from "./officepalette";
import { cachedSprite, tokenRgb, type Rgb } from "./spritecache";

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
    | "backseat"
    | "cup"
    | "stand"
    | "down1"
    | "down2"
    | "up1"
    | "up2"
    | "side1"
    | "side2"
    | "boss";
export type PlanLook = 1 | 2 | 3 | 4 | "boss";
export type Shade = "" | "dark" | "night" | "both";
export type SeatPose = "sit" | "hand" | "cheer" | "doze" | "back" | "empty";
export type WalkDir = "up" | "down" | "left" | "right";

export const PLAN_W = 14;
export const ARM_W = 20;
// a raised arm runs beside the head: these sprites are 20 wide, the person at columns 3..16 (placed 3 left)
export const ARM_PAD = 3;
export const PLAN_CELL = 3;
export const PLAN_CACHE_CAP = 600;

const FRONT: Record<PlanLook, string[]> = {
    1: [
        "....OOOOOO....",
        "..OOHHHHHHOO..",
        ".OHHhhHHHHHHO.",
        ".OHhHHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHSHHSSSHHHO",
        "OHSSSSSSSSSSHO",
        "OSSSESSSSESSSO",
        "OSSSESSSSESSSO",
        ".OsSSSSSSSSsO.",
        "..OOssssssOO..",
    ],
    2: [
        "....OOOOOO....",
        "..OOHHHHHHOO..",
        ".OHHhhHHHHHHO.",
        ".OHhHHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHSSSSSSSSHHO",
        "OHHSSSSSSSSHHO",
        "OHSSESSSSESSHO",
        "OHSSESSSSESSHO",
        "OHHsSSSSSSsHHO",
        ".OOOssssssOOO.",
    ],
    3: [
        "..OO..OOOO....",
        ".OHHOOHHHHOO..",
        ".OHhHHHHHHHHO.",
        ".OHhhHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHSSSHHO",
        "OHSSSSSSSSSSHO",
        "OSSSESSSSESSSO",
        "OSSSESSSSESSSO",
        ".OsSSSSSSSSsO.",
        "..OOssssssOO..",
    ],
    4: [
        ".....OOOO.....",
        "....OHhHHO....",
        "..OOOOHHOOOO..",
        ".OHHhHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHSSSSSSSSHHO",
        "OHSSSSSSSSSSHO",
        "OSSSESSSSESSSO",
        "OSSSESSSSESSSO",
        ".OsSSSSSSSSsO.",
        "..OOssssssOO..",
    ],
    boss: [
        "...OOOOOOOO...",
        "..OBBBBBBBBO..",
        ".OBBBWWBBBBBO.",
        ".OBBBBBBBBBBO.",
        "OBBBBBBBBBBBBO",
        "OOOOOOOOOOOOOO",
        "OHSSSSSSSSSSHO",
        "OSSSESSSSESSSO",
        "OSSSESSSSESSSO",
        ".OsSSSSSSSSsO.",
        "..OOssssssOO..",
    ],
};

const BACK: Record<PlanLook, string[]> = {
    1: [
        "....OOOOOO....",
        "..OOHHHHHHOO..",
        ".OHHhhHHHHHHO.",
        ".OHhHHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OSHHHHHHHHHHSO",
        "OSHHHHHHHHHHSO",
        ".OHHHHHHHHHHO.",
        "..OOssssssOO..",
    ],
    2: [
        "....OOOOOO....",
        "..OOHHHHHHOO..",
        ".OHHhhHHHHHHO.",
        ".OHhHHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        ".OOOHHHHHHOOO.",
    ],
    3: [
        "..OO..OOOO....",
        ".OHHOOHHHHOO..",
        ".OHhHHHHHHHHO.",
        ".OHhhHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OSHHHHHHHHHHSO",
        "OSHHHHHHHHHHSO",
        ".OHHHHHHHHHHO.",
        "..OOssssssOO..",
    ],
    4: [
        ".....OOOO.....",
        "....OHhHHO....",
        "..OOOOHHOOOO..",
        ".OHHhHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHHHHHO",
        "OSHHHHHHHHHHSO",
        "OSHHHHHHHHHHSO",
        ".OHHHHHHHHHHO.",
        "..OOssssssOO..",
    ],
    boss: [
        "...OOOOOOOO...",
        "..OBBBBBBBBO..",
        ".OBBBBBBBBBBO.",
        ".OBBBBBBBBBBO.",
        "OBBBBBBBBBBBBO",
        "OOOOOOOOOOOOOO",
        "OHHHHHHHHHHHHO",
        "OSHHHHHHHHHHSO",
        "OSHHHHHHHHHHSO",
        ".OHHHHHHHHHHO.",
        "..OOssssssOO..",
    ],
};

const SIDE: Record<PlanLook, string[]> = {
    1: [
        "....OOOOOO....",
        "..OOHHHHHHOO..",
        ".OHHhhHHHHHHO.",
        ".OHhHHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHSSSHO",
        "OHHHHHSSSSSSSO",
        "OHHHSSSSSSESSO",
        "OHHHSSSSSSESSO",
        ".OHHsSSSSSSsO.",
        "..OOOssssOOO..",
    ],
    2: [
        "....OOOOOO....",
        "..OOHHHHHHOO..",
        ".OHHhhHHHHHHO.",
        ".OHhHHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHSSSHHO",
        "OHHHHHSSSSSSHO",
        "OHHHHSSSSSESSO",
        "OHHHHSSSSSESSO",
        "OHHHHHsSSSSsO.",
        ".OOOOOOssOOO..",
    ],
    3: [
        "..OO..OOOO....",
        ".OHHOOHHHHOO..",
        ".OHhHHHHHHHHO.",
        ".OHhhHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHSSSHO",
        "OHHHHHSSSSSSSO",
        "OHHHSSSSSSESSO",
        "OHHHSSSSSSESSO",
        ".OHHsSSSSSSsO.",
        "..OOOssssOOO..",
    ],
    4: [
        ".....OOOO.....",
        "....OHhHHO....",
        "..OOOOHHOOOO..",
        ".OHHhHHHHHHHO.",
        "OHHHHHHHHHHHHO",
        "OHHHHHHHHSSSHO",
        "OHHHHHSSSSSSSO",
        "OHHHSSSSSSESSO",
        "OHHHSSSSSSESSO",
        ".OHHsSSSSSSsO.",
        "..OOOssssOOO..",
    ],
    boss: [
        "...OOOOOOO....",
        "..OBBBBBBBO...",
        ".OBBBBBBWWBO..",
        ".OBBBBBBBBBO..",
        "OBBBBBBBBBBBO.",
        "OOOOOOOOOOOOOO",
        "OHHHHHSSSSSSSO",
        "OHHHSSSSSSESSO",
        "OHHHSSSSSSESSO",
        ".OHHsSSSSSSsO.",
        "..OOOssssOOO..",
    ],
};

// eyes shut: the upper eye row goes to skin, the lower stays a line
const shut = (head: string[]): string[] => head.map((r, i) => (i === 7 ? r.replace(/E/g, "S") : r));
const yawning = (head: string[]): string[] => {
    const h = shut(head);
    h[9] = h[9].slice(0, 6) + "OO" + h[9].slice(8);
    return h;
};

const SIT = [
    "..OOTTTTTTOO..",
    ".OTTTTTTTTTtO.",
    "OTTOTTTTTTOTtO",
    "OTTOTTTTTtOTtO",
    "OTTOTTTTTtOTtO",
    "OSSOTTTTTtOSSO",
];
const SIT_NOARM_R = [
    "..OOTTTTTTOO..",
    ".OTTTTTTTTTtO.",
    "OTTOTTTTTTTtO.",
    "OTTOTTTTTTTtO.",
    "OTTOTTTTTTTtO.",
    "OSSOTTTTTTTtO.",
];
const SIT_NOARMS = [
    "..OOTTTTTTOO..",
    "..OTTTTTTTtO..",
    "..OTTTTTTTtO..",
    "..OTTTTTTTtO..",
    "..OTTTTTTTtO..",
    "..OTTTTTTTtO..",
];
const pad = (rows: string[]): string[] => rows.map((r) => "..." + r + "...");
const arm = (rows: string[], side: "r" | "l", wave: boolean): string[] => {
    // the hand on rows 0..2, a two-pixel sleeve down beside the head to the shoulder
    const out = rows.map((r) => r.split(""));
    const put = (x: number, y: number, c: string) => {
        if (side === "l") {
            x = 19 - x;
        }
        if (out[y] && x >= 0 && x < ARM_W) {
            out[y][x] = c;
        }
    };
    const hx = wave ? 16 : 15;
    [".OO.", "OSSO", "OSSO"].forEach((seg, y) => [...seg].forEach((c, i) => c !== "." && put(hx + i, y, c)));
    for (let y = 3; y <= 13; y++) {
        put(15, y, "O");
        put(16, y, "T");
        put(17, y, "t");
        put(18, y, "O");
    }
    if (wave) {
        put(15, 2, "O");
        put(18, 3, "O");
        put(19, 2, "O");
    }
    // the shoulder
    put(14, 14, "O");
    put(15, 14, "T");
    put(16, 14, "T");
    put(17, 14, "O");
    put(18, 14, ".");
    return out.map((r) => r.join(""));
};
const UP3 = ["....................", "....................", "...................."];
const BACK_TORSO = ["..OOTTTTTTOO..", ".OTTTTTTTTTtO.", "OTTTTTTTTTTtTO", "OTTTTTTTTTTtTO"];
const STAND = [
    "..OOTTTTTTOO..",
    ".OTTTTTTTTTtO.",
    "OTTOTTTTTtOTtO",
    "OTTOTTTTTtOTtO",
    "OSSOTTTTTtOSSO",
    ".OOOTTTTTtOOO.",
];
const STAND_TIE = [
    "..OOTWWWWTOO..",
    ".OTTTTWWTTTtO.",
    "OTTOTTWWTtOTtO",
    "OTTOTTWWTtOTtO",
    "OSSOTTTTTtOSSO",
    ".OOOTTTTTtOOO.",
];
const STAND_CUP = [
    "..OOTTTTTTOO..",
    ".OTTTTTTTTTtO.",
    "OTTOTTTTTOOOO.",
    "OTTOTTTTOCCCCO",
    "OSSOTTTTOCCCO.",
    ".OOOTTTTTOOO..",
];
const STAND_BACK = [
    "..OOTTTTTTOO..",
    ".OTTTTTTTTTtO.",
    "OTTOTTTTTtOTtO",
    "OTTOTTTTTtOTtO",
    "OSSOTTTTTtOSSO",
    ".OOOTTTTTtOOO.",
];
const LEGS = [
    "...OPPPPPpO...",
    "...OPPPPPpO...",
    "...OPPOOPpO...",
    "...OPPOOPpO...",
    "..OKKKOOKKKO..",
    "..__OO__OO__..",
];
const LEGS_A = [
    "...OPPPPPpO...",
    "...OPPOOPpO...",
    "...OPPOOPpO...",
    "..OKKKOOPpO...",
    "...OOO_OKKKO..",
    "..___.__OOO_..",
];
const LEGS_B = [
    "...OPPPPPpO...",
    "...OPPOOPpO...",
    "...OPPOOPpO...",
    "...OPpOOKKKO..",
    "..OKKKO_OOO...",
    "..OOO___.___..",
];
const SIDE_BODY = [
    "....OOTTTTOO..",
    "...OTTTTTTTtO.",
    "...OTTTTTTTtO.",
    "...OTTOTTTTtO.",
    "...OTOSOTTTtO.",
    "...OOOOTTTOOO.",
];
const SIDE_BODY_B = [
    "....OOTTTTOO..",
    "...OTTTTTTTtO.",
    "...OTTTTTTTtO.",
    "...OTTTTOTTtO.",
    "...OTTTOSOTtO.",
    "...OOOOOOOOOO.",
];
const SIDE_LEGS_A = [
    "....OPPPPpO...",
    "...OPPpOPPpO..",
    "..OPPpO.OPPpO.",
    "..OKKO...OKKKO",
    "..OOO.....OOO.",
    "..__.......__.",
];
const SIDE_LEGS_B = [
    "....OPPPPpO...",
    "....OPPPPpO...",
    "....OPPOPpO...",
    "....OPPOPpO...",
    "...OKKKKKKKO..",
    "...OOOOOOOOO..",
];

const blank = [".............."];

/** Every pose for a look. Bottom rows line up: a seated pose's last row sits 2 rows under the desk top. */
function build(look: PlanLook): Record<PlanSprite, string[]> {
    const F = FRONT[look];
    const B = BACK[look];
    const Sd = SIDE[look];
    const torso = look === "boss" ? STAND_TIE : STAND;
    return {
        sit: [...F, ...SIT],
        nod: [...blank, ...F, ...SIT.slice(0, 5)],
        hand1: arm([...UP3, ...pad([...F, ...SIT_NOARM_R])], "r", false),
        hand2: arm([...UP3, ...pad([...F, ...SIT_NOARM_R])], "r", true),
        cheer1: arm(arm([...UP3, ...pad([...F, ...SIT_NOARMS])], "r", false), "l", false),
        // the second frame a row higher: a little hop
        cheer2: arm(arm([...UP3, ...pad([...F, ...SIT_NOARMS.slice(0, 5)]), ".".repeat(ARM_W)], "r", true), "l", true),
        doze: [...shut(F), ...SIT],
        yawn: [...yawning(F), ...SIT],
        stretch: arm(arm([...UP3, ...pad([...yawning(F), ...SIT_NOARMS])], "r", false), "l", false),
        back: [...B, ...BACK_TORSO],
        backseat: [...B, ...BACK_TORSO.slice(0, 2), ...NEAR_CHAIR],
        cup: [...F, ...STAND_CUP, ...LEGS],
        stand: [...F, ...torso, ...LEGS],
        down1: [...F, ...torso, ...LEGS_A],
        down2: [...F, ...torso, ...LEGS_B],
        up1: [...B, ...STAND_BACK, ...LEGS_A],
        up2: [...B, ...STAND_BACK, ...LEGS_B],
        side1: [...Sd, ...SIDE_BODY, ...SIDE_LEGS_A],
        side2: [...Sd, ...SIDE_BODY_B, ...SIDE_LEGS_B],
        boss: [...B, ...STAND_BACK, ...LEGS],
    };
}
const built = new Map<PlanLook, Record<PlanSprite, string[]>>();
export function planGrid(s: PlanSprite, look: PlanLook): string[] {
    let set = built.get(look);
    if (set == null) {
        set = build(look);
        built.set(look, set);
    }
    return set[s];
}
// look 1's grids: every look has the same sizes (a test pins it), so these answer the sizes and the pose sheet
export const PLAN_SPRITES: Record<PlanSprite, string[]> = build(1);

export function spriteWidth(s: PlanSprite): number {
    return PLAN_SPRITES[s][0].length;
}
/** Where a sprite's left edge sits from a 14-wide person's, in art px: a raised arm widens it to the left. */
export function spriteLeft(s: PlanSprite): number {
    return spriteWidth(s) === ARM_W ? -ARM_PAD : 0;
}

export type PlanMark = "!" | "?" | "×" | "ring";
// O outline (the phase's ink), F fill (asking, or error for ×), M the mark (ink), A the boss's ring (the accent)
export const MARKS: Record<PlanMark, string[]> = {
    "!": [
        ".OOOOOOO.",
        "OFFFMFFFO",
        "OFFFMFFFO",
        "OFFFMFFFO",
        "OFFFFFFFO",
        "OFFFMFFFO",
        ".OOOOOOO.",
        "..OO.....",
        "..O......",
    ],
    "?": [
        ".OOOOOOO.",
        "OFFMMMFFO",
        "OFFFFMFFO",
        "OFFFMMFFO",
        "OFFFFFFFO",
        "OFFFMFFFO",
        ".OOOOOOO.",
        "..OO.....",
        "..O......",
    ],
    "×": [
        ".OOOOOOO.",
        "OFMFFFMFO",
        "OFFMFMFFO",
        "OFFFMFFFO",
        "OFFMFMFFO",
        "OFMFFFMFO",
        ".OOOOOOO.",
        "..OO.....",
        "..O......",
    ],
    ring: ["..AAAAAAAAAA..", ".A..........A.", "A............A", ".A..........A.", "..AAAAAAAAAA.."],
};

// the canvas's Cast board: its columns, and its boss row as prototype/boards.mjs castSheet draws it
export const SHEET_POSES: PlanSprite[] = [
    "sit",
    "nod",
    "hand1",
    "hand2",
    "cheer1",
    "cheer2",
    "doze",
    "yawn",
    "stretch",
    "back",
    "backseat",
    "cup",
    "down1",
    "down2",
    "up1",
    "up2",
    "side1",
    "side2",
];
export const BOSS_POSES: PlanSprite[] = ["stand", "boss", "down1", "down2", "up1", "up2", "side1", "side2"];
export const SHEET_SHIRTS = [
    "--color-office-shirt-claude",
    "--color-office-shirt-codex",
    "--color-office-shirt-pi",
    "--color-office-shirt-agy",
];

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
const HAIR = [
    "--color-office-plan-hair-1",
    "--color-office-plan-hair-2",
    "--color-office-plan-hair-3",
    "--color-office-plan-hair-4",
];
const SKIN = ["--color-office-skin-1", "--color-office-skin-2", "--color-office-skin-3", "--color-office-skin-4"];
const PANTS = "--color-office-pants";
const PAPER = "--color-office-paper";
const CUP = "--color-office-cup";
const DARK = "--color-office-dark";
const NIGHT = "--color-office-night";

export interface PlanOutfit {
    shirt: string; // a --color-* token name
    look: number; // 1..4, skin and hair
    boss?: boolean;
}

export function shirtOf(harness: string | undefined): string {
    return (harness != null && HARNESS_SHIRT[harness]) || OTHER_SHIRT;
}

const clampLook = (look: number) => Math.min(4, Math.max(1, Math.round(look) || 1));

/** The colour a cell code draws in, for an outfit in a phase; undefined for a clear cell. */
export function planColor(
    code: string,
    o: PlanOutfit,
    phase: OfficePhase,
    read: (token: string) => Rgb | undefined = tokenRgb
): Rgb | undefined {
    const i = clampLook(o.look) - 1;
    const shade = (t: string, f: number) => {
        const c = read(t);
        return c && shadeRgb(c, f);
    };
    const t = PHASE_TOKENS[phase];
    switch (code) {
        case "O":
        case "E":
        case "K":
            return read(t.ink);
        case "H":
            return read(HAIR[i]);
        case "h": {
            const c = read(HAIR[i]);
            return c && liftRgb(c, 0.28);
        }
        case "S":
            return read(SKIN[i]);
        case "s":
            return shade(SKIN[i], 0.86);
        case "T":
            return read(o.shirt);
        case "t":
            return shade(o.shirt, 0.8);
        case "P":
            return read(PANTS);
        case "p":
            return shade(PANTS, 0.78);
        case "C":
            return read(CUP);
        case "B":
            return read(BOSS_SHIRT);
        case "W":
            return read(PAPER);
        case "R":
            return read(t.chair);
        case "r":
            return shade(t.chair, 0.8);
        case "_":
            return read(t.shadow);
        default:
            return undefined;
    }
}

// a tint laid over an opaque colour, as the over canvas lays it over everything under it; the colour keeps its alpha
function tinted(c: Rgb | undefined, tints: (Rgb | undefined)[]): Rgb | undefined {
    if (c == null) {
        return undefined;
    }
    let out: Rgb = [c[0], c[1], c[2]];
    for (const t of tints) {
        const a = t?.[3] ?? 0;
        if (t && a > 0) {
            out = [0, 1, 2].map((k) => Math.round(out[k] * (1 - a) + t[k] * a)) as Rgb;
        }
    }
    if (c[3] != null) {
        out[3] = c[3];
    }
    return out;
}

/** The sprite in the outfit and the phase, drawn once; a near-side seat in a dark room or after hours is shaded. */
export function planSpriteUrl(s: PlanSprite, o: PlanOutfit, phase: OfficePhase = "day", shade: Shade = ""): string {
    const look: PlanLook = o.boss ? "boss" : (clampLook(o.look) as PlanLook);
    const grid = planGrid(s, look);
    const tints = shade === "both" ? [DARK, NIGHT] : shade === "dark" ? [DARK] : shade === "night" ? [NIGHT] : [];
    const key = `${s}|${o.shirt}|${o.look}|${o.boss ? 1 : 0}|${phase}|${shade}`;
    return cachedSprite(
        "plan",
        key,
        grid,
        grid[0].length,
        (code) =>
            tinted(
                planColor(code, o, phase),
                tints.map((t) => tokenRgb(t))
            ),
        PLAN_CACHE_CAP
    );
}

/** A bubble or the boss's ring in the phase, drawn once. */
export function markUrl(m: PlanMark, phase: OfficePhase): string {
    const rows = MARKS[m];
    const ink = PHASE_TOKENS[phase].ink;
    const fill = m === "×" ? "--color-error" : "--color-asking";
    return cachedSprite(
        "plan",
        `mark|${m}|${phase}`,
        rows,
        rows[0].length,
        (code) =>
            code === "O" || code === "M"
                ? tokenRgb(ink)
                : code === "F"
                  ? tokenRgb(fill)
                  : code === "A"
                    ? tokenRgb("--color-accent")
                    : undefined,
        PLAN_CACHE_CAP
    );
}

/** Every property planSpriteUrl and markUrl can read, for the probe's unresolved check (cockpit-office). */
export const PLAN_TOKENS: string[] = [
    ...HAIR,
    ...SKIN,
    ...Object.values(HARNESS_SHIRT),
    OTHER_SHIRT,
    LEAD_SHIRT,
    BOSS_SHIRT,
    ...LANE_SHIRTS,
    PANTS,
    PAPER,
    CUP,
    DARK,
    NIGHT,
    "--color-asking",
    "--color-error",
    "--color-accent",
    ...(["day", "after"] as const).flatMap((p) => [PHASE_TOKENS[p].ink, PHASE_TOKENS[p].shadow, PHASE_TOKENS[p].chair]),
];
