// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { NEAR_CHAIR } from "./officegrids";
import {
    ARM_PAD,
    MARKS,
    markUrl,
    mirrorOf,
    PLAN_SPRITES,
    planColor,
    planGrid,
    planSpriteUrl,
    seatSprite,
    SHEET_POSES,
    shirtOf,
    spriteLeft,
    spriteWidth,
    walkSprite,
    type PlanLook,
    type PlanSprite,
} from "./plansprite";
import { clearSprites, spriteCacheStats } from "./spritecache";

const ALL = Object.keys(PLAN_SPRITES) as PlanSprite[];
const LOOKS: PlanLook[] = [1, 2, 3, 4];
const ARMS: PlanSprite[] = ["hand1", "hand2", "cheer1", "cheer2", "stretch"];
const HEIGHT: Record<PlanSprite, number> = {
    sit: 17,
    nod: 17,
    doze: 17,
    yawn: 17,
    back: 15,
    backseat: 19,
    hand1: 20,
    hand2: 20,
    cheer1: 20,
    cheer2: 20,
    stretch: 20,
    cup: 23,
    stand: 23,
    down1: 23,
    down2: 23,
    up1: 23,
    up2: 23,
    side1: 23,
    side2: 23,
};

describe("plansprite", () => {
    it("has the nineteen sprites the canvas's Cast board draws", () => {
        expect([...ALL].sort()).toEqual((Object.keys(HEIGHT) as PlanSprite[]).sort());
        expect(SHEET_POSES).toHaveLength(18);
    });

    it("draws every sprite in every look at its size, with known codes only", () => {
        for (const look of LOOKS) {
            for (const s of ALL) {
                const g = planGrid(s, look);
                expect(g.length, `${s} ${look}`).toBe(HEIGHT[s]);
                for (const row of g) {
                    expect(row.length, `${s} ${look}`).toBe(spriteWidth(s));
                    expect(row, `${s} ${look}`).toMatch(/^[OHhSsETtPpKCRr_.]+$/);
                }
            }
        }
    });

    it("raises arms 20 wide, placed ARM_PAD to the left; everything else is 14 wide", () => {
        for (const s of ALL) {
            expect(spriteWidth(s), s).toBe(ARMS.includes(s) ? 20 : 14);
            expect(spriteLeft(s), s).toBe(ARMS.includes(s) ? -ARM_PAD : 0);
        }
    });

    it("ends a near-side seat with the chair the over canvas draws", () => {
        for (const look of LOOKS) {
            expect(planGrid("backseat", look).slice(-NEAR_CHAIR.length)).toEqual(NEAR_CHAIR);
        }
    });

    it("tells the looks apart by the head", () => {
        const heads = LOOKS.map((l) => planGrid("sit", l).slice(0, 11).join("\n"));
        expect(new Set(heads).size).toBe(4);
    });

    it("draws the bubbles and the ring", () => {
        for (const m of ["!", "?", "×"] as const) {
            expect(MARKS[m]).toHaveLength(9);
            for (const row of MARKS[m]) {
                expect(row).toMatch(/^[OFM.]{9}$/);
            }
        }
        expect(MARKS.ring[0]).toHaveLength(14);
    });

    it("colours a role from the phase, the look and the outfit", () => {
        const read = (t: string) => {
            const n = t.length; // a different colour per token, the same each time
            return [n, n + 1, n + 2] as [number, number, number];
        };
        const o = { shirt: "--color-office-shirt-pi", look: 2 };
        const day = planColor("O", o, "day", read);
        const after = planColor("O", o, "after", read);
        expect(day).toEqual(read("--color-office-day-ink"));
        expect(after).toEqual(read("--color-office-after-ink"));
        expect(planColor("H", o, "day", read)).toEqual(read("--color-office-plan-hair-2"));
        expect(planColor("T", o, "day", read)).toEqual(read("--color-office-shirt-pi"));
        expect(planColor("R", o, "after", read)).toEqual(read("--color-office-after-chair"));
        expect(planColor("_", o, "day", read)).toEqual(read("--color-office-day-shadow"));
        expect(planColor(".", o, "day", read)).toBeUndefined();
    });

    it("keys a sprite and a bubble by the phase, and a sprite by its shade", () => {
        vi.stubGlobal("document", { documentElement: {}, createElement: () => ({ getContext: () => null }) });
        vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#010203" }));
        clearSprites("plan");
        const o = { shirt: "--color-office-shirt-pi", look: 2 };
        planSpriteUrl("backseat", o, "day");
        planSpriteUrl("backseat", o, "after");
        planSpriteUrl("backseat", o, "day", "dark");
        planSpriteUrl("backseat", o, "day", "night");
        planSpriteUrl("backseat", o, "day", "both");
        planSpriteUrl("backseat", o, "day"); // the same as the first: no new entry
        markUrl("!", "day");
        markUrl("!", "after");
        expect(spriteCacheStats("plan").entries).toBe(7);
        clearSprites("plan");
        vi.unstubAllGlobals();
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

    it("dresses a harness in its shirt, anything else in the other one", () => {
        expect(shirtOf("codex")).toBe("--color-office-shirt-codex");
        expect(shirtOf("opencode")).toBe("--color-office-shirt-other");
        expect(shirtOf(undefined)).toBe("--color-office-shirt-other");
    });
});
