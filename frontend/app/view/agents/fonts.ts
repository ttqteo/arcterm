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

// Hack and Fira Code have no Vietnamese Extended letters (ả, ị, ở): those fall to JetBrains Mono, which has them at the
// same 0.6em advance, rather than to a system monospace of another width. Hack also needs its range cut
// (util/fontutil.ts), or Chromium draws the letter from Hack's own full-width combining marks.
const VI_MONO_FALLBACK = '"JetBrains Mono", monospace';

export const MONO_FONTS: FontDef[] = [
    { id: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", monospace' },
    { id: "hack", label: "Hack", stack: `"Hack", ${VI_MONO_FALLBACK}` },
    { id: "firacode", label: "Fira Code", stack: `"Fira Code", ${VI_MONO_FALLBACK}` },
];

export const DEFAULT_SANS = "inter";
export const DEFAULT_MONO = "jetbrains";
export const DEFAULT_TERM_FONT = "jetbrains"; // matches term.tsx's fallback and defaultconfig's term:fontfamily

// Look up a font's stack by id, falling back to the list's first entry for an unknown id.
export function stackOf(list: FontDef[], id: string): string {
    return (list.find((f) => f.id === id) ?? list[0]).stack;
}

// The catalog face a saved mono stack names. term:fontfamily keeps the whole stack string, so one saved before its
// fallback changed still names its face first; each label is its face's family name.
export function monoFontOf(stack: string): FontDef | undefined {
    const lead = stack
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "");
    return MONO_FONTS.find((f) => f.stack === stack || f.label === lead);
}

// The stack a terminal draws with: a catalog face's current stack, a stack of the user's own as written, the default
// terminal face when none is set.
export function termFontStack(saved: string | undefined): string {
    if (!saved) {
        return stackOf(MONO_FONTS, DEFAULT_TERM_FONT);
    }
    return monoFontOf(saved)?.stack ?? saved;
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
