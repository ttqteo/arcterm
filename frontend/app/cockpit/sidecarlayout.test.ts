// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { layoutFor, pinButtonChange, SMALL_BREAK_PX, smallAsks, smallButtonChange, smallKey } from "./sidecarlayout";
import type { SidecarTile } from "./sidecartypes";

function tile(id: string, over: Partial<SidecarTile> = {}): SidecarTile {
    return { id, name: id, runtime: "Claude", state: "working", messages: [], ...over };
}

function asking(id: string, since: number | undefined, options: string[] = ["Yes", "No"], over = {}): SidecarTile {
    const t = tile(id, {
        state: "asking",
        ask: { question: `Q ${id}?`, options, answerable: options.length > 0, key: `ask-${id}` },
        ...over,
    });
    if (since != null) {
        t.since = since;
    }
    return t;
}

describe("layoutFor", () => {
    it("the wall from 1100 px, the small form below it", () => {
        expect(SMALL_BREAK_PX).toBe(1100);
        expect(layoutFor(1099)).toBe("small");
        expect(layoutFor(1100)).toBe("wall");
    });

    it("the narrowest window and a wide screen land on their side", () => {
        expect(layoutFor(340)).toBe("small");
        expect(layoutFor(1920)).toBe("wall");
    });

    it("a window that fills a high-scale screen is the wall, whatever its CSS width", () => {
        // 1920 px at 175%: the screen and a maximized or full-screen window are both about 1097 CSS px
        expect(layoutFor(1097, 1097)).toBe("wall");
        expect(layoutFor(1085, 1097)).toBe("wall");
        // the same screen, the window dragged narrower: the small form
        expect(layoutFor(700, 1097)).toBe("small");
        expect(layoutFor(340, 1097)).toBe("small");
        // a screen that is not known reads as width alone
        expect(layoutFor(1097, 0)).toBe("small");
    });

    it("a window not measured yet (0 px) is the small form, not a crash", () => {
        expect(layoutFor(0)).toBe("small");
    });
});

describe("smallAsks", () => {
    it("keeps only the asking tiles", () => {
        const tiles = [tile("w"), asking("a", 10), tile("i", { state: "idle" }), tile("s", { state: "asleep" })];
        expect(smallAsks({ tiles }).map((t) => t.id)).toEqual(["a"]);
    });

    it("puts the oldest ask first (smallest since)", () => {
        const tiles = [asking("late", 300), asking("early", 100), asking("mid", 200)];
        expect(smallAsks({ tiles }).map((t) => t.id)).toEqual(["early", "mid", "late"]);
    });

    it("an ask with no since goes last, and equal sinces keep the snapshot's order", () => {
        const tiles = [asking("none", undefined), asking("b", 100), asking("a", 100), asking("c", 50)];
        expect(smallAsks({ tiles }).map((t) => t.id)).toEqual(["c", "b", "a", "none"]);
    });

    it("does not reorder the snapshot's own tiles", () => {
        const tiles = [asking("late", 300), asking("early", 100)];
        smallAsks({ tiles });
        expect(tiles.map((t) => t.id)).toEqual(["late", "early"]);
    });

    it("no asks, no cards", () => {
        expect(smallAsks({ tiles: [] })).toEqual([]);
        expect(smallAsks({ tiles: [tile("w")] })).toEqual([]);
    });
});

describe("smallKey", () => {
    const cards = [asking("a", 1, ["Yes", "No"]), asking("b", 2, ["One", "Two", "Three"]), asking("c", 3, [])];

    it("arrow down and up move the selection one card and clamp at the ends", () => {
        expect(smallKey("ArrowDown", cards, 0)).toEqual({ kind: "select", index: 1 });
        expect(smallKey("ArrowDown", cards, 2)).toEqual({ kind: "select", index: 2 });
        expect(smallKey("ArrowUp", cards, 2)).toEqual({ kind: "select", index: 1 });
        expect(smallKey("ArrowUp", cards, 0)).toEqual({ kind: "select", index: 0 });
    });

    it("left and right are not the small form's", () => {
        expect(smallKey("ArrowLeft", cards, 1)).toBeNull();
        expect(smallKey("ArrowRight", cards, 1)).toBeNull();
    });

    it("an arrow with nothing selected lands on the first card", () => {
        expect(smallKey("ArrowDown", cards, -1)).toEqual({ kind: "select", index: 0 });
        expect(smallKey("ArrowUp", cards, -1)).toEqual({ kind: "select", index: 0 });
    });

    it("1-9 answers the selected card's option, only when it has that option", () => {
        expect(smallKey("1", cards, 0)).toEqual({ kind: "answer", id: "a", option: 0, key: "ask-a" });
        expect(smallKey("2", cards, 0)).toEqual({ kind: "answer", id: "a", option: 1, key: "ask-a" });
        expect(smallKey("3", cards, 0)).toBeNull();
        expect(smallKey("3", cards, 1)).toEqual({ kind: "answer", id: "b", option: 2, key: "ask-b" });
        expect(smallKey("9", cards, 1)).toBeNull();
    });

    it("does not answer an ask the card cannot take, or one already sent", () => {
        expect(smallKey("1", cards, 2)).toBeNull();
        const sent = [asking("s", 1, ["Yes"], { sent: true })];
        expect(smallKey("1", sent, 0)).toBeNull();
        const notAnswerable = [asking("n", 1, ["Yes"])];
        notAnswerable[0].ask!.answerable = false;
        expect(smallKey("1", notAnswerable, 0)).toBeNull();
    });

    it("Enter opens the selected card, even one that cannot be answered here", () => {
        expect(smallKey("Enter", cards, 1)).toEqual({ kind: "open", id: "b" });
        expect(smallKey("Enter", cards, 2)).toEqual({ kind: "open", id: "c" });
    });

    it("keys act on nothing when no card is selected or there are none", () => {
        expect(smallKey("Enter", cards, -1)).toBeNull();
        expect(smallKey("1", cards, -1)).toBeNull();
        expect(smallKey("ArrowDown", [], -1)).toBeNull();
        expect(smallKey("Enter", [], 0)).toBeNull();
    });

    it("any other key is not the small form's", () => {
        expect(smallKey("a", cards, 0)).toBeNull();
        expect(smallKey("0", cards, 0)).toBeNull();
        expect(smallKey("F11", cards, 0)).toBeNull();
        expect(smallKey("Escape", cards, 0)).toBeNull();
    });
});

describe("the S and pin buttons' changes", () => {
    it("S asks for the other form and says nothing of the pin", () => {
        expect(smallButtonChange({ small: false, pinned: false })).toEqual({ small: true });
        expect(smallButtonChange({ small: true, pinned: true })).toEqual({ small: false });
    });

    it("the pin flips the pin alone, small or not", () => {
        expect(pinButtonChange({ small: true, pinned: true })).toEqual({ pinned: false });
        expect(pinButtonChange({ small: true, pinned: false })).toEqual({ pinned: true });
        expect(pinButtonChange({ small: false, pinned: false })).toEqual({ pinned: true });
    });
});
