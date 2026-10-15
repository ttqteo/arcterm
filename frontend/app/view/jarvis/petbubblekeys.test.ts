// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { keyPutsBubbleAway } from "./petbubblekeys";

const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
    key: k,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
});

describe("keyPutsBubbleAway", () => {
    it("puts the bubble away on a typed key", () => {
        for (const k of ["a", "A", " ", "Enter", "Backspace", "ArrowUp", "Escape", "Tab", "Process"]) {
            expect(keyPutsBubbleAway(key(k), false)).toBe(true);
        }
    });

    it("leaves it on a bare modifier, held for a hint or a chord", () => {
        for (const k of ["Shift", "Meta", "Control", "Alt", "CapsLock"]) {
            expect(keyPutsBubbleAway(key(k), false)).toBe(false);
        }
    });

    it("leaves it on a shortcut, which may read the bubble (⌘J lands on its question)", () => {
        expect(keyPutsBubbleAway(key("j", { metaKey: true }), false)).toBe(false);
        expect(keyPutsBubbleAway(key("j", { ctrlKey: true }), false)).toBe(false);
    });

    it("leaves it on a key pressed on the bubble itself", () => {
        expect(keyPutsBubbleAway(key("Enter"), true)).toBe(false);
    });
});
