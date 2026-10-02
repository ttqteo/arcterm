// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    ACCENT_SWATCHES,
    activePalette,
    applyThemeVars,
    buildThemeVars,
    colorOf,
    DEFAULT_THEME_PRESET,
    deriveAnsi,
    deriveTermTheme,
    THEMES,
} from "./themes";

// The @theme block of tailwindsetup.css with comments stripped, so neither a comment that quotes a token nor a
// later :root redefinition can be read as the literal.
const THEME_BLOCK = (() => {
    const css = readFileSync(new URL("../../../tailwindsetup.css", import.meta.url), "utf8");
    const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
    if (!block) {
        throw new Error("tailwindsetup.css: no @theme block");
    }
    return block[1].replace(/\/\*[\s\S]*?\*\//g, "");
})();
// Every declaration of `name` in the @theme block, whitespace-normalized.
function themeLiterals(name: string): string[] {
    const re = new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`, "gm");
    return [...THEME_BLOCK.matchAll(re)].map((m) => m[1].replace(/\s+/g, " ").trim());
}

describe("buildThemeVars — the default preset equals the @theme literals", () => {
    // First paint (before useApplyCockpitTheme) uses the literals; they must equal the default preset or the
    // app flashes another theme on boot. This guards the surface/ink/edge/status tokens listed here only: the
    // accent ramp, the *-soft tints, on-warning and the --ansi-* literals are fallbacks that buildThemeVars
    // derives differently.
    const keys = [
        "--color-background",
        "--color-surface",
        "--color-surface-raised",
        "--color-surface-hover",
        "--color-surface-selected",
        "--color-surface-code",
        "--color-panel",
        "--color-modalbg",
        "--color-foreground",
        "--color-primary",
        "--color-white",
        "--color-secondary",
        "--color-muted",
        "--color-ink-faint",
        "--color-border",
        "--color-edge-mid",
        "--color-edge-strong",
        "--color-edge-faint",
        "--color-accent",
        "--color-accent-400",
        "--color-accentbg",
        "--color-error",
        "--color-warning",
        "--color-asking",
        "--color-success",
        "--color-working",
    ];
    const vars = buildThemeVars(activePalette(DEFAULT_THEME_PRESET), {});
    for (const k of keys) {
        it(`${k} matches tailwindsetup.css`, () => {
            expect(vars[k]).toBeDefined();
            expect(themeLiterals(k)).toEqual([vars[k]]);
        });
    }
});

describe("graphite — contrast floor (DESIGN.md)", () => {
    const p = activePalette("graphite");
    it("muted clears 4.5:1 on the background and on a hovered row", () => {
        expect(contrast(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.muted, p.surfaceHover)).toBeGreaterThanOrEqual(4.5);
    });
    it("ink-faint clears the 3:1 non-text minimum on the background", () => {
        expect(contrast(p.inkFaint, p.bg)).toBeGreaterThanOrEqual(3);
    });
});

describe("color math (via override derivation)", () => {
    it("accent override propagates to accent-400 and accentbg", () => {
        const vars = buildThemeVars(activePalette("midnight"), { accent: "#66d9ef" });
        expect(vars["--color-accent"]).toBe("#66d9ef");
        expect(vars["--color-accent-400"]).toBe("#66d9ef");
        expect(vars["--color-accentbg"]).toBe("rgba(102, 217, 239, 0.12)");
    });
    it("status override propagates: success -> success + working", () => {
        const vars = buildThemeVars(activePalette("midnight"), { success: "#00ff00" });
        expect(vars["--color-success"]).toBe("#00ff00");
        expect(vars["--color-working"]).toBe("#00ff00");
    });
    it("no override -> preset accent", () => {
        const vars = buildThemeVars(activePalette("slate"), {});
        expect(vars["--color-accent"]).toBe("#4d9fff");
    });
});

describe("helpers", () => {
    it("activePalette falls back to the default preset for an unknown id", () => {
        expect(activePalette("nope")).toBe(activePalette(DEFAULT_THEME_PRESET));
    });
    it("colorOf prefers override over palette", () => {
        const p = activePalette("midnight");
        expect(colorOf(p, {}, "accent")).toBe("#5e9cff");
        expect(colorOf(p, { accent: "#123456" }, "accent")).toBe("#123456");
    });
    it("THEMES ships the seven dark presets — light mode was declined and removed", () => {
        expect(THEMES).toHaveLength(7);
        expect(THEMES[0].id).toBe(DEFAULT_THEME_PRESET);
    });
    it("ACCENT_SWATCHES has 10 hex values", () => {
        expect(ACCENT_SWATCHES).toHaveLength(10);
        expect(ACCENT_SWATCHES[0]).toBe("#5e9cff");
    });
    it("applyThemeVars sets each var on the root style", () => {
        const set: Record<string, string> = {};
        const root = { style: { setProperty: (k: string, v: string) => (set[k] = v) } };
        applyThemeVars(root as unknown as HTMLElement, { "--color-accent": "#abc" });
        expect(set["--color-accent"]).toBe("#abc");
    });
});

// --- ANSI derivation -----------------------------------------------------------------------------
// Contrast per WCAG 2.1 relative luminance. Local to the test: production code never needs it.
function channel(c: number): number {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
    const s = hex.replace("#", "");
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// Hue in degrees, from RGB. Only used to assert magenta/cyan land in the right part of the wheel.
function hue(hex: string): number {
    const s = hex.replace("#", "");
    const r = parseInt(s.slice(0, 2), 16) / 255;
    const g = parseInt(s.slice(2, 4), 16) / 255;
    const b = parseInt(s.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) {
        return 0;
    }
    const d = max - min;
    let h: number;
    if (max === r) {
        h = ((g - b) / d) % 6;
    } else if (max === g) {
        h = (b - r) / d + 2;
    } else {
        h = (r - g) / d + 4;
    }
    h *= 60;
    return h < 0 ? h + 360 : h;
}

const ANSI_SLOTS = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow",
    "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;
const BRIGHT_PAIRS: [string, string][] = [
    ["black", "brightBlack"], ["red", "brightRed"], ["green", "brightGreen"], ["yellow", "brightYellow"],
    ["blue", "brightBlue"], ["magenta", "brightMagenta"], ["cyan", "brightCyan"], ["white", "brightWhite"],
];

describe("deriveAnsi — structural invariants across every selectable theme", () => {
    // themePresetAtom is written by AppearanceSection, which renders THEMES; every preset is
    // therefore reachable.
    for (const theme of THEMES) {
        const ansi = deriveAnsi(theme.palette) as unknown as Record<string, string>;

        it(`${theme.id}: all 16 slots are parseable 6-digit hex`, () => {
            for (const slot of ANSI_SLOTS) {
                expect(ansi[slot], slot).toMatch(/^#[0-9a-f]{6}$/i);
            }
        });

        // One Dark defines muted (#a6abb3) LIGHTER than secondary (#9298a4). A white<-secondary
        // mapping would render "bright black" lighter than "white" in the terminal.
        it(`${theme.id}: grey ramp is strictly monotonic black < brightBlack < white < brightWhite`, () => {
            const ramp = ["black", "brightBlack", "white", "brightWhite"];
            for (let i = 1; i < ramp.length; i++) {
                expect(luminance(ansi[ramp[i]]), `${ramp[i]} vs ${ramp[i - 1]}`).toBeGreaterThan(
                    luminance(ansi[ramp[i - 1]])
                );
            }
        });

        it(`${theme.id}: every bright slot is strictly lighter than its base`, () => {
            for (const [base, bright] of BRIGHT_PAIRS) {
                expect(luminance(ansi[bright]), `${bright} vs ${base}`).toBeGreaterThan(luminance(ansi[base]));
            }
        });

        // Guards the Carbon defect: an amber accent must not produce a green "magenta" (spec decision 12).
        it(`${theme.id}: magenta and cyan land in their canonical hue ranges`, () => {
            expect(hue(ansi.magenta), `magenta hue ${hue(ansi.magenta)}`).toBeGreaterThanOrEqual(280);
            expect(hue(ansi.magenta)).toBeLessThanOrEqual(320);
            expect(hue(ansi.cyan), `cyan hue ${hue(ansi.cyan)}`).toBeGreaterThanOrEqual(170);
            expect(hue(ansi.cyan)).toBeLessThanOrEqual(200);
        });

        // 3:1 is WCAG's floor for UI components / large text. Terminal glyphs are not large text, so
        // this catches gross regressions rather than certifying AA. Measured worst case across the six
        // themes is 3.51 (nocturne.black), so this has real margin. See spec decision 5.
        it(`${theme.id}: every slot clears 3:1 against its own background`, () => {
            for (const slot of ANSI_SLOTS) {
                expect(contrast(ansi[slot], theme.palette.bg), `${slot}=${ansi[slot]}`).toBeGreaterThanOrEqual(3);
            }
        });
    }
});

describe("deriveAnsi — Midnight golden set", () => {
    // Pinned so a future edit to Midnight's palette roles surfaces as a reviewable diff rather than a
    // silent change to the terminal's colors.
    it("matches the recorded values", () => {
        expect(deriveAnsi(activePalette("midnight"))).toEqual({
            black: "#646a72",
            brightBlack: "#7f858b",
            red: "#e0726c",
            brightRed: "#e89591",
            green: "#54c79a",
            brightGreen: "#7fd5b3",
            yellow: "#e6b450",
            brightYellow: "#ecc77c",
            blue: "#5e9cff",
            brightBlue: "#86b5ff",
            magenta: "#ff5cfa",
            brightMagenta: "#ff85fb",
            cyan: "#5cefff",
            brightCyan: "#85f3ff",
            white: "#e6e9ed",
            brightWhite: "#eceff2",
        });
    });

    it("an accent override moves ANSI blue, magenta and cyan", () => {
        const base = deriveAnsi(activePalette("midnight"));
        const overridden = deriveAnsi({ ...activePalette("midnight"), accent: "#66d9ef" });
        expect(overridden.blue).toBe("#66d9ef");
        expect(overridden.magenta).not.toBe(base.magenta);
        expect(overridden.cyan).not.toBe(base.cyan);
    });
});

describe("deriveTermTheme", () => {
    const midnight = activePalette("midnight");

    it("background is the theme background, opaque — never a transparent black", () => {
        const t = deriveTermTheme(midnight, {});
        expect(t.background).toBe("#0c0e11");
        expect(t.background).not.toMatch(/^#00000000$/i);
        expect(t.background).toHaveLength(7); // #rrggbb — no alpha channel
    });

    it("maps foreground, cursor, cursorAccent and selection from palette roles", () => {
        const t = deriveTermTheme(midnight, {});
        expect(t.foreground).toBe("#e6e9ed"); // text
        expect(t.cursor).toBe("#5e9cff"); // accent
        expect(t.cursorAccent).toBe("#0c0e11"); // bg — the glyph under a block cursor
        expect(t.selectionBackground).toBe("#1a222c"); // surfaceSelected
    });

    it("carries all 16 ANSI slots", () => {
        const t = deriveTermTheme(midnight, {}) as unknown as Record<string, string>;
        for (const slot of ANSI_SLOTS) {
            expect(t[slot], slot).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it("applies role overrides, so a custom accent reaches the cursor and ANSI blue", () => {
        const t = deriveTermTheme(midnight, { accent: "#66d9ef" });
        expect(t.cursor).toBe("#66d9ef");
        expect(t.blue).toBe("#66d9ef");
    });

    it("switching preset changes the background — this is what re-skins the live TUI", () => {
        expect(deriveTermTheme(activePalette("monokai"), {}).background).toBe("#272822");
        expect(deriveTermTheme(activePalette("midnight"), {}).background).toBe("#0c0e11");
    });
});

describe("buildThemeVars — ANSI custom properties", () => {
    it("emits all 16 --ansi-* vars, lowercase, matching deriveAnsi", () => {
        const vars = buildThemeVars(activePalette("midnight"), {});
        const ansi = deriveAnsi(activePalette("midnight")) as unknown as Record<string, string>;
        // css custom-property name -> AnsiPalette key
        const pairs: [string, string][] = [
            ["--ansi-black", "black"], ["--ansi-red", "red"], ["--ansi-green", "green"],
            ["--ansi-yellow", "yellow"], ["--ansi-blue", "blue"], ["--ansi-magenta", "magenta"],
            ["--ansi-cyan", "cyan"], ["--ansi-white", "white"],
            ["--ansi-brightblack", "brightBlack"], ["--ansi-brightred", "brightRed"],
            ["--ansi-brightgreen", "brightGreen"], ["--ansi-brightyellow", "brightYellow"],
            ["--ansi-brightblue", "brightBlue"], ["--ansi-brightmagenta", "brightMagenta"],
            ["--ansi-brightcyan", "brightCyan"], ["--ansi-brightwhite", "brightWhite"],
        ];
        for (const [cssVar, key] of pairs) {
            expect(vars[cssVar], cssVar).toBe(ansi[key]);
        }
    });

    it("the terminal and the CSS vars cannot drift — both come from one derivation", () => {
        const palette = activePalette("monokai");
        const vars = buildThemeVars(palette, {});
        const term = deriveTermTheme(palette, {});
        expect(vars["--ansi-red"]).toBe(term.red);
        expect(vars["--ansi-brightwhite"]).toBe(term.brightWhite);
    });

    it("role overrides reach the ANSI vars", () => {
        const vars = buildThemeVars(activePalette("midnight"), { error: "#ff0000" });
        expect(vars["--ansi-red"]).toBe("#ff0000");
    });
});
