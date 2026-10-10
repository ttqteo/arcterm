// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PET_PX } from "@/app/view/jarvis/petsprite";
import { describe, expect, it } from "vitest";
import { MINI_SPRITE_INSET, MINI_SPROUT_BOX, miniSproutRect, screenFor } from "./floatwindow";
import {
    afterOpen,
    FOLD_FALLBACK_MARGIN,
    foldCenter,
    foldSpot,
    minimizeAction,
    minimizeChoice,
    move,
    onSurfaceChange,
    sizeState,
    unfoldCenter,
    windowSize,
    type SizeState,
} from "./windowsize";

const full: SizeState = { size: "full", origin: null };
const float: SizeState = { size: "float", origin: null };
const foldedFromFull: SizeState = { size: "sprout", origin: "full" };
const foldedFromFloat: SizeState = { size: "sprout", origin: "float" };

describe("move", () => {
    it("folds Full into Sprout, keeping where it came from", () => expect(move(full, "fold")).toEqual(foldedFromFull));
    it("folds Float into Sprout, keeping where it came from", () =>
        expect(move(float, "fold")).toEqual(foldedFromFloat));
    it("restores to the size it was folded from", () => {
        expect(move(foldedFromFull, "restore")).toEqual(full);
        expect(move(foldedFromFloat, "restore")).toEqual(float);
    });
    it("toggles Full and Float", () => {
        expect(move(full, "toggle-float")).toEqual(float);
        expect(move(float, "toggle-float")).toEqual(full);
    });
    it("floats on an agent picked in the folded list, from either origin", () => {
        expect(move(foldedFromFull, "open-agent")).toEqual(float);
        expect(move(foldedFromFloat, "open-agent")).toEqual(float);
    });
    // folded, the shell is hidden: Shift+F there would shrink a window with nothing in it
    it("keeps the fold, and its origin, through Shift+F and a second fold", () => {
        expect(move(foldedFromFull, "toggle-float")).toEqual(foldedFromFull);
        expect(move(foldedFromFloat, "toggle-float")).toEqual(foldedFromFloat);
        expect(move(foldedFromFloat, "fold")).toEqual(foldedFromFloat);
    });
    it("leaves Full and Float alone on a restore or an agent pick", () => {
        for (const s of [full, float]) {
            expect(move(s, "restore")).toEqual(s);
            expect(move(s, "open-agent")).toEqual(s);
        }
    });
});

describe("sizeState and windowSize", () => {
    it("reads the size from the atoms", () => {
        expect(sizeState(false, false, null)).toEqual(full);
        expect(sizeState(true, false, null)).toEqual(float);
        expect(sizeState(false, true, "full")).toEqual(foldedFromFull);
        expect(sizeState(true, true, "float")).toEqual(foldedFromFloat);
    });
    it("reads a fold whose origin was lost from the float mode it still has", () => {
        expect(sizeState(true, true, null)).toEqual(foldedFromFloat);
        expect(sizeState(false, true, null)).toEqual(foldedFromFull);
    });
    it("names the size", () => {
        expect(windowSize(false, false)).toBe("full");
        expect(windowSize(true, false)).toBe("float");
        expect(windowSize(true, true)).toBe("sprout");
        expect(windowSize(false, true)).toBe("sprout");
    });
});

describe("onSurfaceChange", () => {
    it("ends a float that left the Agent surface", () => {
        expect(onSurfaceChange(float, "cockpit")).toBe("exit-float");
        expect(onSurfaceChange(float, "agent")).toBeNull();
    });
    // Open on a waiting item in the folded chat, or `wsh ui` showing a surface: the window comes back to show it
    it("gives the window back when a route switches the surface while folded from Full", () =>
        expect(onSurfaceChange(foldedFromFull, "jarvis")).toBe("restore"));
    it("ends the float under a fold from Float when the surface leaves Agent", () => {
        expect(onSurfaceChange(foldedFromFloat, "cockpit")).toBe("exit-float");
        expect(onSurfaceChange(foldedFromFloat, "agent")).toBeNull();
    });
    it("leaves Full alone", () => expect(onSurfaceChange(full, "usage")).toBeNull());
});

// Open on a waiting item in the folded chat, or `wsh ui`, often lands on the surface already shown: the surface does not
// change, so onSurfaceChange never fires, and the landing must still bring the window back
describe("afterOpen", () => {
    it("brings the window back when a route lands while folded, from either origin", () => {
        expect(afterOpen(foldedFromFull)).toBe("restore");
        expect(afterOpen(foldedFromFloat)).toBe("restore");
    });
    it("leaves Full and Float alone", () => {
        expect(afterOpen(full)).toBeNull();
        expect(afterOpen(float)).toBeNull();
    });
});

describe("minimize", () => {
    it("folds into Sprout unless window:minimize says dock", () => {
        expect(minimizeChoice(undefined)).toBe("sprout");
        expect(minimizeChoice("sprout")).toBe("sprout");
        expect(minimizeChoice("Dock")).toBe("sprout");
        expect(minimizeChoice(42)).toBe("sprout");
        expect(minimizeChoice("dock")).toBe("dock");
    });
    it("folds from Full and Float, docks when asked, and does nothing folded", () => {
        expect(minimizeAction("sprout", "full")).toBe("fold");
        expect(minimizeAction("sprout", "float")).toBe("fold");
        expect(minimizeAction("dock", "full")).toBe("dock");
        expect(minimizeAction("dock", "float")).toBe("dock");
        expect(minimizeAction("sprout", "sprout")).toBeNull();
        expect(minimizeAction("dock", "sprout")).toBeNull();
    });
});

const viewport = { width: 1440, height: 875 };

describe("foldSpot", () => {
    // Windows: physical pixels at 1.5x, the window's content at (100, 40)
    it("puts the folded sprite on the pixels the walking one stood on, from Full", () => {
        const spot = foldSpot({ x: 100, y: 40 }, 1.5, { x: 860, y: 818 }, viewport);
        expect(spot).toEqual({
            x: 100 + (860 - MINI_SPRITE_INSET) * 1.5,
            y: 40 + (818 - MINI_SPRITE_INSET) * 1.5,
            width: MINI_SPROUT_BOX * 1.5,
            height: MINI_SPROUT_BOX * 1.5,
        });
        expect(spot.x + MINI_SPRITE_INSET * 1.5).toBe(100 + 860 * 1.5);
    });
    // macOS: points, so the scale is 1 whatever the monitor's
    it("works in points from Float's ledge", () => {
        expect(foldSpot({ x: 700, y: 380 }, 1, { x: 600, y: 410 }, { width: 720, height: 460 })).toEqual({
            x: 700 + 600 - 8,
            y: 380 + 410 - 8,
            width: 64,
            height: 64,
        });
    });
    it("falls back to the content's bottom-right corner when no Sprout is drawn", () => {
        const spot = foldSpot({ x: 0, y: 0 }, 1, null, viewport);
        expect(spot.x + MINI_SPRITE_INSET).toBe(viewport.width - PET_PX - FOLD_FALLBACK_MARGIN);
        expect(spot.y + MINI_SPRITE_INSET).toBe(viewport.height - PET_PX - FOLD_FALLBACK_MARGIN);
    });
    it("lands on the monitor the window is on, a second one included", () => {
        const laptop = { area: { x: 0, y: 25, width: 1440, height: 875 }, scale: 1 };
        const side = { area: { x: 1440, y: 0, width: 1920, height: 1080 }, scale: 1 };
        const spot = foldSpot({ x: 1600, y: 100 }, 1, { x: 900, y: 700 }, { width: 1200, height: 800 });
        expect(screenFor(spot, [laptop, side], laptop)).toBe(side);
    });
    it("is pulled on screen when the walking Sprout stood past the screen's edge", () => {
        const work = { x: 0, y: 25, width: 1440, height: 875 };
        const r = miniSproutRect(foldSpot({ x: 1000, y: 500 }, 1, { x: 900, y: 600 }, viewport), work, 1);
        expect(r.x + r.width).toBeLessThanOrEqual(work.x + work.width);
        expect(r.y + r.height).toBeLessThanOrEqual(work.y + work.height);
    });
});

describe("foldCenter", () => {
    it("is the middle of the walking sprite", () =>
        expect(foldCenter({ x: 860, y: 818 }, viewport)).toEqual({ x: 860 + PET_PX / 2, y: 818 + PET_PX / 2 }));
    it("is the middle of the fallback corner when none is drawn", () =>
        expect(foldCenter(null, viewport)).toEqual({
            x: viewport.width - FOLD_FALLBACK_MARGIN - PET_PX / 2,
            y: viewport.height - FOLD_FALLBACK_MARGIN - PET_PX / 2,
        }));
});

describe("unfoldCenter", () => {
    const frame = { x: 100, y: 50 };
    it("grows the content out of Sprout's middle as the restored window sees it", () =>
        expect(unfoldCenter({ x: 900, y: 800, width: 64, height: 64 }, frame, 1, viewport)).toEqual({
            x: 900 + 32 - 100,
            y: 800 + 32 - 50,
        }));
    it("turns Windows' physical pixels into CSS pixels", () =>
        expect(unfoldCenter({ x: 1000, y: 600, width: 96, height: 96 }, { x: 0, y: 0 }, 1.5, viewport)).toEqual({
            x: 1048 / 1.5,
            y: 648 / 1.5,
        }));
    // dragged to another monitor while folded: the content still grows from inside the window
    it("pulls a Sprout dragged away from the window inside it", () =>
        expect(unfoldCenter({ x: 4000, y: -300, width: 64, height: 64 }, frame, 1, viewport)).toEqual({
            x: viewport.width,
            y: 0,
        }));
});
