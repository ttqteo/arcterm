// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { multiCharTextKey } from "./termtextkey";

const keydown = (key: string, mods: Partial<KeyboardEvent> = {}) =>
    ({ type: "keydown", key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods }) as KeyboardEvent;

describe("multiCharTextKey", () => {
    it("takes the whole replacement an input method posts as one key", () => {
        expect(multiCharTextKey(keydown("ặc"))).toBe("ặc");
        expect(multiCharTextKey(keydown("ịnh"))).toBe("ịnh");
        expect(multiCharTextKey(keydown("Ươ"))).toBe("Ươ");
    });

    it("leaves a single character to xterm", () => {
        expect(multiCharTextKey(keydown("a"))).toBeNull();
        expect(multiCharTextKey(keydown("ặ"))).toBeNull();
    });

    it("leaves named keys alone", () => {
        for (const key of ["Enter", "Backspace", "ArrowLeft", "F12", "Dead", "Unidentified", "Process"]) {
            expect(multiCharTextKey(keydown(key))).toBeNull();
        }
    });

    it("leaves chords, composition and other event types alone", () => {
        expect(multiCharTextKey(keydown("ặc", { ctrlKey: true }))).toBeNull();
        expect(multiCharTextKey(keydown("ặc", { metaKey: true }))).toBeNull();
        expect(multiCharTextKey(keydown("ặc", { isComposing: true }))).toBeNull();
        expect(multiCharTextKey({ ...keydown("ặc"), type: "keypress" } as KeyboardEvent)).toBeNull();
    });
});
