// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Draws a pose in an outfit once and keeps it (run office spec, "Drawing"). A desk shows an <img> of a 14-column
// PNG scaled 3x, so a person costs one DOM node and a frame change is a src swap. The people's colours are identity
// tokens no theme overrides, so an entry never goes stale; the cache is bounded by poses × shirts × looks (320).

import { gridPixels, parseColor, POSES, SPRITE_W, type CellRole, type SpritePose } from "./officesprite";

export interface Outfit {
    shirt: number; // graphlane 1..6, 0 the lead
    look: number; // 1..4
    visitor?: boolean; // a reviewer: their own shirt and look
}

// every token name is spelled out in full: Tailwind 4 drops an @theme variable whose name never appears literally in
// source, so a name built from a template string would read back empty and the person would draw with no skin or hair
const HAIR = ["--color-office-hair-1", "--color-office-hair-2", "--color-office-hair-3", "--color-office-hair-4"];
const SKIN = ["--color-office-skin-1", "--color-office-skin-2", "--color-office-skin-3", "--color-office-skin-4"];
const SHIRT = [
    "--color-graphlane-1",
    "--color-graphlane-2",
    "--color-graphlane-3",
    "--color-graphlane-4",
    "--color-graphlane-5",
    "--color-graphlane-6",
];
const PANTS = "--color-office-pants";
const INK = "--color-office-ink";
const PAPER = "--color-office-paper";
const BOX = "--color-office-box";
const LEAD = "--color-office-lead";
const VISITOR = "--color-office-visitor";

/** Every property the rasteriser can read, for the bench's `unresolved` check (jarvis-office). */
export const OFFICE_TOKENS: string[] = [...HAIR, ...SKIN, ...SHIRT, PANTS, INK, PAPER, BOX, LEAD, VISITOR];

const cache = new Map<string, string>();
const colors = new Map<string, [number, number, number] | undefined>();

function token(name: string): [number, number, number] | undefined {
    if (!colors.has(name)) {
        colors.set(name, parseColor(getComputedStyle(document.documentElement).getPropertyValue(name)));
    }
    return colors.get(name);
}

// a look or shirt out of range (a hand-built Outfit) falls back to the first rather than reading undefined
function pick(list: string[], n: number): string {
    return list[n - 1] ?? list[0];
}

function roleToken(role: CellRole, o: Outfit): string {
    const look = o.visitor ? 3 : o.look;
    switch (role) {
        case "H":
            return pick(HAIR, look);
        case "S":
            return pick(SKIN, look);
        case "T":
            return o.visitor ? VISITOR : o.shirt === 0 ? LEAD : pick(SHIRT, o.shirt);
        case "P":
            return PANTS;
        case "W":
            return PAPER;
        case "B":
            return BOX;
        default:
            return INK;
    }
}

/** The pose drawn in the outfit, as a data URL; "" when the page cannot draw (no 2d context). */
export function spriteUrl(pose: SpritePose, o: Outfit): string {
    const key = `${pose}|${o.visitor ? "v" : o.shirt}|${o.visitor ? 3 : o.look}`;
    const hit = cache.get(key);
    if (hit != null) {
        return hit;
    }
    const grid = POSES[pose];
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_W;
    canvas.height = grid.length;
    const ctx = canvas.getContext("2d");
    let url = "";
    if (ctx != null) {
        // createImageData rather than new ImageData(pixels, ...): the constructor's typing rejects a shared-buffer array
        const image = ctx.createImageData(SPRITE_W, grid.length);
        image.data.set(gridPixels(grid, (r) => token(roleToken(r, o))));
        ctx.putImageData(image, 0, 0);
        url = canvas.toDataURL("image/png");
    }
    cache.set(key, url);
    return url;
}

/** How many drawn sprites are kept, for the bench (jarvis-office-bench). */
export function spriteCacheSize(): number {
    return cache.size;
}
