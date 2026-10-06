import { describe, expect, it } from "vitest";
import { setPlatform } from "./platformutil";
import { formatChord, formatChordString, modSymbol } from "./keysym";

describe("keysym", () => {
    it("primary accelerator is ^ on Windows", () => {
        setPlatform("win32");
        expect(modSymbol("Ctrl")).toBe("^");
        expect(modSymbol("Cmd")).toBe("^");
        expect(modSymbol("Shift")).toBe("⇧");
        expect(modSymbol("Alt")).toBe("Alt");
    });
    // "Ctrl" bindings fire on the Control key on every platform (keyutil), so a Mac shows ⌃, not ⌘
    it("Ctrl is ⌃ and Cmd is ⌘ on macOS", () => {
        setPlatform("darwin");
        expect(modSymbol("Ctrl")).toBe("⌃");
        expect(modSymbol("Cmd")).toBe("⌘");
        expect(modSymbol("Option")).toBe("⌥");
    });
    it("formats modifier chords, upper-casing the final letter key", () => {
        setPlatform("win32");
        expect(formatChord("Ctrl:p")).toEqual(["^", "P"]);
        expect(formatChord("Ctrl:Shift:Tab")).toEqual(["^", "⇧", "Tab"]);
        expect(formatChord("Shift:Escape")).toEqual(["⇧", "esc"]);
        expect(formatChordString("Cmd:Enter")).toBe("^⏎");
    });
    it("keeps leader-chord keys as typed (no upper-casing)", () => {
        setPlatform("win32");
        expect(formatChord("g p")).toEqual(["g", "p"]);
    });
    it("maps named keys", () => {
        setPlatform("win32");
        expect(modSymbol("Enter")).toBe("⏎");
        expect(modSymbol("ArrowUp")).toBe("↑");
        expect(modSymbol("Escape")).toBe("esc");
    });
});
