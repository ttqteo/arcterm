// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { revealScrollTop } from "./treescroll";

// a 400px list scrolled to 1000, of 24px rows
const VIEW = { top: 1000, height: 400 };
const row = (top: number) => ({ top, height: 24 });

describe("revealScrollTop", () => {
    it("leaves a row that shows whole where it is", () => {
        expect(revealScrollTop(VIEW, row(1000))).toBeNull();
        expect(revealScrollTop(VIEW, row(1376))).toBeNull();
    });

    it("scrolls a step past either edge just into view", () => {
        // the row below the last whole one, and one cut by the bottom edge
        expect(revealScrollTop(VIEW, row(1400))).toBe(1024);
        expect(revealScrollTop(VIEW, row(1390))).toBe(1014);
        // the row above the first whole one, and one cut by the top edge
        expect(revealScrollTop(VIEW, row(976))).toBe(976);
        expect(revealScrollTop(VIEW, row(990))).toBe(990);
    });

    it("centers a row further away, a jump", () => {
        expect(revealScrollTop(VIEW, row(3000))).toBe(3000 - 188);
        expect(revealScrollTop(VIEW, row(500))).toBe(500 - 188);
        // arriving with the list at its top, as Open in Code does
        expect(revealScrollTop({ top: 0, height: 400 }, row(980))).toBe(980 - 188);
    });

    it("never centers above the top of the list", () => {
        expect(revealScrollTop(VIEW, row(48))).toBe(0);
    });
});
