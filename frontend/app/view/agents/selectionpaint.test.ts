// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { bandRadius, lineBands } from "./selectionpaint";

// a glyph box 18px tall on a 23.1px line, `n` lines down
const glyph = (left: number, right: number, n = 0, lineHeight = 23.1) => ({
    left,
    right,
    top: 10 + n * 23.1,
    bottom: 28 + n * 23.1,
    lineHeight,
});

describe("lineBands", () => {
    it("grows each line's box to the line's height, so wrapped lines meet with no strip between", () => {
        const bands = lineBands([glyph(40, 600, 0), glyph(20, 610, 1), glyph(20, 200, 2)]);
        expect(bands).toHaveLength(3);
        expect(bands[0].height).toBeCloseTo(23.1);
        expect(bands[0].top + bands[0].height).toBeCloseTo(bands[1].top);
        expect(bands[1].top + bands[1].height).toBeCloseTo(bands[2].top);
    });

    it("ends each band at its line's text, not the column's edge", () => {
        const bands = lineBands([glyph(20, 200)]);
        expect(bands[0].left).toBe(20);
        expect(bands[0].width).toBe(180);
    });

    it("joins a word, a bold run and a code span on one line into one band, over the code span's padding", () => {
        const code = { left: 140, right: 220, top: 12, bottom: 27, lineHeight: 21.2 };
        const bands = lineBands([glyph(20, 80), glyph(80, 134), code, glyph(226, 300)]);
        expect(bands).toHaveLength(1);
        expect(bands[0]).toMatchObject({ left: 20, width: 280 });
        expect(bands[0].height).toBeCloseTo(23.1);
    });

    it("squares the corners where wrapped lines meet and rounds only the shape's outer ones", () => {
        // a paragraph picked from mid first line to mid last line: 40–600, 20–610, 20–200
        const [a, b, c] = lineBands([glyph(40, 600, 0), glyph(20, 610, 1), glyph(20, 200, 2)]);
        // the first line sits over a wider one: its bottom corners meet it
        expect(a.round).toEqual({ tl: true, tr: true, br: false, bl: false });
        // the middle line juts out past the first on both sides (top corners round), and the last starts under its left
        // edge (bottom-left square) but ends short of its right (bottom-right round)
        expect(b.round).toEqual({ tl: true, tr: true, br: true, bl: false });
        expect(c.round).toEqual({ tl: false, tr: false, br: true, bl: true });
        expect(bandRadius(c)).toBe("0 0 3px 3px");
    });

    it("rounds every corner of a single line, and of lines a blank line keeps apart", () => {
        expect(lineBands([glyph(20, 200)])[0].round).toEqual({ tl: true, tr: true, br: true, bl: true });
        // two paragraphs: a margin between them, so neither meets the other
        const far = { left: 20, right: 300, top: 80, bottom: 98, lineHeight: 23.1 };
        for (const band of lineBands([glyph(20, 300), far])) {
            expect(band.round).toEqual({ tl: true, tr: true, br: true, bl: true });
        }
    });

    it("keeps apart two runs on one line with a gap between them, and drops empty boxes", () => {
        expect(lineBands([glyph(20, 80), glyph(300, 360)])).toHaveLength(2);
        expect(lineBands([glyph(20, 20), { left: 0, right: 50, top: 5, bottom: 5, lineHeight: 20 }])).toHaveLength(0);
    });
});
