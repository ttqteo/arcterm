// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    backFrom,
    boxLayer,
    canBuildFloor,
    carryPlace,
    carryTarget,
    dialogEdge,
    firstSel,
    isMenuShortcut,
    officeKey,
    officeKeyName,
    officeMenuItems,
    stepSel,
} from "./officecontrols";

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

    it("reads Space as ↵, the A button, in every layer", () => {
        expect(officeKeyName(" ")).toBe("Enter");
        expect(officeKeyName("Enter")).toBe("Enter");
        expect(officeKeyName("Escape")).toBe("Escape");
        expect(officeKey("walk", false, officeKeyName(" "))).toEqual({ do: "talk" });
        expect(officeKey("dialog", false, officeKeyName(" "))).toEqual({ do: "activate" });
        expect(officeKey("dialog", true, officeKeyName(" "))).toEqual({ do: "activate" });
        expect(officeKey("carry", false, officeKeyName(" "))).toEqual({ do: "drop" });
        // the full card leaves it to the Cockpit's Enter
        expect(officeKey("card", false, officeKeyName(" "))).toEqual({ do: "pass" });
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
        for (const k of ["ArrowLeft", "ArrowRight", "1", "j", "f", "t", "g", "PageUp", "PageDown"]) {
            expect(officeKey("walk", true, k)).toEqual({ do: "none" });
        }
    });

    it("mutes on s, except while the menu takes every key", () => {
        expect(officeKey("walk", false, "s")).toEqual({ do: "sound" });
        expect(officeKey("dialog", false, "s")).toEqual({ do: "sound" });
        expect(officeKey("walk", true, "s")).toEqual({ do: "none" });
        expect(officeKey("walk", false, "s", { ctrl: true })).toEqual({ do: "pass" });
    });

    it("rides the lift on PageUp and PageDown, and carries a room on g, while walking", () => {
        expect(officeKey("walk", false, "PageUp")).toEqual({ do: "floor", delta: 1 });
        expect(officeKey("walk", false, "PageDown")).toEqual({ do: "floor", delta: -1 });
        expect(officeKey("walk", false, "g")).toEqual({ do: "grab" });
    });

    it("leaves PageUp, PageDown and g alone over the dialog box and the full card", () => {
        for (const layer of ["dialog", "card"] as const) {
            for (const k of ["PageUp", "PageDown", "g"]) {
                expect(officeKey(layer, false, k)).toEqual({ do: "pass" });
            }
        }
    });

    it("lets a chord through on the lift and carry keys", () => {
        expect(officeKey("walk", false, "PageUp", { ctrl: true })).toEqual({ do: "pass" });
        expect(officeKey("walk", false, "g", { meta: true })).toEqual({ do: "pass" });
        expect(officeKey("carry", false, "Enter", { alt: true })).toEqual({ do: "pass" });
        expect(officeKey("carry", false, "ArrowLeft", { ctrl: true })).toEqual({ do: "pass" });
    });
});

describe("officeKey while a room is carried", () => {
    it("moves the room to a neighbouring slot on the arrows", () => {
        expect(officeKey("carry", false, "ArrowUp")).toEqual({ do: "slot", dir: "up" });
        expect(officeKey("carry", false, "ArrowDown")).toEqual({ do: "slot", dir: "down" });
        expect(officeKey("carry", false, "ArrowLeft")).toEqual({ do: "slot", dir: "left" });
        expect(officeKey("carry", false, "ArrowRight")).toEqual({ do: "slot", dir: "right" });
    });

    it("rides the lift with the room on PageUp and PageDown", () => {
        expect(officeKey("carry", false, "PageUp")).toEqual({ do: "floor", delta: 1 });
        expect(officeKey("carry", false, "PageDown")).toEqual({ do: "floor", delta: -1 });
    });

    it("drops the room on Enter and cancels on Esc and g", () => {
        expect(officeKey("carry", false, "Enter")).toEqual({ do: "drop" });
        expect(officeKey("carry", false, "Escape")).toEqual({ do: "cancel" });
        expect(officeKey("carry", false, "g")).toEqual({ do: "cancel" });
    });

    it("does nothing on any other key, the office's own and the Cockpit's included", () => {
        for (const k of ["m", "j", "k", "n", "f", "h", "l", "1", "t", "r", " "]) {
            expect(officeKey("carry", false, k)).toEqual({ do: "none" });
        }
    });

    it("takes its keys before the menu, which cannot be open over a carried room", () => {
        expect(officeKey("carry", true, "Enter")).toEqual({ do: "drop" });
        expect(officeKey("carry", true, "m")).toEqual({ do: "none" });
    });
});

describe("backFrom", () => {
    it("steps the full card back to the dialog box and the box back to walking", () => {
        expect(backFrom("card")).toBe("dialog");
        expect(backFrom("dialog")).toBe("walk");
        expect(backFrom("walk")).toBe("walk");
    });

    it("sets a carried room down and walks on", () => {
        expect(backFrom("carry")).toBe("walk");
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
        expect(boxLayer("carry", false)).toBe("carry");
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
    it("lists START's items with their keys, the desks asking, the board's rows and the events not seen", () => {
        const items = officeMenuItems(2, 3, false, 3, true);
        expect(items.map((i) => i.label)).toEqual([
            "Next Needs you",
            "Notice board",
            "Next desk",
            "Previous desk",
            "Lift",
            "Move this room",
            "Arrange automatically",
            "Events",
            "Mute sound",
            "Cards view",
            "All keys",
        ]);
        expect(items.map((i) => i.key)).toEqual([
            "n",
            undefined,
            "j",
            "k",
            "PgUp PgDn",
            "g",
            undefined,
            undefined,
            "s",
            "o",
            "?",
        ]);
        expect(items[0]).toMatchObject({ count: "2", ask: true });
        expect(items[1]).toEqual({ id: "needsYou", label: "Notice board", count: "3", ask: true });
        expect(items[7]).toMatchObject({ count: "3 new", rule: true });
    });

    it("puts the lift, the room carry and the automatic arrangement after the desk items", () => {
        const items = officeMenuItems(0, 0, false, 0, true);
        expect(items.slice(2, 7).map((i) => i.id)).toEqual(["nextDesk", "prevDesk", "lift", "move", "arrange"]);
        expect(items[4]).toEqual({ id: "lift", label: "Lift", key: "PgUp PgDn" });
        expect(items[5]).toEqual({ id: "move", label: "Move this room", key: "g" });
        expect(items[6]).toEqual({ id: "arrange", label: "Arrange automatically" });
    });

    it("drops a zero count, and names Events Hide events while the rail is open", () => {
        const items = officeMenuItems(0, 0, false, 0, true);
        expect(items[0].count).toBeUndefined();
        expect(items[1]).toMatchObject({ id: "needsYou", count: undefined });
        expect(items[7].count).toBeUndefined();
        const open = officeMenuItems(1, 4, true, 1, true);
        expect(open[7]).toMatchObject({ id: "events", label: "Hide events", count: undefined });
    });
});

describe("isMenuShortcut", () => {
    it("is each key the office menu names beside an item, as KeyboardEvent.key spells it", () => {
        for (const k of ["n", "j", "k", "PageUp", "PageDown", "g", "s", "o", "?"]) {
            expect(isMenuShortcut(k)).toBe(true);
        }
    });
    it("is no key the menu leaves unnamed, and no chord", () => {
        for (const k of ["f", "t", "1", "h", "ArrowLeft", "Enter", "m", "Escape", "PgUp"]) {
            expect(isMenuShortcut(k)).toBe(false);
        }
        expect(isMenuShortcut("s", { meta: true })).toBe(false);
        expect(isMenuShortcut("j", { ctrl: true })).toBe(false);
    });
});

describe("officeMenuItems' Background", () => {
    it("leaves Background out while no agent is in the background and it is hidden", () => {
        expect(officeMenuItems(0, 0, false, 0, true).some((i) => i.id === "background")).toBe(false);
    });

    it("lists Background with its count after Events, and Hide background while shown", () => {
        const items = officeMenuItems(0, 0, false, 0, true, 2, false);
        const at = items.findIndex((i) => i.id === "background");
        expect(items[at - 1].id).toBe("events");
        expect(items[at]).toEqual({ id: "background", label: "Background", count: "2" });
        const open = officeMenuItems(0, 0, false, 0, true, 2, true);
        expect(open.find((i) => i.id === "background")).toEqual({
            id: "background",
            label: "Hide background",
            count: undefined,
        });
    });

    it("keeps Hide background while shown after the last one left", () => {
        expect(officeMenuItems(0, 0, false, 0, true, 0, true).find((i) => i.id === "background")?.label).toBe(
            "Hide background"
        );
    });
});

describe("officeMenuItems' sound item", () => {
    it("names the sound item by what it will do, after Background and before Cards view", () => {
        expect(officeMenuItems(0, 0, false, 0, true, 0, false, false).find((i) => i.id === "sound")?.label).toBe(
            "Mute sound"
        );
        expect(officeMenuItems(0, 0, false, 0, true, 0, false, true).find((i) => i.id === "sound")?.label).toBe(
            "Sound on"
        );
        const ids = officeMenuItems(0, 0, false, 0, true, 2, false).map((i) => i.id);
        expect(ids.slice(ids.indexOf("events"))).toEqual(["events", "background", "sound", "cards", "keys"]);
    });
});

describe("officeMenuItems outside a room", () => {
    it("disables Move this room, and only it, when the boss is in no project room", () => {
        const items = officeMenuItems(0, 0, false, 0, false);
        expect(items.filter((i) => i.disabled).map((i) => i.id)).toEqual(["move"]);
        expect(items[5]).toEqual({ id: "move", label: "Move this room", key: "g", disabled: true });
    });

    it("leaves every item enabled in a project room", () => {
        expect(officeMenuItems(0, 0, false, 0, true).some((i) => i.disabled)).toBe(false);
    });
});

describe("carrying a room", () => {
    // floor 0 holds four rooms, floor 1 two, floor 2 one
    const floors = [
        { floor: 0, rooms: ["a", "b", "c", "d"] },
        { floor: 1, rooms: ["e", "f"] },
        { floor: 2, rooms: ["g"] },
    ];
    const ctx = { floors, project: "e", fromSlot: 1 };
    const slot = (dir: "up" | "down" | "left" | "right") => ({ do: "slot", dir }) as const;
    const floor = (delta: -1 | 1) => ({ do: "floor", delta }) as const;

    it("steps the target over the slots of the floor shown, and stops at an edge", () => {
        expect(carryTarget({ floor: 1, slot: 1 }, slot("down"), ctx)).toEqual({ floor: 1, slot: 3 });
        expect(carryTarget({ floor: 1, slot: 1 }, slot("left"), ctx)).toEqual({ floor: 1, slot: 0 });
        expect(carryTarget({ floor: 1, slot: 1 }, slot("right"), ctx)).toEqual({ floor: 1, slot: 1 });
        expect(carryTarget({ floor: 1, slot: 1 }, slot("up"), ctx)).toEqual({ floor: 1, slot: 1 });
    });

    it("keeps the slot when it rides to the next floor that holds a room", () => {
        expect(carryTarget({ floor: 1, slot: 3 }, floor(1), ctx)).toEqual({ floor: 2, slot: 3 });
        expect(carryTarget({ floor: 1, slot: 3 }, floor(-1), ctx)).toEqual({ floor: 0, slot: 3 });
    });

    it("skips a floor that holds no room", () => {
        const gap = { ...ctx, floors: [floors[0], floors[2]] };
        expect(carryTarget({ floor: 0, slot: 0 }, floor(1), gap)).toEqual({ floor: 2, slot: 0 });
        expect(carryTarget({ floor: 2, slot: 0 }, floor(-1), gap)).toEqual({ floor: 0, slot: 0 });
    });

    it("stays on the ground floor on PageDown", () => {
        expect(carryTarget({ floor: 0, slot: 2 }, floor(-1), ctx)).toEqual({ floor: 0, slot: 2 });
    });

    it("targets a new floor past the top one, and comes back to the top floor in the slot it left", () => {
        expect(carryTarget({ floor: 2, slot: 3 }, floor(1), ctx)).toBe("new");
        expect(carryTarget("new", floor(1), ctx)).toBe("new");
        expect(carryTarget("new", floor(-1), ctx)).toEqual({ floor: 2, slot: 1 });
    });

    it("leaves the arrows without effect on a new floor", () => {
        expect(carryTarget("new", slot("down"), ctx)).toBe("new");
    });

    it("builds no new floor for the only room of the top floor", () => {
        expect(canBuildFloor(floors, "g")).toBe(false);
        expect(canBuildFloor(floors, "e")).toBe(true);
        expect(canBuildFloor([], "e")).toBe(false);
        expect(carryTarget({ floor: 2, slot: 0 }, floor(1), { ...ctx, project: "g" })).toEqual({ floor: 2, slot: 0 });
    });

    it("drops on the target, or for a new floor on the first slot of the floor above the top", () => {
        const at = { a: { floor: 0, slot: 0 }, e: { floor: 1, slot: 1 }, g: { floor: 2, slot: 0 } };
        expect(carryPlace({ floor: 1, slot: 3 }, at)).toEqual({ floor: 1, slot: 3 });
        expect(carryPlace("new", at)).toEqual({ floor: 3, slot: 0 });
    });
});
