import { describe, expect, it } from "vitest";
import { floatMarkSprite } from "./petfloat";
import { MARKS } from "./petsprite";

// the cells a mark stamps, as "x,y" pairs, so a test can look for them in a sprite's overlay
function markCells(mark: keyof typeof MARKS): string[] {
    const { x, y, rows } = MARKS[mark];
    return rows.flatMap((row, dy) => [...row].flatMap((c, dx) => (c === "." ? [] : [`${x + dx},${y + dy}`])));
}

describe("floatMarkSprite", () => {
    // float mode hides the walking creature, so the float bar carries what is waiting, and nothing when nothing is
    it("draws nothing when nothing waits on you", () => {
        expect(floatMarkSprite("none", null)).toBeNull();
    });

    it("draws a standing Sprout wearing the posture's mark", () => {
        const sprite = floatMarkSprite("blocked-worker", null);
        expect(sprite).not.toBeNull();
        const overlay = sprite!.overlay.map((c) => `${c.x},${c.y}`);
        expect(overlay).toEqual(expect.arrayContaining(markCells("blocked")));
        expect(sprite!.body.length).toBeGreaterThan(0);
    });

    it("marks a review gate with the eye and an escalation with the bang", () => {
        expect(floatMarkSprite("review-gate", null)!.overlay.map((c) => `${c.x},${c.y}`)).toEqual(
            expect.arrayContaining(markCells("gate"))
        );
        expect(floatMarkSprite("escalation", null)!.overlay.map((c) => `${c.x},${c.y}`)).toEqual(
            expect.arrayContaining(markCells("escalation"))
        );
    });

    it("wears the outfit the walking creature wears", () => {
        const plain = floatMarkSprite("blocked-worker", null)!;
        const flag = floatMarkSprite("blocked-worker", "vn-flag")!;
        expect(plain.back).toEqual([]);
        expect(flag.back.length).toBeGreaterThan(0);
    });
});
