import { describe, expect, it } from "vitest";
import { fillKeys, formatChord, formatChordString, modSymbol } from "./keysym";
import { setPlatform } from "./platformutil";

describe("keysym", () => {
    it("modifiers are spelled out on Windows", () => {
        setPlatform("win32");
        expect(modSymbol("Ctrl")).toBe("Ctrl");
        expect(modSymbol("Cmd")).toBe("Ctrl");
        expect(modSymbol("Shift")).toBe("Shift");
        expect(modSymbol("Alt")).toBe("Alt");
    });
    // "Ctrl" bindings fire on the Control key on every platform (keyutil), so a Mac shows ⌃, not ⌘
    it("Ctrl is ⌃ and Cmd is ⌘ on macOS", () => {
        setPlatform("darwin");
        expect(modSymbol("Ctrl")).toBe("⌃");
        expect(modSymbol("Cmd")).toBe("⌘");
        expect(modSymbol("Option")).toBe("⌥");
        expect(modSymbol("Shift")).toBe("⇧");
        expect(formatChordString("Cmd:Shift:p")).toBe("⌘⇧P");
        expect(formatChordString("Cmd:Enter")).toBe("⌘⏎");
    });
    // Mod is the platform's primary modifier: Command on a Mac, Control elsewhere (keyutil)
    it("Mod is ⌘ on macOS and Ctrl on Windows", () => {
        setPlatform("darwin");
        expect(formatChordString("Mod:Shift:r")).toBe("⌘⇧R");
        setPlatform("win32");
        expect(formatChordString("Mod:Shift:r")).toBe("Ctrl+Shift+R");
    });
    // DESIGN.md "Shortcut labels": Windows spells each key out, capitalized, with no key symbols
    it("spells chords out in words on Windows, Ctrl+Enter", () => {
        setPlatform("win32");
        expect(formatChord("Ctrl:p")).toEqual(["Ctrl", "P"]);
        expect(formatChord("Ctrl:Shift:Tab")).toEqual(["Ctrl", "Shift", "Tab"]);
        expect(formatChord("Shift:Escape")).toEqual(["Shift", "Esc"]);
        expect(formatChordString("Ctrl:Shift:p")).toBe("Ctrl+Shift+P");
        expect(formatChordString("Cmd:Enter")).toBe("Ctrl+Enter");
        expect(formatChordString("Alt:Backspace")).toBe("Alt+Backspace");
        expect(formatChordString("Shift:Enter")).toBe("Shift+Enter");
    });
    it("names a lone key in words on Windows, whatever case it is given in", () => {
        setPlatform("win32");
        expect(formatChordString("Enter")).toBe("Enter");
        expect(formatChordString("Escape")).toBe("Esc");
        expect(formatChordString("esc")).toBe("Esc");
        expect(formatChordString("Backspace")).toBe("Backspace");
        expect(formatChordString("space")).toBe("Space");
    });
    it("keeps a bare letter and leader-chord keys as typed", () => {
        setPlatform("win32");
        expect(formatChordString("r")).toBe("r");
        expect(formatChord("g p")).toEqual(["g", "p"]);
        expect(formatChordString("g p")).toBe("g p");
    });
    it("names several chords together, one part each", () => {
        setPlatform("win32");
        expect(formatChordString("Shift:n Shift:p")).toBe("Shift+N Shift+P");
    });
    it("keeps the arrows and the Mac glyphs", () => {
        setPlatform("win32");
        expect(modSymbol("ArrowUp")).toBe("↑");
        expect(formatChordString("Alt:ArrowLeft")).toBe("Alt+←");
        setPlatform("darwin");
        expect(modSymbol("Enter")).toBe("⏎");
        expect(modSymbol("Backspace")).toBe("⌫");
        expect(modSymbol("Escape")).toBe("esc");
    });
    // a Mac has no key labelled Alt: prose that names an Alt chord shows ⌥ there
    it("fills the {chord}s in prose per platform", () => {
        const text = "{Alt:ArrowUp} / {Alt:ArrowDown} to reorder, or {Shift:n}; j / k move";
        setPlatform("darwin");
        expect(fillKeys(text)).toBe("⌥↑ / ⌥↓ to reorder, or ⇧N; j / k move");
        setPlatform("win32");
        expect(fillKeys(text)).toBe("Alt+↑ / Alt+↓ to reorder, or Shift+N; j / k move");
    });
});
