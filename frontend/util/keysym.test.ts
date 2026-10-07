import { describe, expect, it } from "vitest";
import { setPlatform } from "./platformutil";
import { formatChord, formatChordString, modSymbol } from "./keysym";

describe("keysym", () => {
    it("modifiers are spelled out on Windows", () => {
        setPlatform("win32");
        expect(modSymbol("Ctrl")).toBe("ctrl");
        expect(modSymbol("Cmd")).toBe("ctrl");
        expect(modSymbol("Shift")).toBe("shift");
        expect(modSymbol("Alt")).toBe("alt");
    });
    // "Ctrl" bindings fire on the Control key on every platform (keyutil), so a Mac shows ⌃, not ⌘
    it("Ctrl is ⌃ and Cmd is ⌘ on macOS", () => {
        setPlatform("darwin");
        expect(modSymbol("Ctrl")).toBe("⌃");
        expect(modSymbol("Cmd")).toBe("⌘");
        expect(modSymbol("Option")).toBe("⌥");
        expect(modSymbol("Shift")).toBe("⇧");
        expect(formatChordString("Cmd:Shift:p")).toBe("⌘⇧P");
    });
    // Mod is the platform's primary modifier: Command on a Mac, Control elsewhere (keyutil)
    it("Mod is ⌘ on macOS and ctrl on Windows", () => {
        setPlatform("darwin");
        expect(formatChordString("Mod:Shift:r")).toBe("⌘⇧R");
        setPlatform("win32");
        expect(formatChordString("Mod:Shift:r")).toBe("ctrl+shift+r");
    });
    it("formats modifier chords in lower case on Windows", () => {
        setPlatform("win32");
        expect(formatChord("Ctrl:p")).toEqual(["ctrl", "p"]);
        expect(formatChord("Ctrl:Shift:Tab")).toEqual(["ctrl", "shift", "tab"]);
        expect(formatChord("Shift:Escape")).toEqual(["shift", "esc"]);
        expect(formatChordString("Ctrl:Shift:p")).toBe("ctrl+shift+p");
        expect(formatChordString("Cmd:Enter")).toBe("ctrl+⏎");
    });
    it("keeps leader-chord keys as typed (no upper-casing)", () => {
        setPlatform("win32");
        expect(formatChord("g p")).toEqual(["g", "p"]);
        expect(formatChordString("g p")).toBe("g p");
    });
    it("names several chords together, one part each", () => {
        setPlatform("win32");
        expect(formatChordString("Shift:n Shift:p")).toBe("shift+n shift+p");
    });
    it("maps named keys", () => {
        setPlatform("win32");
        expect(modSymbol("Enter")).toBe("⏎");
        expect(modSymbol("ArrowUp")).toBe("↑");
        expect(modSymbol("Escape")).toBe("esc");
    });
});
