// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    EMPTY_LAYOUT,
    floorLabel,
    floorsShown,
    moveToFloor,
    newFloor,
    parseLayout,
    placeRooms,
    stepSlot,
    swapRooms,
} from "./officelayout";

const P = ["Home", "arcterm", "cuscofi", "mit", "vnstock"];

describe("parseLayout", () => {
    it("falls back to empty on junk", () => {
        expect(parseLayout(null)).toEqual(EMPTY_LAYOUT);
        expect(parseLayout("x")).toEqual(EMPTY_LAYOUT);
        expect(parseLayout({ v: 2, rooms: {} })).toEqual(EMPTY_LAYOUT);
    });
    it("drops entries that are not a floor and a slot", () => {
        const l = parseLayout({
            v: 1,
            rooms: { a: { floor: 1, slot: 2 }, b: { floor: -1, slot: 0 }, c: { floor: 0, slot: 4 }, d: "x" },
        });
        expect(l.rooms).toEqual({ a: { floor: 1, slot: 2 } });
    });
});

describe("placeRooms", () => {
    it("arranges in the given order, four to a floor, from G up", () => {
        const { at } = placeRooms(EMPTY_LAYOUT, P);
        expect(at.Home).toEqual({ floor: 0, slot: 0 });
        expect(at.mit).toEqual({ floor: 0, slot: 3 });
        expect(at.vnstock).toEqual({ floor: 1, slot: 0 });
    });
    it("keeps a saved place and saves a newcomer's", () => {
        const saved = { v: 1 as const, rooms: { vnstock: { floor: 0, slot: 0 } } };
        const { at, layout } = placeRooms(saved, ["Home", "vnstock"]);
        expect(at.vnstock).toEqual({ floor: 0, slot: 0 });
        expect(at.Home).toEqual({ floor: 0, slot: 1 });
        expect(layout.rooms.Home).toEqual({ floor: 0, slot: 1 });
    });
    it("frees an absent project's slot and returns it there when still empty", () => {
        const saved = placeRooms(EMPTY_LAYOUT, ["a", "b"]).layout;
        const gone = placeRooms(saved, ["b", "c"]);
        expect(gone.at.c).toEqual({ floor: 0, slot: 0 });
        const back = placeRooms({ ...saved, rooms: { ...saved.rooms, c: { floor: 0, slot: 2 } } }, ["a", "b", "c"]);
        expect(back.at.a).toEqual({ floor: 0, slot: 0 });
    });
    it("sends a returning project to the first empty slot when its own is taken", () => {
        const saved = { v: 1 as const, rooms: { a: { floor: 0, slot: 0 }, c: { floor: 0, slot: 0 } } };
        const { at, layout } = placeRooms(saved, ["a", "c"]);
        expect(at.a).toEqual({ floor: 0, slot: 0 });
        expect(at.c).toEqual({ floor: 0, slot: 1 });
        expect(layout.rooms.c).toEqual({ floor: 0, slot: 1 });
    });
});

describe("moves", () => {
    const { layout, at } = placeRooms(EMPTY_LAYOUT, P);
    it("swaps two rooms", () => {
        const l = swapRooms(layout, at, "arcterm", { floor: 0, slot: 3 });
        expect(l.rooms.arcterm).toEqual({ floor: 0, slot: 3 });
        expect(l.rooms.mit).toEqual({ floor: 0, slot: 1 });
    });
    it("moves into an empty slot", () => {
        const l = swapRooms(layout, at, "arcterm", { floor: 1, slot: 2 });
        expect(l.rooms.arcterm).toEqual({ floor: 1, slot: 2 });
        expect(l.rooms.mit).toEqual({ floor: 0, slot: 3 });
    });
    it("moves to a floor's first empty slot, refusing a full floor", () => {
        expect(moveToFloor(layout, at, "vnstock", 0)).toBeNull();
        expect(moveToFloor(layout, at, "arcterm", 1)!.rooms.arcterm).toEqual({ floor: 1, slot: 1 });
    });
    it("builds the floor over the top one", () => {
        expect(newFloor(at)).toBe(2);
    });
    it("shows the floors with a room, G when none", () => {
        expect(floorsShown(at)).toEqual([0, 1]);
        expect(floorsShown({})).toEqual([0]);
    });
    it("steps a slot on the 2 × 2 grid, staying put at an edge", () => {
        expect(stepSlot(0, "right")).toBe(1);
        expect(stepSlot(0, "down")).toBe(2);
        expect(stepSlot(3, "right")).toBe(3);
        expect(stepSlot(3, "up")).toBe(1);
    });
    it("names floors G, 1, 2", () => {
        expect([0, 1, 2].map(floorLabel)).toEqual(["G", "1", "2"]);
    });
});
