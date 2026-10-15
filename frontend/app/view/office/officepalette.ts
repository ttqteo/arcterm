// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit office's scenery colours (cockpit office spec, "Drawing"): a base role per token, in work hours ("day",
// bright) and after hours ("after", muted), the rest derived by a fixed factor, and the colours every phase shares
// (the tints, the lamp, the status lights, the sign). Values live in tailwindsetup.css; this names and derives them.

import { tokenRgb, type Rgb } from "./spritecache";

export type OfficePhase = "day" | "after";

export const BASE_ROLES = [
    "ink",
    "shadow",
    "wood",
    "seam",
    "face",
    "cap",
    "trim",
    "glass",
    "tile",
    "grout",
    "carpet",
    "rug",
    "desk",
    "deskFace",
    "chair",
    "metal",
    "laptop",
    "screen",
    "sofa",
    "sofaFace",
    "leaf",
    "leafDark",
    "pot",
    "brick",
    "mortar",
] as const;
export type BaseRole = (typeof BASE_ROLES)[number];

// every name spelled in full: Tailwind 4 drops an @theme variable whose name never appears literally in source
export const PHASE_TOKENS: Record<OfficePhase, Record<BaseRole, string>> = {
    day: {
        ink: "--color-office-day-ink",
        shadow: "--color-office-day-shadow",
        wood: "--color-office-day-wood",
        seam: "--color-office-day-seam",
        face: "--color-office-day-face",
        cap: "--color-office-day-cap",
        trim: "--color-office-day-trim",
        glass: "--color-office-day-glass",
        tile: "--color-office-day-tile",
        grout: "--color-office-day-grout",
        carpet: "--color-office-day-carpet",
        rug: "--color-office-day-rug",
        desk: "--color-office-day-desk",
        deskFace: "--color-office-day-desk-face",
        chair: "--color-office-day-chair",
        metal: "--color-office-day-metal",
        laptop: "--color-office-day-laptop",
        screen: "--color-office-day-screen",
        sofa: "--color-office-day-sofa",
        sofaFace: "--color-office-day-sofa-face",
        leaf: "--color-office-day-leaf",
        leafDark: "--color-office-day-leaf-dark",
        pot: "--color-office-day-pot",
        brick: "--color-office-day-brick",
        mortar: "--color-office-day-mortar",
    },
    after: {
        ink: "--color-office-after-ink",
        shadow: "--color-office-after-shadow",
        wood: "--color-office-after-wood",
        seam: "--color-office-after-seam",
        face: "--color-office-after-face",
        cap: "--color-office-after-cap",
        trim: "--color-office-after-trim",
        glass: "--color-office-after-glass",
        tile: "--color-office-after-tile",
        grout: "--color-office-after-grout",
        carpet: "--color-office-after-carpet",
        rug: "--color-office-after-rug",
        desk: "--color-office-after-desk",
        deskFace: "--color-office-after-desk-face",
        chair: "--color-office-after-chair",
        metal: "--color-office-after-metal",
        laptop: "--color-office-after-laptop",
        screen: "--color-office-after-screen",
        sofa: "--color-office-after-sofa",
        sofaFace: "--color-office-after-sofa-face",
        leaf: "--color-office-after-leaf",
        leafDark: "--color-office-after-leaf-dark",
        pot: "--color-office-after-pot",
        brick: "--color-office-after-brick",
        mortar: "--color-office-after-mortar",
    },
};

// a plank's second tone, a knot, highlights: the prototype's factors (prototype/palette.mjs), the same in both phases
export const DERIVED = {
    wood2: ["wood", "shade", 0.96],
    knot: ["wood", "shade", 0.86],
    face2: ["face", "shade", 0.95],
    glass2: ["glass", "shade", 0.78],
    glassHi: ["glass", "lift", 0.8],
    tile2: ["tile", "shade", 0.965],
    carpet2: ["carpet", "shade", 0.93],
    rug2: ["rug", "shade", 0.87],
    deskHi: ["desk", "lift", 0.3],
    metalHi: ["metal", "lift", 0.2],
    laptopHi: ["laptop", "lift", 0.3],
    laptopOff: ["laptop", "shade", 0.75],
    sofaHi: ["sofa", "lift", 0.14],
    leafHi: ["leaf", "lift", 0.25],
    potHi: ["pot", "lift", 0.2],
    chairHi: ["chair", "lift", 0.18],
    chairShade: ["chair", "shade", 0.8],
    brick2: ["brick", "shade", 0.92],
} as const satisfies Record<string, readonly [BaseRole, "shade" | "lift", number]>;
export type DerivedRole = keyof typeof DERIVED;

// what both phases share: the tints and the lamp (the office's), the status lights a run's screen and the laptops
// show (the theme's), and the sign (the brand's)
export const SHARED_TOKENS = {
    dark: "--color-office-dark",
    night: "--color-office-night",
    lamp: "--color-office-lamp",
    cup: "--color-office-cup",
    working: "--color-working",
    asking: "--color-asking",
    error: "--color-error",
    edgeMid: "--color-edge-mid",
    accent: "--color-accent",
    accent50: "--color-accent-50",
    code: "--color-surface-code",
} as const;
export type SharedRole = keyof typeof SHARED_TOKENS;

export type OfficeRole = BaseRole | DerivedRole | SharedRole | "done";
export type OfficeColors = Partial<Record<OfficeRole, Rgb>>;

export function shadeRgb(c: Rgb, f: number): Rgb {
    const out: Rgb = [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
    if (c[3] != null) {
        out[3] = c[3];
    }
    return out;
}

export function liftRgb(c: Rgb, f: number): Rgb {
    const up = (v: number) => Math.round(v + (255 - v) * f);
    const out: Rgb = [up(c[0]), up(c[1]), up(c[2])];
    if (c[3] != null) {
        out[3] = c[3];
    }
    return out;
}

/** The scenery's colours in a phase; a role whose token does not resolve is left out (its pixels stay clear). */
export function officeColors(phase: OfficePhase, read: (token: string) => Rgb | undefined = tokenRgb): OfficeColors {
    const out: OfficeColors = {};
    for (const role of BASE_ROLES) {
        out[role] = read(PHASE_TOKENS[phase][role]);
    }
    for (const [role, [base, how, f]] of Object.entries(DERIVED) as [DerivedRole, (typeof DERIVED)[DerivedRole]][]) {
        const c = out[base];
        out[role] = c == null ? undefined : how === "shade" ? shadeRgb(c, f) : liftRgb(c, f);
    }
    for (const [role, token] of Object.entries(SHARED_TOKENS) as [SharedRole, string][]) {
        out[role] = read(token);
    }
    // a done task on a run's screen: the working green dimmed, as a done segment is elsewhere
    out.done = out.working == null ? undefined : shadeRgb(out.working, 0.62);
    return out;
}

/** Every token officeColors can read, for the probe's unresolved check (cockpit-office). */
export const OFFICE_TOKENS: string[] = [
    ...Object.values(PHASE_TOKENS.day),
    ...Object.values(PHASE_TOKENS.after),
    ...Object.values(SHARED_TOKENS),
];
