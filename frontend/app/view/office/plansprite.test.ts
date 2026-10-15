// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    mirrorOf,
    PLAN_SPRITES,
    planToken,
    seatSprite,
    shirtOf,
    spriteWidth,
    walkSprite,
    type PlanSprite,
} from "./plansprite";

const ALL = Object.keys(PLAN_SPRITES) as PlanSprite[];

describe("plansprite", () => {
    it("has the eighteen sprites the canvas's States board draws", () => {
        expect(ALL).toHaveLength(18);
    });

    it("draws every sprite at its width, with known codes only", () => {
        for (const s of ALL) {
            for (const row of PLAN_SPRITES[s]) {
                expect(row.length, s).toBe(spriteWidth(s));
                expect(row, s).toMatch(/^[HSETNPKC.]+$/);
            }
        }
    });

    it("keeps a pose's two frames the same height", () => {
        const pairs: [PlanSprite, PlanSprite][] = [
            ["sit", "nod"],
            ["hand1", "hand2"],
            ["cheer1", "cheer2"],
            ["down1", "down2"],
            ["up1", "up2"],
            ["side1", "side2"],
        ];
        for (const [a, b] of pairs) {
            expect(PLAN_SPRITES[a].length, a).toBe(PLAN_SPRITES[b].length);
        }
    });

    it("stands 19 rows tall and sits 12 to 14", () => {
        for (const s of ["cup", "down1", "down2", "up1", "up2", "boss"] as PlanSprite[]) {
            expect(PLAN_SPRITES[s].length, s).toBe(19);
        }
        for (const s of ["sit", "nod", "doze", "yawn", "back", "hand1", "cheer1", "stretch"] as PlanSprite[]) {
            expect(PLAN_SPRITES[s].length, s).toBeGreaterThanOrEqual(12);
            expect(PLAN_SPRITES[s].length, s).toBeLessThanOrEqual(14);
        }
    });

    it("maps seated poses and walks to sprites", () => {
        expect(seatSprite("sit", 0)).toBe("sit");
        expect(seatSprite("sit", 1)).toBe("nod");
        expect(seatSprite("hand", 1)).toBe("hand2");
        expect(seatSprite("cheer", 0)).toBe("cheer1");
        expect(seatSprite("empty", 0)).toBeUndefined();
        expect(walkSprite("up", 1)).toBe("up2");
        expect(walkSprite("left", 0)).toBe("side1");
        expect(mirrorOf("left")).toBe(true);
        expect(mirrorOf("right")).toBe(false);
    });

    it("gives the boss a paper tie and anyone else one in their shirt", () => {
        expect(planToken("N", { shirt: "--x", look: 1, boss: true })).toBe("--color-office-paper");
        expect(planToken("N", { shirt: "--x", look: 1 })).toBe("--x");
        expect(planToken("H", { shirt: "--x", look: 9 })).toBe("--color-office-hair-4");
        expect(planToken("H", { shirt: "--x", look: 0 })).toBe("--color-office-hair-1");
    });

    it("dresses a harness in its shirt, anything else in the other one", () => {
        expect(shirtOf("codex")).toBe("--color-office-shirt-codex");
        expect(shirtOf("opencode")).toBe("--color-office-shirt-other");
        expect(shirtOf(undefined)).toBe("--color-office-shirt-other");
    });
});
