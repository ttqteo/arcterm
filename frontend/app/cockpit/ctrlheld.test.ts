// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPeekGesture, nextCtrlHeld, peekClickLabel } from "./ctrlheld";

describe("nextCtrlHeld", () => {
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("Control down sets the flag and Control up clears it", () => {
        expect(nextCtrlHeld(false, { type: "keydown", key: "Control" })).toBe(true);
        expect(nextCtrlHeld(true, { type: "keyup", key: "Control" })).toBe(false);
    });

    it("a blur clears it, so Alt+Tab with Ctrl held leaves nothing underlined", () => {
        expect(nextCtrlHeld(true, { type: "blur" })).toBe(false);
        expect(nextCtrlHeld(false, { type: "blur" })).toBe(false);
    });

    it("other keys leave it as it was", () => {
        for (const held of [true, false]) {
            expect(nextCtrlHeld(held, { type: "keydown", key: "p" })).toBe(held);
            expect(nextCtrlHeld(held, { type: "keyup", key: "Shift" })).toBe(held);
        }
    });
});

// Control+click is a Mac's right click, so there the peek key is Command
describe("the peek key on macOS", () => {
    beforeEach(() => setPlatform("darwin"));

    it("Command down sets the flag and Command up clears it; Control leaves it", () => {
        expect(nextCtrlHeld(false, { type: "keydown", key: "Meta" })).toBe(true);
        expect(nextCtrlHeld(true, { type: "keyup", key: "Meta" })).toBe(false);
        expect(nextCtrlHeld(false, { type: "keydown", key: "Control" })).toBe(false);
    });

    it("a Command+click peeks and a Control+click does not", () => {
        expect(isPeekGesture({ ctrlKey: false, metaKey: true })).toBe(true);
        expect(isPeekGesture({ ctrlKey: true, metaKey: false })).toBe(false);
        expect(peekClickLabel()).toBe("⌘-click");
    });
});

describe("isPeekGesture on Windows", () => {
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("is a Ctrl+click, and nothing without a click", () => {
        expect(isPeekGesture({ ctrlKey: true })).toBe(true);
        expect(isPeekGesture({ ctrlKey: false, metaKey: true })).toBe(false);
        expect(isPeekGesture(undefined)).toBe(false);
        expect(peekClickLabel()).toBe("ctrl+click");
    });
});
