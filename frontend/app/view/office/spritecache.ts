// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Draws a pixel grid once and keeps it as a PNG data URL, for both offices: the Run office's side view
// (view/jarvis/officesprites.ts, namespace "run") and the Cockpit office's floor plan (plansprite.ts, "plan").
// A namespace keeps each office's entries apart, so each bench counts only its own; a cap bounds a namespace, the
// oldest entry going first.

export type Rgb = [number, number, number];

const caches = new Map<string, Map<string, string>>();
const colors = new Map<string, Rgb | undefined>();

/** A computed custom property's value ("#rrggbb" or "rgb(r, g, b)") as bytes; anything else undefined. */
export function parseColor(value: string): Rgb | undefined {
    const v = value.trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

/** A --color-* token's value on the root, read once: people's colours are identity tokens no theme overrides. */
export function tokenRgb(name: string): Rgb | undefined {
    if (!colors.has(name)) {
        colors.set(name, parseColor(getComputedStyle(document.documentElement).getPropertyValue(name)));
    }
    return colors.get(name);
}

/** RGBA bytes for a grid `width` cells wide, row-major; ".", a missing cell or a code with no colour stays clear. */
export function gridPixels(grid: string[], width: number, color: (code: string) => Rgb | undefined): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * grid.length * 4);
    grid.forEach((row, y) => {
        for (let x = 0; x < width; x++) {
            const c = row[x];
            if (c == null || c === ".") {
                continue;
            }
            const rgb = color(c);
            if (rgb == null) {
                continue;
            }
            const i = (y * width + x) * 4;
            out[i] = rgb[0];
            out[i + 1] = rgb[1];
            out[i + 2] = rgb[2];
            out[i + 3] = 255;
        }
    });
    return out;
}

/** The grid drawn once and kept under ns/key, as a data URL; "" when the page cannot draw (no 2d context). */
export function cachedSprite(
    ns: string,
    key: string,
    grid: string[],
    width: number,
    color: (code: string) => Rgb | undefined,
    cap = Number.POSITIVE_INFINITY
): string {
    let cache = caches.get(ns);
    if (cache == null) {
        cache = new Map();
        caches.set(ns, cache);
    }
    const hit = cache.get(key);
    if (hit != null) {
        return hit;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = grid.length;
    // willReadFrequently keeps the canvas in software: a GPU-backed one made toDataURL ~1.2 ms a sprite (the run
    // office's first open spent 80-95 ms there), a software one ~0.07 ms
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let url = "";
    if (ctx != null) {
        // createImageData rather than new ImageData(pixels, ...): the constructor's typing rejects a shared-buffer array
        const image = ctx.createImageData(width, grid.length);
        image.data.set(gridPixels(grid, width, color));
        ctx.putImageData(image, 0, 0);
        url = canvas.toDataURL("image/png");
    }
    if (cache.size >= cap) {
        const oldest = cache.keys().next().value;
        if (oldest != null) {
            cache.delete(oldest);
        }
    }
    cache.set(key, url);
    return url;
}

/** What a namespace holds: its entries, and their data URLs' total length in bytes. */
export function spriteCacheStats(ns: string): { entries: number; bytes: number } {
    const cache = caches.get(ns);
    let bytes = 0;
    cache?.forEach((url) => {
        bytes += url.length;
    });
    return { entries: cache?.size ?? 0, bytes };
}
