// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The bridge between the cockpit's theme vocabulary and Monaco's. The cockpit tokenizes six syntax
// roles (--color-syntax-*) plus chrome roles the runtime engine writes as --color-* vars; Monaco's
// tokenizer scopes do not map one-to-one, so the mapping is family-level and everything else
// inherits the stock base theme. The module imports monaco-editor only as a type, so it stays
// outside the lazy monaco chunk and unit-testable in node.

import { activePalette, buildThemeVars } from "@/app/view/agents/themes";
import { themeOverridesAtom, themePresetAtom } from "@/app/view/agents/themestore";
import { colord } from "colord";
import { useAtomValue } from "jotai";
import type { editor } from "monaco-editor";
import { useLayoutEffect } from "react";

export interface SyntaxTokens {
    keyword: string | null;
    string: string | null;
    number: string | null;
    comment: string | null;
    punct: string | null;
    ident: string | null;
}

export interface MonacoChrome {
    foreground: string | null;
    selection: string | null;
    lineHighlight: string | null;
    added: string | null;
    removed: string | null;
}

const SELECTION_ALPHA = 0.5;
const LINE_HIGHLIGHT_ALPHA = 0.35;
// the diff editor paints the whole changed line, then the changed words again on top — and a wholly added or
// removed line gets the word colour across its full width too, so a new block is both washes stacked (~0.19 here;
// 0.12 + 0.24 made a new file a slab of green)
const DIFF_LINE_ALPHA = 0.06;
const DIFF_TEXT_ALPHA = 0.14;

// token family -> cockpit role. "storage"/"control" read as keyword-family declarations
// (let/const/type), "delimiter" joins "punctuation" (braces, brackets, separators).
const KEYWORD_SCOPES = ["keyword", "storage", "control"] as const;
const PUNCT_SCOPES = ["punctuation", "delimiter"] as const;

export function monacoThemeFromTokens(
    tokens: SyntaxTokens,
    chrome: MonacoChrome,
    dark: boolean
): editor.IStandaloneThemeData {
    const rules: editor.IStandaloneThemeData["rules"] = [];
    const add = (token: string, color: string | null): void => {
        if (color != null) {
            rules.push({ token, foreground: color });
        }
    };
    for (const scope of KEYWORD_SCOPES) {
        add(scope, tokens.keyword);
    }
    add("string", tokens.string);
    add("constant.numeric", tokens.number);
    add("comment", tokens.comment);
    for (const scope of PUNCT_SCOPES) {
        add(scope, tokens.punct);
    }
    const colors: Record<string, string> = {
        // transparent background lets the surface chrome show through; opaque on light
        "editor.background": dark ? "#00000000" : "#fefefe",
        // carried over from the original scaffold so the minimap/sticky scroll do not regress
        "editorStickyScroll.background": "#00000055",
        "minimap.background": "#00000077",
        focusBorder: "#00000000",
    };
    // the text role governs plain text; the ident token is the code-default fallback (see plan
    // "Spec ambiguity resolved" — chrome wins, ident is the pre-engine fallback)
    const fg = chrome.foreground ?? tokens.ident;
    if (fg != null) {
        colors["editor.foreground"] = fg;
    }
    if (chrome.selection != null) {
        colors["editor.selectionBackground"] = colord(chrome.selection).alpha(SELECTION_ALPHA).toHex();
    }
    if (chrome.lineHighlight != null) {
        colors["editor.lineHighlightBackground"] = colord(chrome.lineHighlight).alpha(LINE_HIGHLIGHT_ALPHA).toHex();
    }
    // without these the diff pane keeps vs-dark's olive #9ccc2c and pure red, which do not match the
    // +N/-N counts the change list prints beside them
    if (chrome.added != null) {
        colors["diffEditor.insertedLineBackground"] = colord(chrome.added).alpha(DIFF_LINE_ALPHA).toHex();
        colors["diffEditor.insertedTextBackground"] = colord(chrome.added).alpha(DIFF_TEXT_ALPHA).toHex();
    }
    if (chrome.removed != null) {
        colors["diffEditor.removedLineBackground"] = colord(chrome.removed).alpha(DIFF_LINE_ALPHA).toHex();
        colors["diffEditor.removedTextBackground"] = colord(chrome.removed).alpha(DIFF_TEXT_ALPHA).toHex();
    }
    return { base: dark ? "vs-dark" : "vs", inherit: true, rules, colors };
}

function cssVar(root: HTMLElement, name: string): string | null {
    const v = root.ownerDocument.defaultView?.getComputedStyle(root).getPropertyValue(name).trim();
    return v === "" ? null : v;
}

// the six --color-syntax-* vars are static @theme defaults, so a read at any point after CSS load
// is stable; a null means "inherit the base theme", never a guessed value
export function readSyntaxTokens(root: HTMLElement): SyntaxTokens {
    return {
        keyword: cssVar(root, "--color-syntax-keyword"),
        string: cssVar(root, "--color-syntax-string"),
        number: cssVar(root, "--color-syntax-number"),
        comment: cssVar(root, "--color-syntax-comment"),
        punct: cssVar(root, "--color-syntax-punct"),
        ident: cssVar(root, "--color-syntax-ident"),
    };
}

export function readChromeRoles(root: HTMLElement): MonacoChrome {
    return {
        foreground: cssVar(root, "--color-foreground"),
        selection: cssVar(root, "--color-surface-selected"),
        lineHighlight: cssVar(root, "--color-surface-hover"),
        added: cssVar(root, "--color-diff-added"),
        removed: cssVar(root, "--color-diff-removed"),
    };
}

// Watches the same atoms the theme engine watches and re-themes Monaco. Chrome roles are derived
// through the engine's own pure buildThemeVars rather than computed style, because this layout
// effect runs BEFORE cockpit-root's (child effects run first) and a computed-style read would race
// the engine on the commit where the theme changes. Syntax tokens are static, so readSyntaxTokens
// is safe here, as are the static diff colors. The dynamic import keeps monaco-editor out of the
// surface's static chunk graph.
export function useSyncMonacoTheme(): void {
    const preset = useAtomValue(themePresetAtom);
    const overrides = useAtomValue(themeOverridesAtom);
    useLayoutEffect(() => {
        const vars = buildThemeVars(activePalette(preset), overrides);
        const root = document.documentElement;
        const chrome: MonacoChrome = {
            foreground: vars["--color-foreground"],
            selection: vars["--color-surface-selected"],
            lineHighlight: vars["--color-surface-hover"],
            added: cssVar(root, "--color-diff-added"),
            removed: cssVar(root, "--color-diff-removed"),
        };
        const tokens = readSyntaxTokens(document.documentElement);
        let cancelled = false;
        void import("@/app/monaco/monaco-env").then((m) => {
            if (cancelled) {
                return;
            }
            m.loadMonaco();
            m.applyMonacoTheme("wave-theme-dark", monacoThemeFromTokens(tokens, chrome, true));
        });
        return () => {
            cancelled = true;
        };
    }, [preset, overrides]);
}
