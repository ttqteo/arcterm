// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RAIL_TREE, RAIL_TREE_FILL, RAIL_TREE_H, RAIL_TREE_W } from "./christmasrailtree";

const NEEDLES = new Set(["P", "d"]);
const ORNAMENT = new Set(["r", "y", "w"]);

describe("rail tree", () => {
    it("is a RAIL_TREE_W x RAIL_TREE_H grid whose every cell has a fill", () => {
        expect(RAIL_TREE).toHaveLength(RAIL_TREE_H);
        for (const row of RAIL_TREE) {
            expect(row).toHaveLength(RAIL_TREE_W);
            for (const c of row) {
                if (c !== ".") expect(RAIL_TREE_FILL[c]).toBeDefined();
            }
        }
    });

    it("has a mirror-symmetric silhouette", () => {
        for (const row of RAIL_TREE) {
            const shape = [...row].map((c) => (c === "." ? "." : "#")).join("");
            expect(shape).toBe([...shape].reverse().join(""));
        }
    });

    it("hangs every ornament inside the needles, never on an edge", () => {
        RAIL_TREE.forEach((row, y) => {
            [...row].forEach((c, x) => {
                if (!ORNAMENT.has(c)) return;
                const left = row[x - 1];
                const right = row[x + 1];
                expect(left !== undefined && left !== "." && right !== undefined && right !== ".").toBe(true);
                expect(NEEDLES.has(RAIL_TREE[y - 1]?.[x] ?? ".") || ORNAMENT.has(RAIL_TREE[y - 1]?.[x] ?? ".")).toBe(
                    true
                );
            });
        });
    });

    it("tops with the star, ends on the trunk, and has one rare piece", () => {
        expect(RAIL_TREE[0]).toContain("S");
        expect(RAIL_TREE[RAIL_TREE_H - 1].replace(/\./g, "")).toBe("TTT");
        expect(RAIL_TREE.join("").split("w")).toHaveLength(2);
    });
});
