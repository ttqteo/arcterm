// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { backFrom, boxLayer, dialogEdge, firstSel, officeKey, officeMenuItems, stepSel } from "./officecontrols";

describe("officeKey", () => {
    it("walks on the arrows and talks on Enter when nothing is up", () => {
        expect(officeKey("walk", false, "ArrowLeft")).toEqual({ do: "walk", dir: "left" });
        expect(officeKey("walk", false, "ArrowUp")).toEqual({ do: "walk", dir: "up" });
        expect(officeKey("walk", false, "Enter")).toEqual({ do: "talk" });
    });

    it("moves the ▶ on ↑ ↓, switches the question on ← →, and activates on Enter in the dialog box", () => {
        expect(officeKey("dialog", false, "ArrowUp")).toEqual({ do: "move", delta: -1 });
        expect(officeKey("dialog", false, "ArrowDown")).toEqual({ do: "move", delta: 1 });
        expect(officeKey("dialog", false, "ArrowLeft")).toEqual({ do: "tab", delta: -1 });
        expect(officeKey("dialog", false, "ArrowRight")).toEqual({ do: "tab", delta: 1 });
        expect(officeKey("dialog", false, "Enter")).toEqual({ do: "activate" });
    });

    it("walks away from the full card on the arrows and leaves Enter to the card", () => {
        expect(officeKey("card", false, "ArrowDown")).toEqual({ do: "walk", dir: "down" });
        expect(officeKey("card", false, "Enter")).toEqual({ do: "pass" });
    });

    it("steps back on Esc in every layer", () => {
        for (const layer of ["walk", "dialog", "card"] as const) {
            expect(officeKey(layer, false, "Escape")).toEqual({ do: "back" });
        }
    });

    it("keeps j k n f h l and m in every layer", () => {
        for (const layer of ["walk", "dialog", "card"] as const) {
            expect(officeKey(layer, false, "j")).toEqual({ do: "desk", delta: 1 });
            expect(officeKey(layer, false, "k")).toEqual({ do: "desk", delta: -1 });
            expect(officeKey(layer, false, "n")).toEqual({ do: "nextAsk" });
            expect(officeKey(layer, false, "f")).toEqual({ do: "card" });
            expect(officeKey(layer, false, "h")).toEqual({ do: "tab", delta: -1 });
            expect(officeKey(layer, false, "l")).toEqual({ do: "tab", delta: 1 });
            expect(officeKey(layer, false, "m")).toEqual({ do: "menu" });
        }
    });

    it("leaves the Cockpit's own keys to it", () => {
        for (const k of ["1", "9", "t", "r", "b", " "]) {
            expect(officeKey("walk", false, k)).toEqual({ do: "pass" });
            expect(officeKey("dialog", false, k)).toEqual({ do: "pass" });
            expect(officeKey("card", false, k)).toEqual({ do: "pass" });
        }
    });

    it("lets every chord through, the arrows, Enter and Esc too, and with the menu open", () => {
        expect(officeKey("walk", false, "f", { meta: true })).toEqual({ do: "pass" });
        expect(officeKey("dialog", false, "m", { ctrl: true })).toEqual({ do: "pass" });
        expect(officeKey("card", false, "j", { alt: true })).toEqual({ do: "pass" });
        expect(officeKey("walk", false, "ArrowLeft", { meta: true })).toEqual({ do: "pass" });
        expect(officeKey("dialog", false, "Enter", { alt: true })).toEqual({ do: "pass" });
        expect(officeKey("card", false, "Escape", { ctrl: true })).toEqual({ do: "pass" });
        expect(officeKey("walk", true, "ArrowDown", { meta: true })).toEqual({ do: "pass" });
    });

    it("gives every key to the open menu: ↑ ↓ move, Enter picks, Esc and m shut it, the rest do nothing", () => {
        expect(officeKey("dialog", true, "ArrowUp")).toEqual({ do: "move", delta: -1 });
        expect(officeKey("walk", true, "ArrowDown")).toEqual({ do: "move", delta: 1 });
        expect(officeKey("walk", true, "Enter")).toEqual({ do: "activate" });
        expect(officeKey("card", true, "Escape")).toEqual({ do: "menu" });
        expect(officeKey("walk", true, "m")).toEqual({ do: "menu" });
        for (const k of ["ArrowLeft", "ArrowRight", "1", "j", "f", "t"]) {
            expect(officeKey("walk", true, k)).toEqual({ do: "none" });
        }
    });
});

describe("backFrom", () => {
    it("steps the full card back to the dialog box and the box back to walking", () => {
        expect(backFrom("card")).toBe("dialog");
        expect(backFrom("dialog")).toBe("walk");
        expect(backFrom("walk")).toBe("walk");
    });
});

describe("boxLayer", () => {
    it("falls back to walking when the dialog layer has no box drawn", () => {
        expect(boxLayer("dialog", false)).toBe("walk");
    });

    it("keeps every other layer and a drawn box as they are", () => {
        expect(boxLayer("dialog", true)).toBe("dialog");
        expect(boxLayer("card", false)).toBe("card");
        expect(boxLayer("walk", true)).toBe("walk");
    });
});

describe("stepSel and firstSel", () => {
    const enabled = [true, true, false, true];

    it("steps over an item the ▶ cannot rest on", () => {
        expect(stepSel(1, 1, enabled)).toBe(3);
        expect(stepSel(3, -1, enabled)).toBe(1);
    });

    it("stays put at either end", () => {
        expect(stepSel(0, -1, enabled)).toBe(0);
        expect(stepSel(3, 1, enabled)).toBe(3);
        expect(stepSel(1, 1, [true, true, false])).toBe(1);
    });

    it("starts on the first item it can rest on, 0 when none", () => {
        expect(firstSel([false, true, true])).toBe(1);
        expect(firstSel([false, false])).toBe(0);
        expect(firstSel([])).toBe(0);
    });
});

describe("dialogEdge", () => {
    // an 800 px view: a box at the foot, its plate 15 px over it, reaches up to 800 - 12 - 270 - 15 = 503; a box at
    // the head reaches down to 66 + 270 = 336
    it("takes the foot while the boss stands clear above a box there", () => {
        expect(dialogEdge(400, 469, 800)).toBe("bottom");
        expect(dialogEdge(434, 503, 800)).toBe("bottom");
    });

    it("takes the head once a box at the foot would cover the boss", () => {
        expect(dialogEdge(436, 505, 800)).toBe("top");
        expect(dialogEdge(700, 769, 800)).toBe("top");
    });

    it("in a view too short for either, takes the edge farther from the boss", () => {
        // 500 px: the foot's box reaches up to 203, the head's down to 336
        expect(dialogEdge(150, 219, 500)).toBe("bottom");
        expect(dialogEdge(260, 329, 500)).toBe("top");
    });

    it("reads a shorter box's own height", () => {
        expect(dialogEdge(500, 569, 800, 150)).toBe("bottom");
    });
});

describe("officeMenuItems", () => {
    it("lists START's items with their keys, the desks asking and the events not seen", () => {
        const items = officeMenuItems(2, 3, false);
        expect(items.map((i) => i.label)).toEqual([
            "Next Needs you",
            "Next desk",
            "Previous desk",
            "Events",
            "Cards view",
            "All keys",
        ]);
        expect(items.map((i) => i.key)).toEqual(["n", "j", "k", undefined, "o", "?"]);
        expect(items[0]).toMatchObject({ count: "2", ask: true });
        expect(items[3]).toMatchObject({ count: "3 new", rule: true });
    });

    it("drops a zero count, and names Events Hide events while the rail is open", () => {
        const items = officeMenuItems(0, 0, false);
        expect(items[0].count).toBeUndefined();
        expect(items[3].count).toBeUndefined();
        const open = officeMenuItems(1, 4, true);
        expect(open[3]).toMatchObject({ id: "events", label: "Hide events", count: undefined });
    });
});
