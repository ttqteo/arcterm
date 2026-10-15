// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedSprite, gridPixels, parseColor, spriteCacheStats } from "./spritecache";

describe("spritecache", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reads hex and rgb colours, and nothing else", () => {
        expect(parseColor(" #0a0b0c ")).toEqual([10, 11, 12]);
        expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
        expect(parseColor("rgba(4, 5, 6, 0.5)")).toEqual([4, 5, 6]);
        expect(parseColor("red")).toBeUndefined();
    });

    it("paints only the coloured cells, at the grid's width", () => {
        const px = gridPixels(["A.", ".B"], 2, (c) => (c === "A" ? [1, 2, 3] : undefined));
        expect(Array.from(px.slice(0, 4))).toEqual([1, 2, 3, 255]);
        expect(Array.from(px.slice(4, 8))).toEqual([0, 0, 0, 0]);
        expect(Array.from(px.slice(12, 16))).toEqual([0, 0, 0, 0]);
    });

    it("keeps each namespace apart and drops the oldest entry past its cap", () => {
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
        const white = () => [255, 255, 255] as [number, number, number];
        cachedSprite("t1", "a", ["A"], 1, white, 2);
        cachedSprite("t1", "b", ["A"], 1, white, 2);
        cachedSprite("t1", "c", ["A"], 1, white, 2);
        cachedSprite("t2", "a", ["A"], 1, white);
        expect(spriteCacheStats("t1").entries).toBe(2);
        expect(spriteCacheStats("t2").entries).toBe(1);
        expect(spriteCacheStats("none")).toEqual({ entries: 0, bytes: 0 });
    });
});
