// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { applyFontVars, DEFAULT_MONO, DEFAULT_SANS, DEFAULT_TERM_FONT, MONO_FONTS, SANS_FONTS, stackOf } from "./fonts";

describe("font catalog", () => {
    it("sans list has unique ids and includes the default", () => {
        const ids = SANS_FONTS.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain(DEFAULT_SANS);
    });
    it("mono list has unique ids, includes the default and Fira Code", () => {
        const ids = MONO_FONTS.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain(DEFAULT_MONO);
        expect(ids).toContain("firacode");
    });
    it("every stack is a non-empty string", () => {
        for (const f of [...SANS_FONTS, ...MONO_FONTS]) {
            expect(f.stack.length).toBeGreaterThan(0);
        }
    });
});

describe("defaults", () => {
    // the bundled Hanken Grotesk, Hack and Fira Code have no Vietnamese; Inter and the variable JetBrains Mono do
    it("default faces are the Vietnamese-capable ones", () => {
        expect(DEFAULT_SANS).toBe("inter");
        expect(DEFAULT_MONO).toBe("jetbrains");
        expect(DEFAULT_TERM_FONT).toBe("jetbrains");
    });
    it("each list leads with its default, so stackOf's fallback is the default", () => {
        expect(SANS_FONTS[0].id).toBe(DEFAULT_SANS);
        expect(MONO_FONTS[0].id).toBe(DEFAULT_MONO);
    });
});

describe("stackOf", () => {
    it("returns the matching stack", () => {
        expect(stackOf(SANS_FONTS, "inter")).toBe('"Inter", system-ui, sans-serif');
    });
    it("falls back to the first entry for an unknown id", () => {
        expect(stackOf(SANS_FONTS, "nope")).toBe(SANS_FONTS[0].stack);
    });
});

describe("applyFontVars", () => {
    it("writes --font-sans and --font-mono from the given ids", () => {
        const set: Record<string, string> = {};
        const root = { style: { setProperty: (k: string, v: string) => (set[k] = v) } };
        applyFontVars(root as unknown as HTMLElement, "inter", "firacode");
        expect(set["--font-sans"]).toBe('"Inter", system-ui, sans-serif');
        expect(set["--font-mono"]).toBe('"Fira Code", monospace');
    });
});
