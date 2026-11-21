// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { monacoThemeFromTokens, readChromeRoles, type MonacoChrome, type SyntaxTokens } from "./monacotheme";

const TOKENS: SyntaxTokens = {
    keyword: "#aebfff",
    string: "#7fd6ab",
    number: "#e6b450",
    comment: "#6b7178",
    punct: "#8b939d",
    ident: "#cdd3da",
};

const CHROME: MonacoChrome = {
    foreground: "#e2e8f0",
    selection: "#5e9cff",
    lineHighlight: "#171c22",
    added: "#3fb950",
    removed: "#f85149",
};

describe("monacoThemeFromTokens", () => {
    it("maps each syntax token to its scope family on a dark base", () => {
        const t = monacoThemeFromTokens(TOKENS, CHROME, true);
        expect(t.base).toBe("vs-dark");
        expect(t.inherit).toBe(true);
        const rule = (token: string) => t.rules.find((r) => r.token === token);
        expect(rule("keyword")?.foreground).toBe("#aebfff");
        expect(rule("storage")?.foreground).toBe("#aebfff");
        expect(rule("control")?.foreground).toBe("#aebfff");
        expect(rule("string")?.foreground).toBe("#7fd6ab");
        expect(rule("constant.numeric")?.foreground).toBe("#e6b450");
        expect(rule("comment")?.foreground).toBe("#6b7178");
        expect(rule("punctuation")?.foreground).toBe("#8b939d");
        expect(rule("delimiter")?.foreground).toBe("#8b939d");
    });

    it("drops rules for null tokens instead of inventing colors", () => {
        const t = monacoThemeFromTokens({ ...TOKENS, keyword: null, punct: null }, CHROME, true);
        for (const token of ["keyword", "storage", "control", "punctuation", "delimiter"]) {
            expect(t.rules.find((r) => r.token === token)).toBeUndefined();
        }
        expect(t.rules.find((r) => r.token === "string")).toBeDefined();
    });

    it("sets editor.foreground from chrome, falling back to the ident token", () => {
        expect(monacoThemeFromTokens(TOKENS, CHROME, true).colors["editor.foreground"]).toBe("#e2e8f0");
        const noChrome = monacoThemeFromTokens(TOKENS, { ...CHROME, foreground: null }, true);
        expect(noChrome.colors["editor.foreground"]).toBe("#cdd3da");
        const neither = monacoThemeFromTokens({ ...TOKENS, ident: null }, { ...CHROME, foreground: null }, true);
        expect(neither.colors["editor.foreground"]).toBeUndefined();
    });

    it("alpha-blends the selection and line-highlight chrome colors", () => {
        const t = monacoThemeFromTokens(TOKENS, CHROME, true);
        expect(t.colors["editor.selectionBackground"]).toMatch(/^#5e9cff[0-9a-f]{2}$/);
        expect(t.colors["editor.inactiveSelectionBackground"]).toMatch(/^#5e9cff[0-9a-f]{2}$/);
        expect(t.colors["editor.lineHighlightBackground"]).toMatch(/^#171c22[0-9a-f]{2}$/);
    });

    it("drops chrome colors that are null so the base theme's values inherit", () => {
        const t = monacoThemeFromTokens(TOKENS, { ...CHROME, selection: null, lineHighlight: null }, true);
        expect(t.colors["editor.selectionBackground"]).toBeUndefined();
        expect(t.colors["editor.lineHighlightBackground"]).toBeUndefined();
    });

    it("paints the diff bands from the cockpit's add/remove roles, not vs-dark's olive", () => {
        const t = monacoThemeFromTokens(TOKENS, CHROME, true);
        expect(t.colors["diffEditor.insertedLineBackground"]).toMatch(/^#3fb950[0-9a-f]{2}$/);
        expect(t.colors["diffEditor.insertedTextBackground"]).toMatch(/^#3fb950[0-9a-f]{2}$/);
        expect(t.colors["diffEditor.removedLineBackground"]).toMatch(/^#f85149[0-9a-f]{2}$/);
        expect(t.colors["diffEditor.removedTextBackground"]).toMatch(/^#f85149[0-9a-f]{2}$/);
    });

    it("keeps the line wash fainter than the word highlight, and both translucent", () => {
        const t = monacoThemeFromTokens(TOKENS, CHROME, true);
        const alpha = (key: string) => parseInt(t.colors[key].slice(-2), 16);
        for (const side of ["inserted", "removed"]) {
            const line = alpha(`diffEditor.${side}LineBackground`);
            const text = alpha(`diffEditor.${side}TextBackground`);
            expect(line).toBeLessThan(text);
            // monaco requires these stay see-through or they hide the decorations underneath
            expect(text).toBeLessThan(255);
        }
    });

    it("drops the diff colors that are null so the base theme's values inherit", () => {
        const t = monacoThemeFromTokens(TOKENS, { ...CHROME, added: null, removed: null }, true);
        for (const key of [
            "diffEditor.insertedLineBackground",
            "diffEditor.insertedTextBackground",
            "diffEditor.removedLineBackground",
            "diffEditor.removedTextBackground",
        ]) {
            expect(t.colors[key]).toBeUndefined();
        }
    });

    it("keeps the editor background transparent on dark and opaque on light", () => {
        expect(monacoThemeFromTokens(TOKENS, CHROME, true).colors["editor.background"]).toBe("#00000000");
        expect(monacoThemeFromTokens(TOKENS, CHROME, false).colors["editor.background"]).toBe("#fefefe");
    });

    it("keeps the existing minimap/sticky-scroll chrome values", () => {
        const t = monacoThemeFromTokens(TOKENS, CHROME, true);
        expect(t.colors["minimap.background"]).toBe("#00000077");
        expect(t.colors["editorStickyScroll.background"]).toBe("#00000055");
    });

    it("selects the light base when dark is false", () => {
        expect(monacoThemeFromTokens(TOKENS, CHROME, false).base).toBe("vs");
    });
});

describe("readChromeRoles", () => {
    it("takes the diff colors from the diff tokens, not the success/error status colors", () => {
        const vars: Record<string, string> = {
            "--color-success": "#54c79a",
            "--color-error": "#e0726c",
            "--color-diff-added": "#3fb950",
            "--color-diff-removed": "#f85149",
        };
        const root = {
            ownerDocument: {
                defaultView: { getComputedStyle: () => ({ getPropertyValue: (n: string) => vars[n] ?? "" }) },
            },
        } as unknown as HTMLElement;
        const chrome = readChromeRoles(root);
        expect(chrome.added).toBe("#3fb950");
        expect(chrome.removed).toBe("#f85149");
    });
});
