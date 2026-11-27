// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { describe, expect, it } from "vitest";
import { setSlotPick, slotPicksAtom } from "./protostore";

const read = (key: string) => globalStore.get(slotPicksAtom(key));

describe("slot picks", () => {
    it("start empty for a board nobody picked on", () => {
        expect(read("http://127.0.0.1:1/untouched/project/Main.dc.html")).toEqual({});
    });

    it("keep each slot's letter and leave the other slots alone", () => {
        const key = "http://127.0.0.1:1/two-slots/project/Main.dc.html";
        setSlotPick(key, "list", "B");
        setSlotPick(key, "menu", "C");
        expect(read(key)).toEqual({ list: "B", menu: "C" });
        setSlotPick(key, "list", "A");
        expect(read(key)).toEqual({ list: "A", menu: "C" });
    });

    it("belong to one board: another board's picks do not move", () => {
        const a = "http://127.0.0.1:1/board-a/project/Main.dc.html";
        const b = "http://127.0.0.1:1/board-b/project/Main.dc.html";
        setSlotPick(a, "list", "B");
        expect(read(b)).toEqual({});
    });

    it("are shared by whoever reads the same key", () => {
        const key = "http://127.0.0.1:1/shared/project/Main.dc.html";
        setSlotPick(key, "list", "C");
        expect(globalStore.get(slotPicksAtom(key))).toBe(read(key));
        expect(read(key).list).toBe("C");
    });

    it("do not notify when the same letter is picked again", () => {
        const key = "http://127.0.0.1:1/same-letter/project/Main.dc.html";
        setSlotPick(key, "list", "B");
        const before = read(key);
        setSlotPick(key, "list", "B");
        expect(read(key)).toBe(before);
    });
});
