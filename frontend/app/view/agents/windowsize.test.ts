// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { miniSproutRect } from "./floatwindow";
import {
    afterOpen,
    autoFoldOnLeave,
    autoRestoreOnReturn,
    autoSproutOn,
    FOLD_FADE_FROM,
    foldFade,
    minimizeAction,
    minimizeChoice,
    move,
    onReopen,
    onSurfaceChange,
    sizeState,
    sproutCenter,
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
describe("onReopen", () => {
    // folded, Sprout can be on another Space or behind a full-screen app; the Dock icon is the way back that is always there
    it("brings the window back from either origin when the Dock icon is clicked while folded", () => {
        expect(onReopen(foldedFromFull)).toBe("restore");
        expect(onReopen(foldedFromFloat)).toBe("restore");
    });
    it("leaves Full and Float to macOS", () => {
        expect(onReopen(full)).toBeNull();
        expect(onReopen({ size: "float", origin: null })).toBeNull();
    });
});

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

describe("auto Sprout", () => {
    const left = { on: true, size: "full" as const, foreground: "covered" as const, minimized: false, visible: true };
    it("is off unless window:autosprout is true", () => {
        expect(autoSproutOn(undefined)).toBe(false);
        expect(autoSproutOn("true")).toBe(false);
        expect(autoSproutOn(true)).toBe(true);
    });
    it("folds Full when the app you left for covers arcterm", () => expect(autoFoldOnLeave(left)).toBe(true));
    it("leaves it be when that app sits beside arcterm, which still shows", () =>
        expect(autoFoldOnLeave({ ...left, foreground: "beside" })).toBe(false));
    it("leaves the window be when off, in Float, folded, minimized or hidden", () => {
        expect(autoFoldOnLeave({ ...left, on: false })).toBe(false);
        expect(autoFoldOnLeave({ ...left, size: "float" })).toBe(false);
        expect(autoFoldOnLeave({ ...left, size: "sprout" })).toBe(false);
        expect(autoFoldOnLeave({ ...left, minimized: true })).toBe(false);
        expect(autoFoldOnLeave({ ...left, visible: false })).toBe(false);
    });
    it("does not fold under arcterm's own dialog", () =>
        expect(autoFoldOnLeave({ ...left, foreground: "ours" })).toBe(false));

    const back = { autoFolded: true, size: "sprout" as const, pressGapMs: null, chatOpen: false };
    it("grows back when you return to a fold leaving made", () => {
        expect(autoRestoreOnReturn(back)).toBe(true);
        expect(autoRestoreOnReturn({ ...back, pressGapMs: -5000 })).toBe(true);
    });
    it("stays folded for a button's fold, outside the fold, or with the chat open", () => {
        expect(autoRestoreOnReturn({ ...back, autoFolded: false })).toBe(false);
        expect(autoRestoreOnReturn({ ...back, size: "full" })).toBe(false);
        expect(autoRestoreOnReturn({ ...back, chatOpen: true })).toBe(false);
    });
    it("stays folded when the focus came with a press on Sprout, before or after it", () => {
        expect(autoRestoreOnReturn({ ...back, pressGapMs: -40 })).toBe(false);
        expect(autoRestoreOnReturn({ ...back, pressGapMs: 120 })).toBe(false);
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
    it("folds from Full and Float, docks when asked, and gives the window back when folded", () => {
        expect(minimizeAction("sprout", "full")).toBe("fold");
        expect(minimizeAction("sprout", "float")).toBe("fold");
        expect(minimizeAction("dock", "full")).toBe("dock");
        expect(minimizeAction("dock", "float")).toBe("dock");
        expect(minimizeAction("sprout", "sprout")).toBe("restore");
        expect(minimizeAction("dock", "sprout")).toBe("restore");
    });
});

const viewport = { width: 1440, height: 875 };

describe("foldFade", () => {
    // faded as it shrinks, the content was gone before it reached Sprout, and the fold read as a blink
    it("holds the content solid while it shrinks and fades it only at the end", () => {
        const { opacity, times } = foldFade("sprout");
        expect(opacity).toEqual([1, 1, 0]);
        expect(times).toEqual([0, FOLD_FADE_FROM, 1]);
        expect(FOLD_FADE_FROM).toBeGreaterThanOrEqual(0.5);
    });
    it("plays the fold backwards on a restore", () => {
        const fold = foldFade("sprout");
        const back = foldFade("window");
        expect(back.opacity).toEqual([...fold.opacity].reverse());
        expect(back.times).toEqual(fold.times.map((t) => 1 - t).reverse());
    });
});

describe("sproutCenter", () => {
    const frame = { x: 100, y: 50 };
    it("grows the content out of Sprout's middle as the restored window sees it", () =>
        expect(sproutCenter({ x: 900, y: 800, width: 64, height: 64 }, frame, 1, viewport)).toEqual({
            x: 900 + 32 - 100,
            y: 800 + 32 - 50,
        }));
    it("turns Windows' physical pixels into CSS pixels", () =>
        expect(sproutCenter({ x: 1000, y: 600, width: 96, height: 96 }, { x: 0, y: 0 }, 1.5, viewport)).toEqual({
            x: 1048 / 1.5,
            y: 648 / 1.5,
        }));
    // dragged to another monitor while folded: the content still grows from inside the window
    it("pulls a Sprout dragged away from the window inside it", () =>
        expect(sproutCenter({ x: 4000, y: -300, width: 64, height: 64 }, frame, 1, viewport)).toEqual({
            x: viewport.width,
            y: 0,
        }));
    // a fold: Sprout lands in the screen's bottom-right corner, 24px in, above the Dock on a Mac
    const work = { x: 0, y: 25, width: 1440, height: 875 };
    it("folds a full-screen window's content into Sprout in the bottom-right corner", () =>
        expect(sproutCenter(miniSproutRect(null, work, 1), { x: 0, y: 25 }, 1, viewport)).toEqual({
            x: 1440 - 24 - 32,
            y: 875 - 24 - 32,
        }));
    it("folds a window away from the corner into its own bottom-right", () =>
        expect(sproutCenter(miniSproutRect(null, work, 1), { x: 0, y: 25 }, 1, { width: 800, height: 500 })).toEqual({
            x: 800,
            y: 500,
        }));
});
