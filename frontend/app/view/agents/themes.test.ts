// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    ACCENT_SWATCHES,
    activePalette,
    applyThemeVars,
    buildThemeVars,
    CLAUDE_BRAND,
    colorOf,
    DEFAULT_THEME_PRESET,
    deriveAnsi,
    deriveTermTheme,
    panelAlpha,
    THEMES,
    type ThemePalette,
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
        "--color-rt-claude",
        "--color-rt-claude-soft",
        "--color-rt-claude-line",
    ];
    const vars = buildThemeVars(activePalette(DEFAULT_THEME_PRESET), {});
    for (const k of keys) {
        it(`${k} matches tailwindsetup.css`, () => {
            expect(vars[k]).toBeDefined();
            expect(themeLiterals(k)).toEqual([vars[k]]);
        });
    }
});

for (const id of [DEFAULT_THEME_PRESET, "graphite", "spider", "christmas"]) {
    describe(`${id} — contrast floor (DESIGN.md)`, () => {
        const p = activePalette(id);
        it("muted clears 4.5:1 on the background and on a hovered row", () => {
            expect(contrast(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(p.muted, p.surfaceHover)).toBeGreaterThanOrEqual(4.5);
        });
        it("ink-faint clears the 3:1 non-text minimum on the background", () => {
            expect(contrast(p.inkFaint, p.bg)).toBeGreaterThanOrEqual(3);
        });
    });
}

describe("christmas — text and status colours clear 4.5:1 (DESIGN.md)", () => {
    const p = activePalette("christmas");
    for (const role of ["text", "secondary", "accent", "success", "warning", "error"] as const) {
        it(`${role} on the background and on the surface`, () => {
            expect(contrast(p[role], p.bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(p[role], p.surface)).toBeGreaterThanOrEqual(4.5);
        });
    }
});

// The panel of a frosted overlay (frost class, DESIGN.md "Overlays") is --color-panel over the blurred backdrop. The
// backdrop is the worst case a terminal can put behind it: its background with its brightest colour covering 20% of
// the blur. This is the test's own statement of that rule, so panelAlpha is checked against it, not against itself.
// The blend is not rounded to bytes: that is how the plan-review numbers below were measured.
function brightestTerminalColor(p: ThemePalette): string {
    const ansi = deriveAnsi(p) as unknown as Record<string, string>;
    return [p.text, ...Object.values(ansi)].reduce((a, b) => (luminance(b) > luminance(a) ? b : a));
}
function blend(fg: number[], bg: number[], alpha: number): number[] {
    return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
}
// Muted text on the panel at `alpha`, over the blurred backdrop.
function mutedOnPanel(p: ThemePalette, alpha: number): number {
    const backdrop = blend(rgbOf(brightestTerminalColor(p)), rgbOf(p.bg), 0.2);
    return contrastRgb(rgbOf(p.muted), blend(rgbOf(p.surfaceRaised), backdrop, alpha));
}
function panelAlphaOf(p: ThemePalette): number {
    const m = /^rgba\(\d+, \d+, \d+, ([\d.]+)\)$/.exec(buildThemeVars(p, {})["--color-panel"]);
    if (!m) {
        throw new Error("--color-panel is not an rgba()");
    }
    return Number(m[1]);
}

describe("--color-panel — the panel alpha keeps muted text at 4.5:1 over the blurred backdrop", () => {
    // Measured at plan review; a different number means the rule was read differently, not that the number moved.
    const EXPECTED: Record<string, number> = {
        graphite: 0.66,
        claude: 0.66,
        midnight: 0.82,
        slate: 0.7,
        carbon: 0.72,
        nocturne: 0.8,
        spider: 0.66,
        onedark: 0.6,
        monokai: 0.6,
        christmas: 0.6,
    };
    it("the table lists every built-in theme", () => {
        expect(Object.keys(EXPECTED).sort()).toEqual(THEMES.map((t) => t.id).sort());
    });
    for (const theme of THEMES) {
        const p = theme.palette;
        it(`${theme.id}: --color-panel is ${EXPECTED[theme.id]} and muted text clears 4.5:1 on it`, () => {
            const alpha = panelAlphaOf(p);
            expect(alpha).toBe(EXPECTED[theme.id]);
            expect(mutedOnPanel(p, alpha)).toBeGreaterThanOrEqual(4.5);
        });
    }
    it("a theme that already passes at 0.6 keeps 0.6", () => {
        for (const id of ["onedark", "monokai", "christmas"]) {
            expect(mutedOnPanel(activePalette(id), 0.6), id).toBeGreaterThanOrEqual(4.5);
            expect(panelAlpha(activePalette(id)), id).toBe(0.6);
        }
    });
    it("a low-contrast palette gets a raised alpha that passes, and one step lower does not", () => {
        const p = { ...activePalette("graphite"), muted: "#888888" };
        const alpha = panelAlpha(p);
        expect(alpha).toBeGreaterThan(0.6);
        expect(alpha).toBeLessThan(1);
        expect(mutedOnPanel(p, alpha)).toBeGreaterThanOrEqual(4.5);
        expect(mutedOnPanel(p, Math.round((alpha - 0.02) * 100) / 100)).toBeLessThan(4.5);
    });
    it("steps in whole hundredths, so the alpha prints as two decimals at most", () => {
        for (const muted of ["#858585", "#888888", "#8a8a8a", "#8c8c8c"]) {
            const alpha = panelAlpha({ ...activePalette("graphite"), muted });
            expect(String(alpha), muted).toMatch(/^\d(\.\d{1,2})?$/);
        }
    });
    it("is capped at 1 when muted text cannot reach 4.5:1 at any alpha", () => {
        expect(panelAlpha({ ...activePalette("graphite"), muted: "#202020" })).toBe(1);
    });
    it("follows a role override, as the rest of buildThemeVars does", () => {
        const vars = buildThemeVars(activePalette("graphite"), { accent: "#66d9ef" });
        expect(vars["--color-panel"]).toBe(
            `rgba(28, 28, 28, ${panelAlpha({ ...activePalette("graphite"), accent: "#66d9ef" })})`
        );
    });
});

describe("the Claude runtime mark", () => {
    it("is the brand clay in a theme that does not tint it, the same as the provider dot", () => {
        const vars = buildThemeVars(activePalette("graphite"), {});
        expect(vars["--color-rt-claude"]).toBe(CLAUDE_BRAND);
        expect(vars["--color-rt-claude-line"]).toBe("rgba(217, 119, 87, 0.34)");
        expect(themeLiterals("--color-provider-claude")).toEqual([CLAUDE_BRAND]);
    });
    it("is not the accent in the Claude theme, whose accent is that clay", () => {
        const vars = buildThemeVars(activePalette("claude"), {});
        expect(vars["--color-accent"]).toBe(CLAUDE_BRAND);
        expect(vars["--color-rt-claude"]).not.toBe(vars["--color-accent"]);
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
    it("THEMES ships the ten dark presets — light mode was declined and removed", () => {
        expect(THEMES).toHaveLength(10);
        expect(THEMES[0].id).toBe(DEFAULT_THEME_PRESET);
    });
    it("Spider is Claude's palette with the suit's blue accent, a pinker error and the suit's blue", () => {
        const claude = activePalette("claude");
        const spider = activePalette("spider");
        const { accent, error, claudeMark, ansiBlue, ...rest } = spider;
        const { accent: _a, error: _e, claudeMark: _m, ansiBlue: _b, ...claudeRest } = claude;
        expect(rest).toEqual(claudeRest);
        expect(accent).toBe("#7a9ce6");
        expect(error).toBe("#ff6b9a");
        expect(ansiBlue).toBe("#5b8cf0");
        expect(claudeMark).toBeUndefined();
    });
    it("ACCENT_SWATCHES has 10 hex values", () => {
        expect(ACCENT_SWATCHES).toHaveLength(10);
        expect(ACCENT_SWATCHES[0]).toBe(activePalette(DEFAULT_THEME_PRESET).accent);
    });
    it("applyThemeVars sets each var on the root style", () => {
        const set: Record<string, string> = {};
        const root = { style: { setProperty: (k: string, v: string) => (set[k] = v) } };
        applyThemeVars(root as unknown as HTMLElement, { "--color-accent": "#abc" });
        expect(set["--color-accent"]).toBe("#abc");
    });
});

// --- ANSI derivation -----------------------------------------------------------------------------
// Contrast per WCAG 2.1 relative luminance. The test keeps its own copy, apart from the one panelAlpha uses in
// themes.ts, so the panel alpha is judged by a second implementation of the formula.
function channel(c: number): number {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function rgbOf(hex: string): number[] {
    const s = hex.replace("#", "");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function luminanceRgb([r, g, b]: number[]): number {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastRgb(a: number[], b: number[]): number {
    const la = luminanceRgb(a);
    const lb = luminanceRgb(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function luminance(hex: string): number {
    return luminanceRgb(rgbOf(hex));
}
function contrast(a: string, b: string): number {
    return contrastRgb(rgbOf(a), rgbOf(b));
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

    it("a theme's ansiBlue keeps ANSI blue a blue when its accent is not one", () => {
        const t = deriveTermTheme(activePalette("claude"), {});
        expect(t.cursor).toBe("#d97757");
        expect(t.blue).toBe("#6a9bcc");
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
