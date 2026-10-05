// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Runtime theming engine. Themes are expressed in the cockpit's own --color-* vocabulary (NOT the
// mockup's --wv-*): buildThemeVars maps a per-theme base palette to the full --color-* override set,
// which useApplyCockpitTheme (themestore.ts) writes onto document.documentElement. Because the whole
// cockpit renders through Tailwind v4 var(--color-*) utilities, overriding those custom properties
// re-skins everything with no component edits.

import { colord } from "colord";

// The base roles we theme. A deliberately small set: the identity-carrying "chrome". Subtle greys
// (muted-foreground, ink-mid, lane, feed-*) and identity colors (mem/rt/ansi) are left at their
// tailwindsetup.css @theme defaults — safe across all dark themes (light mode was declined; see
// docs/deferred.md).
export interface ThemePalette {
    bg: string;
    surface: string;
    surfaceRaised: string;
    surfaceHover: string;
    surfaceSelected: string;
    code: string;
    border: string;
    edgeMid: string;
    edgeStrong: string;
    edgeFaint: string;
    text: string;
    secondary: string;
    muted: string;
    inkFaint: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
}

// Roles the "Custom colors" card can override; buildThemeVars merges {...palette, ...overrides}.
export type OverrideRole = "accent" | "success" | "warning" | "error";

export interface ThemeDef {
    id: string;
    name: string;
    palette: ThemePalette;
}

// The preset a user who never picked one sees. It must equal the @theme literals in tailwindsetup.css (first
// paint) — guarded by themes.test.ts — and be THEMES[0], which activePalette falls back to.
export const DEFAULT_THEME_PRESET = "graphite";

export const THEMES: ThemeDef[] = [
    {
        id: "graphite",
        name: "Graphite",
        // Neutral greys after Antigravity's agent manager: regions separated by tone, not lines. muted and inkFaint
        // are lifted above Antigravity's #6e6e6e to the DESIGN.md contrast floor.
        palette: {
            bg: "#101010",
            surface: "#161616",
            surfaceRaised: "#1c1c1c",
            surfaceHover: "#252525",
            surfaceSelected: "#2d2d2d",
            code: "#0c0c0c",
            border: "#1f1f1f",
            edgeMid: "#2a2a2a",
            edgeStrong: "#3d3d3d",
            edgeFaint: "#1a1a1a",
            text: "#d6d6d6",
            secondary: "#cccccc",
            muted: "#8e8e8e",
            inkFaint: "#666666",
            accent: "#5e9cff",
            success: "#54c79a",
            warning: "#e6b450",
            error: "#e0726c",
        },
    },
    {
        id: "midnight",
        name: "Midnight",
        // The previous default: authored to the tailwindsetup.css values of its day (not the mockup's Midnight),
        // when it reproduced the shipped look exactly.
        palette: {
            bg: "#0c0e11",
            surface: "#0e1116",
            surfaceRaised: "#13171d",
            surfaceHover: "#171c22",
            surfaceSelected: "#1a222c",
            code: "#0b0d10",
            border: "#1c2128",
            edgeMid: "#20262e",
            edgeStrong: "#2a313a",
            edgeFaint: "#161a20",
            text: "#e6e9ed",
            secondary: "#cfd5db",
            muted: "#7f858b",
            inkFaint: "#646a72",
            accent: "#5e9cff",
            success: "#54c79a",
            warning: "#e6b450",
            error: "#e0726c",
        },
    },
    {
        id: "slate",
        name: "Slate",
        palette: {
            bg: "#0d1117",
            surface: "#111722",
            surfaceRaised: "#161d2b",
            surfaceHover: "#1b2434",
            surfaceSelected: "#1e2942",
            code: "#0a0e15",
            border: "#1f2733",
            edgeMid: "#28323f",
            edgeStrong: "#374252",
            edgeFaint: "#19212c",
            text: "#dbe2ec",
            secondary: "#9fb0c3",
            muted: "#7f8e9e",
            inkFaint: "#69707b",
            accent: "#4d9fff",
            success: "#3fb98f",
            warning: "#e0aa3e",
            error: "#e46b6b",
        },
    },
    {
        id: "carbon",
        name: "Carbon",
        palette: {
            bg: "#0e0e0d",
            surface: "#141412",
            surfaceRaised: "#1b1b18",
            surfaceHover: "#212120",
            surfaceSelected: "#282824",
            code: "#0b0b0a",
            border: "#232320",
            edgeMid: "#2d2d29",
            edgeStrong: "#3a3a34",
            edgeFaint: "#1c1c19",
            text: "#e5e3db",
            secondary: "#b3b0a4",
            muted: "#8c8a83",
            inkFaint: "#6f6d69",
            accent: "#e08a4f",
            success: "#5fb98a",
            warning: "#d9b24a",
            error: "#e0726c",
        },
    },
    {
        id: "nocturne",
        name: "Nocturne",
        palette: {
            bg: "#0d0b12",
            surface: "#131019",
            surfaceRaised: "#191527",
            surfaceHover: "#201a2e",
            surfaceSelected: "#241d38",
            code: "#0a0810",
            border: "#221d30",
            edgeMid: "#2c2640",
            edgeStrong: "#3a3352",
            edgeFaint: "#1b1728",
            text: "#e4dff0",
            secondary: "#b0a6c6",
            muted: "#89819e",
            inkFaint: "#6b657a",
            accent: "#b57cff",
            success: "#54c79a",
            warning: "#e6b450",
            error: "#e0726c",
        },
    },
    {
        id: "onedark",
        name: "One Dark",
        palette: {
            bg: "#282c34",
            surface: "#21252b",
            surfaceRaised: "#2f343d",
            surfaceHover: "#3a4048",
            surfaceSelected: "#3e4451",
            code: "#1e2228",
            border: "#3a3f4b",
            edgeMid: "#454b58",
            edgeStrong: "#565d6b",
            edgeFaint: "#2c313a",
            text: "#abb2bf",
            secondary: "#9298a4",
            muted: "#a6abb3",
            inkFaint: "#888c95",
            accent: "#61afef",
            success: "#98c379",
            warning: "#e5c07b",
            error: "#e06c75",
        },
    },
    {
        id: "monokai",
        name: "Monokai",
        palette: {
            bg: "#272822",
            surface: "#2d2e28",
            surfaceRaised: "#33342d",
            surfaceHover: "#3e4038",
            surfaceSelected: "#494b40",
            code: "#1d1e19",
            border: "#3e4035",
            edgeMid: "#4d4f43",
            edgeStrong: "#62654f",
            edgeFaint: "#2f302a",
            text: "#cfd0c2",
            secondary: "#a8aa98",
            muted: "#adaa9d",
            inkFaint: "#8a8a83",
            accent: "#66d9ef",
            success: "#a6e22e",
            warning: "#e6db74",
            error: "#f92672",
        },
    },
];

// Accent quick-picks for the Custom colors card (ports the mockup accentPalette; the first
// entry tracks the current default accent, graphite's cc-dark blue).
export const ACCENT_SWATCHES: string[] = [
    "#5e9cff",
    "#4d9fff",
    "#66d9ef",
    "#2fb8a0",
    "#a6e22e",
    "#e6b450",
    "#e08a4f",
    "#f92672",
    "#b57cff",
    "#e0726c",
];

export function activePalette(presetId: string): ThemePalette {
    return (THEMES.find((t) => t.id === presetId) ?? THEMES[0]).palette;
}

export function colorOf(
    palette: ThemePalette,
    overrides: Partial<Record<OverrideRole, string>>,
    role: OverrideRole
): string {
    return overrides[role] ?? palette[role];
}

// ---- color math (ports the mockup's helpers) ----
function clampByte(n: number): number {
    return Math.max(0, Math.min(255, Math.round(n)));
}
function toHex(n: number): string {
    return clampByte(n).toString(16).padStart(2, "0");
}
function parseHex(h: string): [number, number, number] {
    let s = h.replace("#", "");
    if (s.length === 3) {
        s = s
            .split("")
            .map((c) => c + c)
            .join("");
    }
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function mix(a: string, b: string, t: number): string {
    const [ar, ag, ab] = parseHex(a);
    const [br, bg, bb] = parseHex(b);
    return "#" + toHex(ar + (br - ar) * t) + toHex(ag + (bg - ag) * t) + toHex(ab + (bb - ab) * t);
}
function lighten(h: string, t: number): string {
    return mix(h, "#ffffff", t);
}
function darken(h: string, t: number): string {
    return mix(h, "#000000", t);
}
function rgba(h: string, a: number): string {
    const [r, g, b] = parseHex(h);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---- ANSI derivation ----
// The 16 terminal color slots, derived from roles the palette already defines. Two consumers:
// buildThemeVars (--ansi-* custom properties) and deriveTermTheme (the live xterm palette), so the
// CSS side and the terminal cannot drift.
export interface AnsiPalette {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
}

const AnsiBrighten = 0.25; // bright-slot lift; large enough that every pair separates in all 6 themes

// Magenta and cyan are the only slots with no cockpit role. Their hue is pinned to the slot's
// canonical position and only saturation/lightness follow the accent — rotating the accent's own hue
// produces a GREEN magenta on Carbon (accent #d7a95c) and a RED cyan, which is worse than ignoring
// the theme. Floors keep a desaturated accent from yielding a grey "magenta" and a dark one from
// yielding an illegible slot.
const MagentaHue = 302;
const CyanHue = 186;
const HueSatFloor = 55;
const HueLightMin = 58;
const HueLightMax = 72;

function atHue(base: string, h: number): string {
    const hsl = colord(base).toHsl();
    return colord({
        h,
        s: Math.max(hsl.s, HueSatFloor),
        l: Math.min(Math.max(hsl.l, HueLightMin), HueLightMax),
    }).toHex();
}

// `secondary` is deliberately unmapped: white comes from `text` so the grey ramp
// black < brightBlack < white < brightWhite stays monotonic even on One Dark, which defines `muted`
// lighter than `secondary`.
export function deriveAnsi(palette: ThemePalette): AnsiPalette {
    const magenta = atHue(palette.accent, MagentaHue);
    const cyan = atHue(palette.accent, CyanHue);
    return {
        black: palette.inkFaint,
        brightBlack: palette.muted,
        red: palette.error,
        brightRed: lighten(palette.error, AnsiBrighten),
        green: palette.success,
        brightGreen: lighten(palette.success, AnsiBrighten),
        yellow: palette.warning,
        brightYellow: lighten(palette.warning, AnsiBrighten),
        blue: palette.accent,
        brightBlue: lighten(palette.accent, AnsiBrighten),
        magenta,
        brightMagenta: lighten(magenta, AnsiBrighten),
        cyan,
        brightCyan: lighten(cyan, AnsiBrighten),
        white: palette.text,
        brightWhite: lighten(palette.text, AnsiBrighten),
    };
}

// The terminal's palette. Structurally assignable to xterm's ITheme; declared locally so the theme
// engine takes no dependency on @xterm/xterm. `background` is OPAQUE on purpose: xterm's own
// stylesheet paints .xterm-viewport #000, and the previous transparent-background behavior is what
// let that show through as a black seam inside a themed cockpit.
export interface TermPalette extends AnsiPalette {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
}

export function deriveTermTheme(palette: ThemePalette, overrides: Partial<Record<OverrideRole, string>>): TermPalette {
    const p = { ...palette, ...overrides };
    return {
        background: p.bg,
        foreground: p.text,
        cursor: p.accent,
        cursorAccent: p.bg,
        selectionBackground: p.surfaceSelected,
        ...deriveAnsi(p),
    };
}

// Build the full --color-* override map from a base palette + user overrides. Only the themed "chrome"
// tokens are emitted; everything else keeps its @theme default.
export function buildThemeVars(
    palette: ThemePalette,
    overrides: Partial<Record<OverrideRole, string>>
): Record<string, string> {
    const p = { ...palette, ...overrides };
    const ansi = deriveAnsi(p);
    return {
        // surfaces
        "--color-background": p.bg,
        "--color-surface": p.surface,
        "--color-surface-raised": p.surfaceRaised,
        "--color-surface-hover": p.surfaceHover,
        "--color-surface-selected": p.surfaceSelected,
        "--color-surface-code": p.code,
        "--color-panel": rgba(p.surfaceRaised, 0.6),
        "--color-modalbg": p.surfaceRaised,
        // text
        "--color-foreground": p.text,
        "--color-white": p.text,
        "--color-primary": p.text,
        "--color-secondary": p.secondary,
        "--color-muted": p.muted,
        "--color-ink-faint": p.inkFaint,
        // borders
        "--color-border": p.border,
        "--color-edge-mid": p.edgeMid,
        "--color-edge-strong": p.edgeStrong,
        "--color-edge-faint": p.edgeFaint,
        // accent + ramp
        "--color-accent": p.accent,
        "--color-accent-400": p.accent,
        "--color-accenthover": lighten(p.accent, 0.14),
        "--color-accent-300": lighten(p.accent, 0.14),
        "--color-accent-soft": lighten(p.accent, 0.3),
        "--color-accent-200": lighten(p.accent, 0.3),
        "--color-accent-100": lighten(p.accent, 0.58),
        "--color-accent-50": lighten(p.accent, 0.8),
        "--color-accent-500": darken(p.accent, 0.18),
        "--color-accent-600": darken(p.accent, 0.34),
        "--color-accent-700": darken(p.accent, 0.48),
        "--color-accent-800": darken(p.accent, 0.62),
        "--color-accent-900": darken(p.accent, 0.72),
        "--color-accentbg": rgba(p.accent, 0.12),
        // status
        "--color-success": p.success,
        "--color-working": p.success,
        "--color-success-soft": lighten(p.success, 0.4),
        "--color-warning": p.warning,
        "--color-asking": p.warning,
        "--color-on-warning": darken(p.warning, 0.9),
        "--color-askingbg": rgba(p.warning, 0.12),
        "--color-error": p.error,
        // ANSI palette — same derivation the terminal uses (deriveTermTheme), so the CSS side and the
        // live xterm palette cannot drift. Names are lowercase to match the @theme declarations in
        // tailwindsetup.css, which these override.
        "--ansi-black": ansi.black,
        "--ansi-red": ansi.red,
        "--ansi-green": ansi.green,
        "--ansi-yellow": ansi.yellow,
        "--ansi-blue": ansi.blue,
        "--ansi-magenta": ansi.magenta,
        "--ansi-cyan": ansi.cyan,
        "--ansi-white": ansi.white,
        "--ansi-brightblack": ansi.brightBlack,
        "--ansi-brightred": ansi.brightRed,
        "--ansi-brightgreen": ansi.brightGreen,
        "--ansi-brightyellow": ansi.brightYellow,
        "--ansi-brightblue": ansi.brightBlue,
        "--ansi-brightmagenta": ansi.brightMagenta,
        "--ansi-brightcyan": ansi.brightCyan,
        "--ansi-brightwhite": ansi.brightWhite,
    };
}

// Write the computed vars onto a root element's inline style (highest specificity — beats the @theme
// :root rule). Kept tiny + injectable so it's unit-testable without a DOM.
export function applyThemeVars(root: HTMLElement, vars: Record<string, string>): void {
    for (const [k, v] of Object.entries(vars)) {
        root.style.setProperty(k, v);
    }
}
