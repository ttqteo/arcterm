// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isTextKey, keyTipLabel } from "./keytipmodel";

describe("isTextKey", () => {
    it("is a character typed bare or with Shift", () => {
        for (const k of ["d", "f", "/", "[", "Shift:f", "Shift:n", "Space", "Shift:Space"]) {
            expect(isTextKey(k), k).toBe(true);
        }
    });

    it("is not a chord, a named key or a leader sequence", () => {
        for (const k of ["Alt:d", "Mod:Shift:k", "Ctrl:Tab", "Escape", "ArrowDown", "Tab", "Enter", "F11", "g c", ""]) {
            expect(isTextKey(k), k).toBe(false);
        }
    });
});

describe("keyTipLabel", () => {
    it("shows an Alt chord's key, upper case, Shift as ⇧", () => {
        expect(keyTipLabel("Alt:k")).toBe("K");
        expect(keyTipLabel("Alt:Shift:f")).toBe("⇧F");
        expect(keyTipLabel("Alt:1")).toBe("1");
    });

    it("has none for a key that is not an Alt chord of one character", () => {
        for (const k of ["d", "Mod:Shift:k", "Alt:ArrowUp", "Ctrl:Alt:r", "g c"]) {
            expect(keyTipLabel(k), k).toBeNull();
        }
    });
});
