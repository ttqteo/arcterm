// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Font catalog + application. Mirrors themes.ts: the cockpit renders through Tailwind's font-sans/
// font-mono utilities that read var(--font-*), so overriding those custom properties on <html>
// re-fonts everything with no component edits. Curated to the bundled (self-hosted) faces so the
// picker stays offline-safe. Faces are registered in util/fontutil.ts.

export interface FontDef {
    id: string;
    label: string;
    stack: string; // full CSS font stack written to the --font-* var (keeps a fallback chain)
}

export const SANS_FONTS: FontDef[] = [
    { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif' },
    { id: "hanken", label: "Hanken Grotesk", stack: '"Hanken Grotesk", system-ui, sans-serif' },
    { id: "system", label: "System UI", stack: "system-ui, sans-serif" },
];

export const MONO_FONTS: FontDef[] = [
    { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", monospace' },
    { id: "hack", label: "Hack", stack: '"Hack", monospace' },
    { id: "firacode", label: "Fira Code", stack: '"Fira Code", monospace' },
];

export const DEFAULT_SANS = "inter";
export const DEFAULT_MONO = "jetbrains";
export const DEFAULT_TERM_FONT = "jetbrains"; // matches term.tsx's fallback and defaultconfig's term:fontfamily

// Look up a font's stack by id, falling back to the list's first entry for an unknown id.
export function stackOf(list: FontDef[], id: string): string {
    return (list.find((f) => f.id === id) ?? list[0]).stack;
}

// Write the sans/mono font vars onto a root element's inline style (highest specificity — beats the
// @theme :root rule). Also sets Tailwind v4's --default-*-font-family (which default to var(--font-*))
// so the base body/code font follows even if a layer pinned them. Kept tiny + injectable for testing.
export function applyFontVars(root: HTMLElement, sansId: string, monoId: string): void {
    const sans = stackOf(SANS_FONTS, sansId);
    const mono = stackOf(MONO_FONTS, monoId);
    root.style.setProperty("--font-sans", sans);
    root.style.setProperty("--font-mono", mono);
    root.style.setProperty("--default-font-family", sans);
    root.style.setProperty("--default-mono-font-family", mono);
}
