// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { nextTextSwap, swapDelay, swapParts, type TextSwapState } from "./textswapmodel";

describe("nextTextSwap", () => {
    const start: TextSwapState = { key: "a", text: "sao lag vậy", swap: 0 };

    it("keeps the same state when nothing changed, so a re-render never restarts the reveal", () => {
        expect(nextTextSwap(start, "a", "sao lag vậy")).toBe(start);
    });

    it("plays when the same thing's text changes, and again on each later change", () => {
        const one = nextTextSwap(start, "a", "Hiệu năng chậm bất thường");
        expect(one).toEqual({ key: "a", text: "Hiệu năng chậm bất thường", swap: 1 });
        expect(nextTextSwap(one, "a", "Hiệu năng chậm").swap).toBe(2);
    });

    it("does not play when the text names another thing", () => {
        expect(nextTextSwap(start, "b", "fix the build")).toEqual({ key: "b", text: "fix the build", swap: 0 });
    });

    it("does not play a first text arriving after none", () => {
        expect(nextTextSwap({ key: "a", text: "", swap: 0 }, "a", "fix").swap).toBe(0);
    });
});

describe("swapParts", () => {
    it("cuts words and keeps the spaces, so the parts join back to the text", () => {
        const text = "Hiệu năng  chậm bất thường";
        const parts = swapParts(text);
        expect(parts).toEqual(["Hiệu", " ", "năng", "  ", "chậm", " ", "bất", " ", "thường"]);
        expect(parts.join("")).toBe(text);
    });

    it("keeps leading and trailing space", () => {
        expect(swapParts(" a ").join("")).toBe(" a ");
        expect(swapParts("")).toEqual([]);
    });
});

describe("swapDelay", () => {
    it("staggers a short title by the most, the first word at once", () => {
        expect(swapDelay(0, 5)).toBe(0);
        expect(swapDelay(2, 5)).toBeCloseTo(0.1);
    });

    it("fits a long title's stagger into the same span", () => {
        expect(swapDelay(19, 20)).toBeCloseTo(0.24);
        expect(swapDelay(0, 1)).toBe(0);
    });
});
