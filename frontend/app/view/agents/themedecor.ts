// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Spider theme's look beyond its palette: the spider mark in the app bar, a small spider (on the theme chip, the
// Settings offer, and on a thread from the agent tree's top), and webs in two corners. Pure: the cells, the paths
// and when each shows; themedecorview.tsx draws them.

import type { PetCharacter } from "@/app/view/jarvis/petsprite";
import type { ThemePalette } from "./themes";

export const SPIDER_THEME = "spider";

/** Whether the preset draws the spider decor: only the Spider theme does. */
export function hasSpiderDecor(preset: string): boolean {
    return preset === SPIDER_THEME;
}

/** Picking Spider-Man in Settings asks to switch to the Spider theme, unless it is already on. */
export function offersSpiderTheme(picked: PetCharacter, preset: string): boolean {
    return picked === "spidey" && !hasSpiderDecor(preset);
}

function mirrored(half: readonly string[]): string[] {
    return half.map((row) => row + [...row.slice(0, -1)].reverse().join(""));
}

// The mark, in the t> mark's 25x19 box at one CSS pixel a cell: head, a long body, and four legs a side, each two cells
// thick and bent at the knee. The left half up to the centre column; the right is its mirror.
export const SPIDER_MARK: readonly string[] = mirrored([
    ".............",
    ".....##......",
    ".....##....##",
    ".....##....##",
    "......##...##",
    "##.....##...#",
    ".##.....#####",
    "..##......###",
    "...##########",
    "..........###",
    "...##########",
    "..##......###",
    ".##.....#####",
    "##.....##.###",
    "......##...##",
    ".....##.....#",
    ".....##......",
    ".....##......",
    ".............",
]);

// The small spider, 9x8 cells drawn at 2px: S its body and legs, e its eyes.
export const SPIDER_SMALL: readonly string[] = [
    "S.......S",
    ".S.SSS.S.",
    "S.SeSeS.S",
    ".SSSSSSS.",
    ".SSSSSSS.",
    "S.SSSSS.S",
    ".S.SSS.S.",
    "S...S...S",
];

/**
 * The four swatches a theme chip shows: background, surface, accent and success. The Spider chip trades success for
 * its terminal blue, so it shows the suit's red and blue.
 */
export function chipSwatches(id: string, palette: ThemePalette): [string, string, string, string] {
    const last = hasSpiderDecor(id) ? (palette.ansiBlue ?? palette.success) : palette.success;
    return [palette.bg, palette.surface, palette.accent, last];
}

// Spider-sense around the small spider, as Spider-Man's in the fold (petsprite.ts SPIDEY_SENSE): a jag either side
// of its eyes and two over it, beside the thread. Cells of a frame 3 cells wider a side and 2 taller than the spider,
// so every jag stays a cell clear of it.
export const SPIDER_SENSE: readonly string[] = [
    ".....y...y.....",
    "...............",
    "...............",
    ".y...........y.",
    "y.............y",
    ".y...........y.",
];
export const SPIDER_SENSE_OFFSET = { x: 3, y: 2 } as const;

/** One SVG path of every `code` cell in `rows`, each a `cellPx` square, so a sprite is a path per color. */
export function cellsPath(rows: readonly string[], code: string, cellPx: number): string {
    let d = "";
    rows.forEach((row, y) => {
        [...row].forEach((c, x) => {
            if (c === code) {
                d += `M${x * cellPx} ${y * cellPx}h${cellPx}v${cellPx}h-${cellPx}z`;
            }
        });
    });
    return d;
}

// a web is wider than tall, as one strung across a corner sags
const WEB_STRETCH = 1.13;
const WEB_SPOKES = 6;
// each strand between two spokes sags toward the corner to this share of its ring
const WEB_SAG = 0.84;

/**
 * A corner web anchored at (0, 0) and opening down and to the right: six spokes over the quarter turn, and a strand
 * on each ring from spoke to spoke. Spans `radius * 1.13` wide and `radius` tall; flip it for another corner.
 */
export function cobwebPath(radius: number, rings: readonly number[]): string {
    const at = (r: number, a: number) =>
        `${(r * Math.cos(a) * WEB_STRETCH).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`;
    const angles = Array.from({ length: WEB_SPOKES }, (_, i) => ((Math.PI / 2) * i) / (WEB_SPOKES - 1));
    let d = angles.map((a) => `M0 0L${at(radius, a)}`).join("");
    for (const r of rings) {
        for (let i = 0; i < angles.length - 1; i++) {
            const mid = (angles[i] + angles[i + 1]) / 2;
            d += `M${at(r, angles[i])}Q${at(r * WEB_SAG, mid)} ${at(r, angles[i + 1])}`;
        }
    }
    return d;
}
