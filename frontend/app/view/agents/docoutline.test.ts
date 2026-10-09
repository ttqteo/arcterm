// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { activeItem, outlineItems } from "./docoutline";

describe("outlineItems", () => {
    it("indents from the shallowest heading", () => {
        const items = outlineItems([
            { level: 2, text: "Goal" },
            { level: 3, text: "Task 1:  Pull" },
            { level: 2, text: "Verify" },
        ]);
        expect(items).toEqual([
            { index: 0, depth: 0, text: "Goal" },
            { index: 1, depth: 1, text: "Task 1: Pull" },
            { index: 2, depth: 0, text: "Verify" },
        ]);
    });

    it("drops headings too deep, keeping each one's index", () => {
        const items = outlineItems([
            { level: 1, text: "Plan" },
            { level: 4, text: "Step 1" },
            { level: 2, text: "Task 1" },
        ]);
        expect(items.map((it) => [it.index, it.text])).toEqual([
            [0, "Plan"],
            [2, "Task 1"],
        ]);
    });

    it("is empty when there is nothing to navigate", () => {
        expect(outlineItems([])).toEqual([]);
        expect(outlineItems([{ level: 1, text: "Only" }])).toEqual([]);
        expect(
            outlineItems([
                { level: 1, text: "A" },
                { level: 2, text: "  " },
            ])
        ).toEqual([]);
    });
});

describe("activeItem", () => {
    it("is the last heading above the reading line", () => {
        expect(activeItem([0, 400, 900], 450, 24)).toBe(1);
        expect(activeItem([0, 400, 900], 880, 24)).toBe(2);
    });

    it("is the first before anything scrolls up", () => {
        expect(activeItem([120, 400], 0, 24)).toBe(0);
    });

    it("is -1 with no headings", () => {
        expect(activeItem([], 0, 24)).toBe(-1);
    });
});
