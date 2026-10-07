import { afterEach, describe, expect, it } from "vitest";
import { checkKeyPressed } from "./keyutil";
import { setPlatform } from "./platformutil";

// A WaveKeyboardEvent as adaptFromReactOrNativeKeyEvent builds it (keyutil's own platform is darwin, so cmd is the
// meta key and option the alt key on every platform).
function ev(key: string, code: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) {
    return {
        control: !!mods.ctrl,
        shift: !!mods.shift,
        cmd: !!mods.meta,
        option: !!mods.alt,
        meta: !!mods.meta,
        alt: !!mods.alt,
        key,
        code,
        location: 0,
        repeat: false,
        type: "keydown",
    } as WaveKeyboardEvent;
}

afterEach(() => setPlatform("darwin"));

describe("Mod", () => {
    it("is the Command key on macOS", () => {
        setPlatform("darwin");
        expect(checkKeyPressed(ev("p", "KeyP", { meta: true }), "Mod:p")).toBe(true);
        expect(checkKeyPressed(ev("p", "KeyP", { ctrl: true }), "Mod:p")).toBe(false);
        expect(checkKeyPressed(ev("R", "KeyR", { meta: true, shift: true }), "Mod:Shift:r")).toBe(true);
    });

    it("is the Control key on Windows", () => {
        setPlatform("win32");
        expect(checkKeyPressed(ev("p", "KeyP", { ctrl: true }), "Mod:p")).toBe(true);
        expect(checkKeyPressed(ev("p", "KeyP", { meta: true }), "Mod:p")).toBe(false);
        expect(checkKeyPressed(ev("Enter", "Enter", { ctrl: true }), "Mod:Enter")).toBe(true);
    });

    it("matches a code descriptor", () => {
        setPlatform("darwin");
        expect(checkKeyPressed(ev("\\", "Backslash", { meta: true }), "Mod:c{Backslash}")).toBe(true);
    });
});

// Option+letter on a Mac types a character (⌥Z is "Ω", ⌥T is "†") or opens a dead key (⌥E), so the key never
// reads as the letter the binding names.
describe("Alt+letter on macOS", () => {
    it("matches by the physical key", () => {
        setPlatform("darwin");
        expect(checkKeyPressed(ev("Ω", "KeyZ", { alt: true }), "Alt:z")).toBe(true);
        expect(checkKeyPressed(ev("†", "KeyT", { alt: true }), "Alt:t")).toBe(true);
        expect(checkKeyPressed(ev("Dead", "KeyE", { alt: true }), "Alt:e")).toBe(true);
        expect(checkKeyPressed(ev("¡", "Digit1", { alt: true }), "Alt:1")).toBe(true);
    });

    it("still needs the modifier and the right key", () => {
        setPlatform("darwin");
        expect(checkKeyPressed(ev("Ω", "KeyZ", { alt: true }), "Alt:t")).toBe(false);
        expect(checkKeyPressed(ev("z", "KeyZ"), "Alt:z")).toBe(false);
        expect(checkKeyPressed(ev("ArrowUp", "ArrowUp", { alt: true }), "Alt:ArrowUp")).toBe(true);
    });

    it("is unchanged on Windows, where Alt+letter reads as the letter", () => {
        setPlatform("win32");
        expect(checkKeyPressed(ev("z", "KeyZ", { alt: true }), "Alt:z")).toBe(true);
        expect(checkKeyPressed(ev("Ω", "KeyZ", { alt: true }), "Alt:z")).toBe(false);
    });
});
