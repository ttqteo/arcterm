# Cockpit office in pixel art: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-15-cockpit-office-design.md`: read **Drawing**, **Motion**, **Benchmark**,
**Files** and **Verify** first. The office itself (layout, behaviour, boss, keys, popup) is built and stays as it is;
this plan redraws it.

**Verify:** `node scripts/verify.mjs ./pkg/memgate`

**Check:** `node --max-old-space-size=4096 --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs cockpit-office cockpit-office-bench surface-smoke`

**Prototype:** .superpowers/design/cockpit-office-pixel/project

**Goal:** the Cockpit's Office drawn as GBA-style pixel art seen from above (outlines, drop shadows, furniture with a
top and a front, a wall face with windows, chibi people told apart by their hair), bright in work hours and muted
after hours, with its static building on two canvases instead of ~259 DOM nodes.

**Architecture:** frontend only: no Go, no wshrpc. Pure modules decide everything and carry the tests:
`officepalette.ts` (the scenery's colour roles per phase, read from tokens), `officegrids.ts` (the chair grid the
scenery and the people share), `plansprite.ts` (the chibi grids, a sprite in an outfit, a phase and a shade),
`scenery.ts` (plan → the two canvases' draw lists, `rasterise`, `sceneryKey`). `cockpitoffice.tsx` paints the two
canvases at art resolution only when `sceneryKey` changes, and keeps in the DOM only people, labels, bubbles,
transparent buttons, movers and the card.

**Tech stack:** React 19, jotai, Tailwind 4 `@theme` tokens, a 2D canvas, vitest, the CDP scenario harness
(headless Chrome on a Mac through `final-verify.mjs`).

**The prototype is the reference for every pixel.** `.superpowers/design/cockpit-office-pixel/prototype/`
(gitignored, absolute path; a run's worktree has no copy): `sprites.mjs` holds the people's grids, `palette.mjs` every
colour, `scene.mjs` what each canvas draws and in which order. Its `README.md` rebuilds the canvas. Port from it; when
this plan and the prototype disagree on a pixel, the prototype wins, since the canvas the final verifier reads was
drawn by it.

The Verify line names one small Go package only because `verify.mjs` needs a pattern; this plan changes no Go. Its
final stage runs vitest.

## Global Constraints

- No raw hex or rgba in `.ts`/`.tsx`: every colour is a `--color-*` token in `frontend/tailwindsetup.css` `@theme`,
  read by `tokenRgb` for the canvases and sprites. Every token name is spelled in full in source (Tailwind 4 drops an
  `@theme` variable whose name never appears literally).
- The layout does not change: `officeplanmodel.ts` keeps its rooms, desks (120 px apart, rows 130 px apart), seats,
  tables and doors. Only the lounge's person sizes and its two standing spots move (Task 2).
- 1 art px = 3 CSS px (`PLAN_CELL`). The canvases are `ceil(width / 3) × ceil(height / 3)` and scaled 3× with
  `image-rendering: pixelated`; never draw them at screen resolution.
- The canvases redraw only when `sceneryKey` changes; never on the frame clock (`officeTickAtom`), a walk step
  (`useDomTransform`, `bossAtom`, `walkersAtom`) or a pose. Commit e6e1811bb took walking out of React: a walk step
  writes a transform on the DOM and renders nothing. Keep it so.
- The Run office in Jarvis (`view/jarvis/office*`) and its tokens (`--color-office-hair-*`, `--color-office-ink`, …)
  do not change.
- Never run prettier on `scripts/*.mjs` (hand-formatted, 4-space). Check only files you touched; never `--write`.
- No jsdom/render tests: pure logic in a `.ts` with a `.test.ts` beside it; the UI is verified by the CDP scenarios.
- Comments say why, lowercase, minimal. Copy is sentence case.
- Budgets (spec "Benchmark"), verbatim: JS heap Office minus Cards ≤ 5 MB; DOM nodes added ≤ 2,000; main thread busy
  over the 30 s hold minus the Cards baseline ≤ 2 %; same under reduced motion ≤ 0.5 %; same in a quiet office ≤
  0.3 %; sprite cache entries ≤ 600; heap a second Office round trip adds ≤ 1 MB; toggle click to the office drawn ≤
  150 ms. A miss is reported, never fixed by raising a budget.
- A bench writes `public/cockpit-fixtures/active.json`, which other sessions in the main checkout share: run it only
  in a worktree, on its own `ARC_BROWSER_CDP_PORT`, `ARC_BROWSER_VITE_PORT` and `ARC_DEV_DATA_DIR`.
- Out of scope: the Run office's look, parts 2–4 of the spec, moving walking to `el.animate()`.

## Review Focus

- **A theme switch, with the office open or away.** A run's screen, the laptops' lights, the bubbles and the boss's
  ring use status tokens; after the switch they show the new theme's colours, with no stale cached colour, whether the
  theme changed while the office was open or while it was unmounted (Cards, another surface). Pinned in Task 1
  (`clearTokenColors`, `clearSprites`), Task 3 (`sceneryKey` carries the theme), Task 4 (`useThemeEpoch`, its last
  theme kept at module level) and Task 5 (step 13c switches the theme with the office open, step 15b while it is in
  Cards).
- **A width that is not a multiple of 3** (the office is as wide as the Cockpit; 1001 px, or `MIN_W` 900): the
  canvases cover the whole plan, the right outer wall is drawn, nothing is cut. Pinned in Task 3.
- **Work hours ending while the office is open:** one redraw, the plates leave the labels, and a near-side seat
  re-shades. Pinned in Task 3 (the key), Task 4 (one draw counted per scene, not per canvas) and Task 5 (step 9b counts
  the draws).
- **A near-side worker who asks:** it raises its hand facing you over the table (z 3, over the over canvas, shaded
  with its room), its bubble beside its head. The prototype puts a near seat that is not `back` under the over canvas,
  but never drew one (its fixture has no asking task), and there the table would cover an asking face, the one thing
  that must stand out; so the plan keeps it at z 3. Pinned in Task 4 (placement) and seen in Task 5's step 1c
  (`cockpit-office-near-ask.png`: `Main`'s runs with Billing export's task 3 asking; the canvas's boards have no such
  worker).
- **A crowded lounge:** with the chibi's taller standing sprite, no lounge person overlaps `+N in the lounge` or
  another spot's label. Pinned in Task 2 (the model's existing lounge test, with the new sizes) and seen in Task 5's
  step 14b.
- **The open time measures the building.** The bench's row 8 stops when the desks are in and each canvas has painted
  (`canvas[data-office-drawn]`), not at the first desk. Pinned in Task 4 (the attribute) and Task 5 (step 7).

---

### Task 1: Tokens, the palette and colours with alpha
**Depends on:** none
**Files:** `frontend/tailwindsetup.css`, `frontend/app/view/office/officepalette.ts`, `frontend/app/view/office/officepalette.test.ts`, `frontend/app/view/office/officegrids.ts`, `frontend/app/view/office/spritecache.ts`, `frontend/app/view/office/spritecache.test.ts`

**Interfaces:**
- Produces (`officepalette.ts`): `type OfficePhase = "day" | "after"`; `BASE_ROLES` (readonly tuple) and
  `type BaseRole`; `PHASE_TOKENS: Record<OfficePhase, Record<BaseRole, string>>`; `DERIVED` and
  `type DerivedRole`; `SHARED_TOKENS` and `type SharedRole`; `type OfficeRole = BaseRole | DerivedRole | SharedRole |
  "done"`; `type OfficeColors = Partial<Record<OfficeRole, Rgb>>`; `shadeRgb(c: Rgb, f: number): Rgb`;
  `liftRgb(c: Rgb, f: number): Rgb`; `officeColors(phase: OfficePhase, read?: (token: string) => Rgb | undefined):
  OfficeColors`; `OFFICE_TOKENS: string[]`.
- Produces (`officegrids.ts`): `NEAR_CHAIR: string[]` (14 × 6, codes `O R r .`).
- Produces (`spritecache.ts`): `type Rgb = [number, number, number, number?]` (the 4th is alpha 0..1, absent = 1);
  `parseColor` keeps an rgba alpha below 1; `gridPixels` writes it; `clearTokenColors(): void`;
  `clearSprites(ns: string): void`. Everything else unchanged (the Run office keeps working: none of its tokens has
  an alpha).

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/office/officepalette.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
    BASE_ROLES,
    DERIVED,
    liftRgb,
    OFFICE_TOKENS,
    officeColors,
    PHASE_TOKENS,
    shadeRgb,
    type OfficePhase,
} from "./officepalette";

const css = fs.readFileSync(new URL("../../../tailwindsetup.css", import.meta.url), "utf8");
const PHASES: OfficePhase[] = ["day", "after"];

describe("officepalette", () => {
    it("names a declared token for every base role in both phases", () => {
        for (const phase of PHASES) {
            for (const role of BASE_ROLES) {
                const t = PHASE_TOKENS[phase][role];
                expect(t, `${phase} ${role}`).toMatch(new RegExp(`^--color-office-${phase}-[a-z-]+$`));
                expect(css.includes(`${t}:`), t).toBe(true);
            }
        }
    });

    it("declares every token it reads", () => {
        for (const t of OFFICE_TOKENS) {
            expect(css.includes(`${t}:`), t).toBe(true);
        }
    });

    it("reads each phase's own tokens", () => {
        const read = (t: string) => (t.includes("-after-") ? [1, 1, 1] : [2, 2, 2]) as [number, number, number];
        expect(officeColors("after", read).wood).toEqual([1, 1, 1]);
        expect(officeColors("day", read).wood).toEqual([2, 2, 2]);
    });

    it("derives a role from its base by its factor, and done from working", () => {
        const read = () => [100, 100, 100] as [number, number, number];
        const c = officeColors("day", read);
        for (const [role, [base, how, f]] of Object.entries(DERIVED)) {
            const want = how === "shade" ? shadeRgb(c[base]!, f) : liftRgb(c[base]!, f);
            expect(c[role as keyof typeof c], role).toEqual(want);
        }
        expect(c.done).toEqual(shadeRgb([100, 100, 100], 0.62));
    });

    it("keeps a colour's alpha through a shade and a lift", () => {
        expect(shadeRgb([10, 20, 30, 0.5], 0.5)).toEqual([5, 10, 15, 0.5]);
        expect(liftRgb([0, 0, 0, 0.25], 0.5)).toEqual([128, 128, 128, 0.25]);
    });

    it("leaves a role out when its token does not resolve", () => {
        const c = officeColors("day", () => undefined);
        expect(c.wood).toBeUndefined();
        expect(c.wood2).toBeUndefined();
    });
});
```

In `frontend/app/view/office/spritecache.test.ts`, replace the colour test and add two:

```ts
    it("reads hex and rgb colours, an alpha below 1, and nothing else", () => {
        expect(parseColor(" #0a0b0c ")).toEqual([10, 11, 12]);
        expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
        expect(parseColor("rgba(4, 5, 6, 0.5)")).toEqual([4, 5, 6, 0.5]);
        expect(parseColor("rgba(4, 5, 6, 1)")).toEqual([4, 5, 6]);
        expect(parseColor("red")).toBeUndefined();
    });

    it("writes a colour's alpha", () => {
        const px = gridPixels(["A"], 1, () => [1, 2, 3, 0.5]);
        expect(Array.from(px)).toEqual([1, 2, 3, 128]);
    });

    it("reads a token again after the colours are cleared, and empties a namespace", () => {
        let value = "#010203";
        vi.stubGlobal("document", { documentElement: {}, createElement: () => ({ getContext: () => null }) });
        vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => value }));
        expect(tokenRgb("--t-clear")).toEqual([1, 2, 3]);
        value = "#040506";
        expect(tokenRgb("--t-clear")).toEqual([1, 2, 3]);
        clearTokenColors();
        expect(tokenRgb("--t-clear")).toEqual([4, 5, 6]);
        cachedSprite("t3", "a", ["A"], 1, () => [255, 255, 255]);
        clearSprites("t3");
        expect(spriteCacheStats("t3").entries).toBe(0);
    });
```

and extend its import to `cachedSprite, clearSprites, clearTokenColors, gridPixels, parseColor, spriteCacheStats, tokenRgb`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/office/officepalette.test.ts frontend/app/view/office/spritecache.test.ts`
Expected: FAIL (`officepalette` does not exist; `clearTokenColors` is not exported; the rgba alpha is dropped).

- [ ] **Step 3: Add the tokens**

In `frontend/tailwindsetup.css`, under the cockpit office's block (after `--shadow-office-lamp`), add (values from the
prototype's `palette.mjs`; keep the old office tokens for now, Task 4 removes them):

```css
    /* The cockpit office in pixel art (docs/superpowers/specs/2026-10-15-cockpit-office-design.md, "Drawing"): the
       scenery's base colours in work hours (bright) and after hours (muted, the dark cockpit's), read by
       view/office/officepalette.ts for the two canvases; their highlights and second tones are fixed factors there.
       Scenery, like the people: every theme keeps these values. */
    --color-office-day-ink: #26222e;
    --color-office-day-shadow: rgba(38, 34, 46, 0.22);
    --color-office-day-wood: #cc9c6a;
    --color-office-day-seam: #946640;
    --color-office-day-face: #e2e6e9;
    --color-office-day-cap: #a39a8f;
    --color-office-day-trim: #8a5a3a;
    --color-office-day-glass: #8cc2ee;
    --color-office-day-tile: #d6d0c6;
    --color-office-day-grout: #b9b1a5;
    --color-office-day-carpet: #a7b2bd;
    --color-office-day-rug: #7d9e98;
    --color-office-day-desk: #d9ad78;
    --color-office-day-desk-face: #7a5236;
    --color-office-day-chair: #5a647c;
    --color-office-day-metal: #4a4f5e;
    --color-office-day-laptop: #b4bac4;
    --color-office-day-screen: #1f2433;
    --color-office-day-sofa: #b05a4e;
    --color-office-day-sofa-face: #86423a;
    --color-office-day-leaf: #6faa4c;
    --color-office-day-leaf-dark: #3e7a36;
    --color-office-day-pot: #b4643e;
    --color-office-day-brick: #a85a42;
    --color-office-day-mortar: #7a3e2e;
    --color-office-after-ink: #121115;
    --color-office-after-shadow: rgba(0, 0, 0, 0.28);
    --color-office-after-wood: #46372b;
    --color-office-after-seam: #2c221b;
    --color-office-after-face: #5d5a55;
    --color-office-after-cap: #7d776e;
    --color-office-after-trim: #3a2c22;
    --color-office-after-glass: #1f2536;
    --color-office-after-tile: #33322f;
    --color-office-after-grout: #272624;
    --color-office-after-carpet: #363a40;
    --color-office-after-rug: #3d4a48;
    --color-office-after-desk: #7e6a55;
    --color-office-after-desk-face: #4a3c30;
    --color-office-after-chair: #3e4352;
    --color-office-after-metal: #3a3d47;
    --color-office-after-laptop: #6e727c;
    --color-office-after-screen: #161922;
    --color-office-after-sofa: #6c4844;
    --color-office-after-sofa-face: #4f3431;
    --color-office-after-leaf: #4b6a3c;
    --color-office-after-leaf-dark: #2f4528;
    --color-office-after-pot: #7a4a33;
    --color-office-after-brick: #5a3a31;
    --color-office-after-mortar: #3f2822;
    /* the plan's hair: a step lighter than the run office's, so the chibi's dark outline shows around it */
    --color-office-plan-hair-1: #4a3426;
    --color-office-plan-hair-2: #7a4a2a;
    --color-office-plan-hair-3: #3b3d4a;
    --color-office-plan-hair-4: #b0603a;
    /* under a label in work hours: the floor is light, the labels' ink is not */
    --color-office-plate: rgba(31, 30, 29, 0.82);
```

- [ ] **Step 4: Write `officegrids.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Grids the office's scenery and its people share, pixel for pixel (cockpit office spec, "Drawing"). The near side's
// chair: the over canvas draws it at every near-side seat, and a near-side person's sprite ends with the same rows,
// so the chair's back covers the person and an empty chair still shows. O outline, R chair, r its shade.

export const NEAR_CHAIR = [
    ".OOOOOOOOOOOO.",
    ".ORRRRRRRRRRO.",
    ".ORRRRRRRRRRO.",
    ".OrrrrrrrrrrO.",
    ".OOOOOOOOOOOO.",
    "..O........O..",
];
```

- [ ] **Step 5: Write `officepalette.ts`**

```ts
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
```

- [ ] **Step 6: Colours with alpha in `spritecache.ts`**

Change the type and the three functions, and add the two clears (keep the file's other code):

```ts
// alpha 0..1 as the 4th, absent when opaque: the office's shadows and tints are translucent tokens
export type Rgb = [number, number, number, number?];

/** A computed custom property's value ("#rrggbb", "rgb(r, g, b)" or "rgba(r, g, b, a)") as bytes; else undefined. */
export function parseColor(value: string): Rgb | undefined {
    const v = value.trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i.exec(v);
    if (!rgb) {
        return undefined;
    }
    const out: Rgb = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    const a = rgb[4] == null ? 1 : Number(rgb[4]);
    if (a < 1) {
        out[3] = a;
    }
    return out;
}

/** Forgets every colour tokenRgb read: a theme change re-skins the status tokens the office draws with. */
export function clearTokenColors(): void {
    colors.clear();
}

/** Drops a namespace's sprites, so they draw again with the colours of now. */
export function clearSprites(ns: string): void {
    caches.get(ns)?.clear();
}
```

and in `gridPixels` write the alpha: `out[i + 3] = Math.round(255 * (rgb[3] ?? 1));` in place of `out[i + 3] = 255;`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run frontend/app/view/office/ frontend/app/view/jarvis/`
Expected: PASS (the Run office's sprite tests included).

- [ ] **Step 8: Commit**

```bash
git add frontend/tailwindsetup.css frontend/app/view/office/officepalette.ts frontend/app/view/office/officepalette.test.ts frontend/app/view/office/officegrids.ts frontend/app/view/office/spritecache.ts frontend/app/view/office/spritecache.test.ts
git commit -m "feat(cockpit): the office's pixel palette: a token per scenery role in work hours and after hours, derived tones, colours with alpha"
```

---

### Task 2: The chibi people, and the lounge's sizes
**Depends on:** Task 1
**Files:** `frontend/app/view/office/plansprite.ts`, `frontend/app/view/office/plansprite.test.ts`, `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`

**Interfaces:**
- Consumes: `OfficePhase`, `PHASE_TOKENS`, `shadeRgb`, `liftRgb` (`officepalette.ts`); `NEAR_CHAIR`
  (`officegrids.ts`); `cachedSprite`, `tokenRgb`, `type Rgb` (`spritecache.ts`).
- Produces (`plansprite.ts`): `type PlanSprite` = today's 18 plus `"backseat"` and `"stand"`; `type PlanLook = 1 |
  2 | 3 | 4 | "boss"`; `type Shade = "" | "dark" | "night" | "both"`; `type PlanMark = "!" | "?" | "×" | "ring"`;
  constants `PLAN_W = 14`, `ARM_W = 20`, `ARM_PAD = 3`, `PLAN_CELL = 3`, `PLAN_CACHE_CAP = 600`;
  `planGrid(s: PlanSprite, look: PlanLook): string[]`; `PLAN_SPRITES: Record<PlanSprite, string[]>` (look 1, for
  sizes); `spriteWidth(s): number` (20 for the raised arms, else 14); `spriteLeft(s): number` (−`ARM_PAD` for the
  20-wide, else 0: from a 14-wide person's left edge, in art px); `MARKS: Record<PlanMark, string[]>`;
  `planColor(code: string, o: PlanOutfit, phase: OfficePhase, read?): Rgb | undefined`;
  `planSpriteUrl(s: PlanSprite, o: PlanOutfit, phase: OfficePhase, shade?: Shade): string`;
  `markUrl(m: PlanMark, phase: OfficePhase): string`; `SHEET_POSES: PlanSprite[]` (the Cast board's 18 columns);
  `BOSS_POSES: PlanSprite[]` (its boss row, 8); `SHEET_SHIRTS: string[]` (claude, codex, pi, agy shirt tokens);
  `PLAN_TOKENS: string[]`. Unchanged: `PlanOutfit`, `SeatPose`, `WalkDir`, `seatSprite`, `walkSprite`, `mirrorOf`,
  `shirtOf`, `HARNESS_SHIRT`, `OTHER_SHIRT`, `LEAD_SHIRT`, `BOSS_SHIRT`, `LANE_SHIRTS`. `planToken` goes.
- Produces (`officeplanmodel.ts`): `LOUNGE_PERSON_W = 42`; the lounge's standing spots stand 12 px lower.

Heights, in rows: `sit` `nod` `doze` `yawn` 17; `back` 15; `backseat` 19; `hand1` `hand2` `cheer1` `cheer2`
`stretch` 20 (20 wide); `cup` `stand` `down1` `down2` `up1` `up2` `side1` `side2` `boss` 23.

**Shown by:** `cockpit-office` step 1 (`cockpit-office-main.png`: the chibi people at their desks), steps 13 and 13b
(`cockpit-office-states.png`, `cockpit-office-states-night.png`: every pose in every look, by day and after hours) and
step 14b (`cockpit-office-lounge.png`: the crowded lounge at the chibi's sizes). Steps 13, 13b and 14b read what
Tasks 4 and 5 build, so they pass only once those land; this task's own check is its vitest.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/app/view/office/plansprite.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { NEAR_CHAIR } from "./officegrids";
import {
    ARM_PAD,
    BOSS_POSES,
    MARKS,
    markUrl,
    mirrorOf,
    PLAN_SPRITES,
    planColor,
    planGrid,
    planSpriteUrl,
    seatSprite,
    SHEET_POSES,
    shirtOf,
    spriteLeft,
    spriteWidth,
    walkSprite,
    type PlanLook,
    type PlanSprite,
} from "./plansprite";
import { clearSprites, spriteCacheStats } from "./spritecache";

const ALL = Object.keys(PLAN_SPRITES) as PlanSprite[];
const LOOKS: PlanLook[] = [1, 2, 3, 4, "boss"];
const ARMS: PlanSprite[] = ["hand1", "hand2", "cheer1", "cheer2", "stretch"];
const HEIGHT: Record<PlanSprite, number> = {
    sit: 17,
    nod: 17,
    doze: 17,
    yawn: 17,
    back: 15,
    backseat: 19,
    hand1: 20,
    hand2: 20,
    cheer1: 20,
    cheer2: 20,
    stretch: 20,
    cup: 23,
    stand: 23,
    down1: 23,
    down2: 23,
    up1: 23,
    up2: 23,
    side1: 23,
    side2: 23,
    boss: 23,
};

describe("plansprite", () => {
    it("has the twenty sprites the canvas's Cast board draws", () => {
        expect(ALL.sort()).toEqual((Object.keys(HEIGHT) as PlanSprite[]).sort());
        expect(SHEET_POSES).toHaveLength(18);
        expect(BOSS_POSES).toHaveLength(8);
    });

    it("draws every sprite in every look at its size, with known codes only", () => {
        for (const look of LOOKS) {
            for (const s of ALL) {
                const g = planGrid(s, look);
                expect(g.length, `${s} ${look}`).toBe(HEIGHT[s]);
                for (const row of g) {
                    expect(row.length, `${s} ${look}`).toBe(spriteWidth(s));
                    expect(row, `${s} ${look}`).toMatch(/^[OHhSsETtPpKCBWRr_.]+$/);
                }
            }
        }
    });

    it("raises arms 20 wide, placed ARM_PAD to the left; everything else is 14 wide", () => {
        for (const s of ALL) {
            expect(spriteWidth(s), s).toBe(ARMS.includes(s) ? 20 : 14);
            expect(spriteLeft(s), s).toBe(ARMS.includes(s) ? -ARM_PAD : 0);
        }
    });

    it("ends a near-side seat with the chair the over canvas draws", () => {
        for (const look of LOOKS) {
            expect(planGrid("backseat", look).slice(-NEAR_CHAIR.length)).toEqual(NEAR_CHAIR);
        }
    });

    it("tells the looks apart by the head, and gives the boss alone a cap", () => {
        const heads = LOOKS.map((l) => planGrid("sit", l).slice(0, 11).join("\n"));
        expect(new Set(heads).size).toBe(5);
        for (const l of [1, 2, 3, 4] as PlanLook[]) {
            expect(planGrid("stand", l).join("")).not.toContain("B");
        }
        expect(planGrid("boss", "boss").join("")).toContain("B");
    });

    it("draws the bubbles and the ring", () => {
        for (const m of ["!", "?", "×"] as const) {
            expect(MARKS[m]).toHaveLength(9);
            for (const row of MARKS[m]) expect(row).toMatch(/^[OFM.]{9}$/);
        }
        expect(MARKS.ring[0]).toHaveLength(14);
    });

    it("colours a role from the phase, the look and the outfit", () => {
        const read = (t: string) => {
            const n = t.length; // a different colour per token, the same each time
            return [n, n + 1, n + 2] as [number, number, number];
        };
        const o = { shirt: "--color-office-shirt-pi", look: 2 };
        const day = planColor("O", o, "day", read);
        const after = planColor("O", o, "after", read);
        expect(day).toEqual(read("--color-office-day-ink"));
        expect(after).toEqual(read("--color-office-after-ink"));
        expect(planColor("H", o, "day", read)).toEqual(read("--color-office-plan-hair-2"));
        expect(planColor("T", o, "day", read)).toEqual(read("--color-office-shirt-pi"));
        expect(planColor("R", o, "after", read)).toEqual(read("--color-office-after-chair"));
        expect(planColor("_", o, "day", read)).toEqual(read("--color-office-day-shadow"));
        expect(planColor(".", o, "day", read)).toBeUndefined();
    });

    it("keys a sprite and a bubble by the phase, and a sprite by its shade", () => {
        vi.stubGlobal("document", { documentElement: {}, createElement: () => ({ getContext: () => null }) });
        vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#010203" }));
        clearSprites("plan");
        const o = { shirt: "--color-office-shirt-pi", look: 2 };
        planSpriteUrl("backseat", o, "day");
        planSpriteUrl("backseat", o, "after");
        planSpriteUrl("backseat", o, "day", "dark");
        planSpriteUrl("backseat", o, "day", "night");
        planSpriteUrl("backseat", o, "day", "both");
        planSpriteUrl("backseat", o, "day"); // the same as the first: no new entry
        markUrl("!", "day");
        markUrl("!", "after");
        expect(spriteCacheStats("plan").entries).toBe(7);
        clearSprites("plan");
        vi.unstubAllGlobals();
    });

    it("maps seated poses and walks to sprites", () => {
        expect(seatSprite("sit", 0)).toBe("sit");
        expect(seatSprite("sit", 1)).toBe("nod");
        expect(seatSprite("hand", 1)).toBe("hand2");
        expect(seatSprite("cheer", 0)).toBe("cheer1");
        expect(seatSprite("empty", 0)).toBeUndefined();
        expect(walkSprite("up", 1)).toBe("up2");
        expect(walkSprite("left", 0)).toBe("side1");
        expect(mirrorOf("left")).toBe(true);
        expect(mirrorOf("right")).toBe(false);
    });

    it("dresses a harness in its shirt, anything else in the other one", () => {
        expect(shirtOf("codex")).toBe("--color-office-shirt-codex");
        expect(shirtOf("opencode")).toBe("--color-office-shirt-other");
        expect(shirtOf(undefined)).toBe("--color-office-shirt-other");
    });
});
```

In `frontend/app/view/agents/officeplanmodel.test.ts`, the lounge's test "draws a person as wide and as tall as the
model says" (around line 338) takes the chibi's sizes, and a second test pins every lounger's box to its sprite:

```ts
        it("draws a person as wide and as tall as the model says", () => {
            expect(spriteWidth("cup") * PLAN_CELL).toBe(LOUNGE_PERSON_W);
            expect(PLAN_SPRITES.cup.length * PLAN_CELL).toBe(69);
            expect(PLAN_SPRITES.back.length * PLAN_CELL).toBe(45);
        });

        it("sizes every lounger's box as its sprite", () => {
            const p = build(20);
            for (const l of p.loungers) {
                const sprite = l.at === "sofa" ? "back" : "cup";
                expect(l.box.h, l.agentId).toBe(PLAN_SPRITES[sprite].length * PLAN_CELL);
                expect(l.box.w, l.agentId).toBe(LOUNGE_PERSON_W);
            }
        });
```

(`build` is the lounge tests' own helper, just above; the test's imports already hold `spriteWidth`, `PLAN_CELL`,
`PLAN_SPRITES` and `LOUNGE_PERSON_W`.) The existing "keeps n people's sprites and labels inside the lounge and clear
of each other" tests then check the taller sprites against `+N in the lounge`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/office/plansprite.test.ts frontend/app/view/agents/officeplanmodel.test.ts`
Expected: FAIL (`planGrid`, `MARKS`, `spriteLeft` do not exist; the lounge sizes are 36/36/57).

- [ ] **Step 3: Port the grids**

In `plansprite.ts`, replace today's grids (`HEAD` … `SIDE_TOP`, `closed`, the `PLAN_SPRITES` literal) with the
prototype's, copied verbatim from
`.superpowers/design/cockpit-office-pixel/prototype/sprites.mjs`, typed:

- lines 6–208: `FRONT`, `BACK`, `SIDE` as `Record<PlanLook, string[]>`;
- lines 211–216: `shut` and `yawning` (simplify `shut`'s condition to `i === 7`);
- lines 218–241: `SIT`, `SIT_NOARM_R`, `SIT_NOARMS`;
- lines 244–273: `pad`, `arm` (typed `(rows: string[], side: "r" | "l", wave: boolean): string[]`), `UP3`;
- lines 274 and 277–329: `BACK_TORSO`, `STAND`, `STAND_TIE`, `STAND_CUP`, `STAND_BACK`, `LEGS`, `LEGS_A`,
  `LEGS_B`, `SIDE_BODY`, `SIDE_BODY_B`, `SIDE_LEGS_A`, `SIDE_LEGS_B`, `blank`;
- `NEAR_CHAIR` is imported from `./officegrids`, not copied (line 276 is the same grid).

Then, in place of the prototype's `poses` (lines 335–361), a memoised builder with the same entries:

```ts
function build(look: PlanLook): Record<PlanSprite, string[]> {
    const F = FRONT[look];
    const B = BACK[look];
    const Sd = SIDE[look];
    const torso = look === "boss" ? STAND_TIE : STAND;
    return {
        sit: [...F, ...SIT],
        nod: [...blank, ...F, ...SIT.slice(0, 5)],
        hand1: arm([...UP3, ...pad([...F, ...SIT_NOARM_R])], "r", false),
        hand2: arm([...UP3, ...pad([...F, ...SIT_NOARM_R])], "r", true),
        cheer1: arm(arm([...UP3, ...pad([...F, ...SIT_NOARMS])], "r", false), "l", false),
        // the second frame a row higher: a little hop
        cheer2: arm(arm([...UP3, ...pad([...F, ...SIT_NOARMS.slice(0, 5)]), ".".repeat(ARM_W)], "r", true), "l", true),
        doze: [...shut(F), ...SIT],
        yawn: [...yawning(F), ...SIT],
        stretch: arm(arm([...UP3, ...pad([...yawning(F), ...SIT_NOARMS])], "r", false), "l", false),
        back: [...B, ...BACK_TORSO],
        backseat: [...B, ...BACK_TORSO.slice(0, 2), ...NEAR_CHAIR],
        cup: [...F, ...STAND_CUP, ...LEGS],
        stand: [...F, ...torso, ...LEGS],
        down1: [...F, ...torso, ...LEGS_A],
        down2: [...F, ...torso, ...LEGS_B],
        up1: [...B, ...STAND_BACK, ...LEGS_A],
        up2: [...B, ...STAND_BACK, ...LEGS_B],
        side1: [...Sd, ...SIDE_BODY, ...SIDE_LEGS_A],
        side2: [...Sd, ...SIDE_BODY_B, ...SIDE_LEGS_B],
        boss: [...B, ...STAND_BACK, ...LEGS],
    };
}
const built = new Map<PlanLook, Record<PlanSprite, string[]>>();
export function planGrid(s: PlanSprite, look: PlanLook): string[] {
    let set = built.get(look);
    if (set == null) {
        set = build(look);
        built.set(look, set);
    }
    return set[s];
}
// look 1's grids: every look has the same sizes (a test pins it), so these answer the sizes and the pose sheet
export const PLAN_SPRITES: Record<PlanSprite, string[]> = build(1);

export function spriteWidth(s: PlanSprite): number {
    return PLAN_SPRITES[s][0].length;
}
export function spriteLeft(s: PlanSprite): number {
    return spriteWidth(s) === ARM_W ? -ARM_PAD : 0;
}
```

with the head comment updated (14 columns, the chibi set, role codes `O H h S s E T t P p K C B W R r _`) and:

```ts
export type PlanSprite = "sit" | "nod" | "hand1" | "hand2" | "cheer1" | "cheer2" | "doze" | "yawn" | "stretch"
    | "back" | "backseat" | "cup" | "stand" | "down1" | "down2" | "up1" | "up2" | "side1" | "side2" | "boss";
export type PlanLook = 1 | 2 | 3 | 4 | "boss";
export type Shade = "" | "dark" | "night" | "both";
export const PLAN_W = 14;
export const ARM_W = 20;
export const ARM_PAD = 3;
```

(`PLAN_CELL = 3` and `PLAN_CACHE_CAP = 600` stay; `SIDE_W` goes.)

- [ ] **Step 4: Bubbles, the ring and the sheet's lists**

```ts
export type PlanMark = "!" | "?" | "×" | "ring";
// O outline (the phase's ink), F fill (asking, or error for ×), M the mark (ink), A the boss's ring (the accent)
export const MARKS: Record<PlanMark, string[]> = {
    "!": [".OOOOOOO.", "OFFFMFFFO", "OFFFMFFFO", "OFFFMFFFO", "OFFFFFFFO", "OFFFMFFFO", ".OOOOOOO.", "..OO.....", "..O......"],
    "?": [".OOOOOOO.", "OFFMMMFFO", "OFFFFMFFO", "OFFFMMFFO", "OFFFFFFFO", "OFFFMFFFO", ".OOOOOOO.", "..OO.....", "..O......"],
    "×": [".OOOOOOO.", "OFMFFFMFO", "OFFMFMFFO", "OFFFMFFFO", "OFFMFMFFO", "OFMFFFMFO", ".OOOOOOO.", "..OO.....", "..O......"],
    ring: ["..AAAAAAAAAA..", ".A..........A.", "A............A", ".A..........A.", "..AAAAAAAAAA.."],
};

// the canvas's Cast board: its columns, and its boss row, in prototype/cast.mjs's order
export const SHEET_POSES: PlanSprite[] = ["sit", "nod", "hand1", "hand2", "cheer1", "cheer2", "doze", "yawn",
    "stretch", "back", "backseat", "cup", "down1", "down2", "up1", "up2", "side1", "side2"];
export const BOSS_POSES: PlanSprite[] = ["stand", "down1", "down2", "up1", "up2", "side1", "side2", "boss"];
export const SHEET_SHIRTS = ["--color-office-shirt-claude", "--color-office-shirt-codex", "--color-office-shirt-pi",
    "--color-office-shirt-agy"];
```

- [ ] **Step 5: Colours, shades and URLs**

Replace `planToken` and `planSpriteUrl`, and extend `PLAN_TOKENS`:

```ts
const HAIR = [
    "--color-office-plan-hair-1",
    "--color-office-plan-hair-2",
    "--color-office-plan-hair-3",
    "--color-office-plan-hair-4",
];
const DARK = "--color-office-dark";
const NIGHT = "--color-office-night";

const clampLook = (look: number) => Math.min(4, Math.max(1, Math.round(look) || 1));

/** The colour a cell code draws in, for an outfit in a phase; undefined for a clear cell. */
export function planColor(
    code: string,
    o: PlanOutfit,
    phase: OfficePhase,
    read: (token: string) => Rgb | undefined = tokenRgb
): Rgb | undefined {
    const i = clampLook(o.look) - 1;
    const shade = (t: string, f: number) => {
        const c = read(t);
        return c && shadeRgb(c, f);
    };
    const t = PHASE_TOKENS[phase];
    switch (code) {
        case "O":
        case "E":
        case "K":
            return read(t.ink);
        case "H":
            return read(HAIR[i]);
        case "h": {
            const c = read(HAIR[i]);
            return c && liftRgb(c, 0.28);
        }
        case "S":
            return read(SKIN[i]);
        case "s":
            return shade(SKIN[i], 0.86);
        case "T":
            return read(o.shirt);
        case "t":
            return shade(o.shirt, 0.8);
        case "P":
            return read(PANTS);
        case "p":
            return shade(PANTS, 0.78);
        case "C":
            return read(CUP);
        case "B":
            return read(BOSS_SHIRT);
        case "W":
            return read(PAPER);
        case "R":
            return read(t.chair);
        case "r":
            return shade(t.chair, 0.8);
        case "_":
            return read(t.shadow);
        default:
            return undefined;
    }
}

// a tint laid over an opaque colour, as the over canvas lays it over everything under it; the colour keeps its alpha
function tinted(c: Rgb | undefined, tints: (Rgb | undefined)[]): Rgb | undefined {
    if (c == null) {
        return undefined;
    }
    let out: Rgb = [c[0], c[1], c[2]];
    for (const t of tints) {
        const a = t?.[3] ?? 0;
        if (t && a > 0) {
            out = [0, 1, 2].map((k) => Math.round(out[k] * (1 - a) + t[k] * a)) as Rgb;
        }
    }
    if (c[3] != null) {
        out[3] = c[3];
    }
    return out;
}

/** The sprite in the outfit and the phase, drawn once; a near-side seat in a dark room or after hours is shaded. */
export function planSpriteUrl(s: PlanSprite, o: PlanOutfit, phase: OfficePhase = "day", shade: Shade = ""): string {
    const look: PlanLook = o.boss ? "boss" : (clampLook(o.look) as PlanLook);
    const grid = planGrid(s, look);
    const tints =
        shade === "both" ? [DARK, NIGHT] : shade === "dark" ? [DARK] : shade === "night" ? [NIGHT] : [];
    const key = `${s}|${o.shirt}|${o.look}|${o.boss ? 1 : 0}|${phase}|${shade}`;
    return cachedSprite(
        "plan",
        key,
        grid,
        grid[0].length,
        (code) => tinted(planColor(code, o, phase), tints.map((t) => tokenRgb(t))),
        PLAN_CACHE_CAP
    );
}

/** A bubble or the boss's ring in the phase, drawn once. */
export function markUrl(m: PlanMark, phase: OfficePhase): string {
    const rows = MARKS[m];
    const ink = PHASE_TOKENS[phase].ink;
    const fill = m === "×" ? "--color-error" : "--color-asking";
    return cachedSprite(
        "plan",
        `mark|${m}|${phase}`,
        rows,
        rows[0].length,
        (code) =>
            code === "O" || code === "M"
                ? tokenRgb(ink)
                : code === "F"
                  ? tokenRgb(fill)
                  : code === "A"
                    ? tokenRgb("--color-accent")
                    : undefined,
        PLAN_CACHE_CAP
    );
}

/** Every property planSpriteUrl and markUrl can read, for the probe's unresolved check (cockpit-office). */
export const PLAN_TOKENS: string[] = [
    ...HAIR,
    ...SKIN,
    ...Object.values(HARNESS_SHIRT),
    OTHER_SHIRT,
    LEAD_SHIRT,
    BOSS_SHIRT,
    ...LANE_SHIRTS,
    PANTS,
    PAPER,
    CUP,
    DARK,
    NIGHT,
    "--color-asking",
    "--color-error",
    "--color-accent",
    ...(["day", "after"] as const).flatMap((p) => [PHASE_TOKENS[p].ink, PHASE_TOKENS[p].shadow, PHASE_TOKENS[p].chair]),
];
```

The run office's `--color-office-hair-*` and `--color-office-ink` are no longer read here (`INK` and today's `HAIR`
constant go; `SKIN`, `PANTS`, `PAPER`, `CUP` stay).

- [ ] **Step 6: The lounge's sizes in `officeplanmodel.ts`**

`LOUNGE_PERSON_W = 42` (comment: a person's sprite, 14 cells of PLAN_CELL px); `SEATED_H = 45` and
`STANDING_H = 69` (comment: the chibi's back on the sofa, 15 rows, and standing with a cup, 23 rows, as
plansprite.ts draws them). The two standing spots in `LOUNGE_SPOTS` stand 12 px lower, so a standing head clears the
`+N in the lounge` line: `spot("coffee", 170, 100, 126, 102, 104)` and `spot("coffee", 38, 100, 4, 102, 104)`.
Update the comment above `LOUNGE_SPOTS` (its numbers: standing feet at 100, their labels' row at 102).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run frontend/app/view/office/ frontend/app/view/agents/officeplanmodel.test.ts`
Expected: PASS, the existing lounge tests included (no label or sprite over another's, nor over `+N`).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/view/office/plansprite.ts frontend/app/view/office/plansprite.test.ts frontend/app/view/agents/officeplanmodel.ts frontend/app/view/agents/officeplanmodel.test.ts
git commit -m "feat(cockpit): the office's chibi people: 14 x 23, an outline, four hair styles and the boss's cap, coloured by phase; the lounge sized to them"
```

The office view still calls `planSpriteUrl(s, outfit)` with two arguments until Task 4 moves it, so give the phase a
default, `planSpriteUrl(s, o, phase: OfficePhase = "day", shade: Shade = "")`, and Check passes after this task alone.
Until Task 4 lands, the office draws the chibi people over today's building; that is expected.

---

### Task 3: The scenery: two canvases' draw lists, their raster and their key
**Depends on:** Task 1
**Files:** `frontend/app/view/office/scenery.ts`, `frontend/app/view/office/scenery.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Box`, `HWALL`, `WALL`, `buildPlan` (tests) from `@/app/view/agents/officeplanmodel`;
  `OfficeColors`, `OfficePhase`, `OfficeRole` (`officepalette.ts`); `NEAR_CHAIR` (`officegrids.ts`); `type Rgb`
  (`spritecache.ts`).
- Produces: `CELL = 3`; `art(v: number): number` (`Math.round(v / 3)`); `type Material = "wood" | "tiles" |
  "carpet" | "face" | "brick"`; `type Op`; `interface Scenery { width: number; height: number; under: Op[];
  over: Op[] }` (sizes in art px); `materialAt(m: Material, x: number, y: number, oy?: number): OfficeRole`;
  `scenery(plan: Plan, phase: OfficePhase, tired: boolean): Scenery`; `rasterise(ops: Op[], w: number, h: number,
  colors: OfficeColors): Uint8ClampedArray`; `sceneryKey(plan: Plan, phase: OfficePhase, tired: boolean, theme:
  string): string`; `CHAIR_ROLES: Record<string, OfficeRole>` (`{ O: "ink", R: "chair", r: "chairShade" }`).

`scenery` is the prototype's `render` (`prototype/scene.mjs`, lines 43–372) with every `under.*`, `over.*` and
`top.*` call turned into an op on the same list, in the same order, each colour named by its role (`P.wood` →
`"wood"`, `P.lift(P.pot, 0.2)` → `"potHi"`, `P.lift(P.chair, 0.18)` → `"chairHi"`, `P.shade(P.chair, 0.8)` →
`"chairShade"`, `P.shade(P.laptop, 0.75)` → `"laptopOff"`, `P.mixDone ?? P.shade(P.working, 0.62)` → `"done"`). The
`top` layer (wall caps and the sign) goes at the end of `over`. People, bubbles and the boss are not scenery.

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/office/scenery.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildPlan, type Plan, type PlanInput } from "@/app/view/agents/officeplanmodel";
import { describe, expect, it } from "vitest";
import { NEAR_CHAIR } from "./officegrids";
import type { OfficeColors } from "./officepalette";
import { art, materialAt, rasterise, scenery, sceneryKey, type Op } from "./scenery";

const NOW = Date.parse("2026-10-15T14:20:00");
function input(width = 1050, over: Partial<PlanInput> = {}): PlanInput {
    const a = (id: string, project: string | undefined, state: "asking" | "working" | "idle", idleMin?: number) => ({
        id,
        name: id,
        project,
        state,
        harness: "claude",
        finished: idleMin != null && idleMin < 5,
        idleSince: idleMin != null ? NOW - idleMin * 60_000 : undefined,
    });
    const task = (run: string, i: number, state: string) => ({ id: `t${i}`, label: `Task ${i}`, state, asking: false, key: `${run}:t${i}` });
    return {
        agents: [a("loom", "arcterm", "working"), a("quill", "arcterm", "asking"), a("sable", "arcterm", "idle", 1), a("harbor", "mozox", "working"), a("scratch", undefined, "idle", 7)],
        runs: [{ id: "run-b", title: "Billing export", project: "mozox", createdTs: 1, done: false, leadAsking: false, tasks: ["done", "running", "stalled", "failed", "pending"].map((s, i) => task("run-b", i + 1, s)) }],
        width,
        now: NOW,
        away: {},
        night: false,
        ...over,
    };
}
const plan = (width?: number, over?: Partial<PlanInput>): Plan => buildPlan(input(width, over));
const rects = (ops: Op[], role: string) => ops.filter((o) => o.k === "rect" && o.role === role) as Extract<Op, { k: "rect" }>[];
const lastIndex = (ops: Op[], pred: (o: Op) => boolean) => ops.map(pred).lastIndexOf(true);
const firstIndex = (ops: Op[], pred: (o: Op) => boolean) => ops.findIndex(pred);

describe("scenery", () => {
    it("sizes the canvases to cover the plan, on the art grid, at any width", () => {
        for (const w of [900, 1001, 1050]) {
            const p = plan(w);
            const s = scenery(p, "day", false);
            expect(s.width * 3).toBeGreaterThanOrEqual(p.width);
            expect(s.height * 3).toBeGreaterThanOrEqual(p.height);
            // the right outer wall is drawn inside the canvas
            expect(s.over.some((o) => o.k === "rect" && o.role === "cap" && o.x + o.w >= s.width - 3)).toBe(true);
        }
    });

    it("puts every op on whole art pixels", () => {
        const s = scenery(plan(1001, { night: true }), "after", true);
        for (const o of [...s.under, ...s.over]) {
            for (const [k, v] of Object.entries(o)) {
                // an alpha is a fraction (the sign's glow); every coordinate and size is a whole pixel
                if (typeof v === "number" && k !== "alpha") expect(Number.isInteger(v), JSON.stringify(o)).toBe(true);
            }
        }
    });

    it("puts each desk's chair and shadow under the people, its top and laptop over them", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        for (const d of p.desks) {
            const x = art(d.x);
            const y = art(d.y);
            expect(rects(s.under, "chair").some((r) => r.x === x + 8 && r.y === y - 8), d.key).toBe(true);
            expect(rects(s.under, "shadow").some((r) => r.x === x + 27 && r.y === y + 1), d.key).toBe(true);
            expect(rects(s.over, "desk").some((r) => r.x === x + 1 && r.y === y + 1), d.key).toBe(true);
            expect(rects(s.over, "laptop").some((r) => r.x === x + 8 && r.y === y - 2), d.key).toBe(true);
        }
    });

    it("lights a laptop's logo with its desk's light", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const logo = (key: string) => {
            const d = p.desks.find((d) => d.key === key)!;
            return s.over.find((o) => o.k === "rect" && o.x === art(d.x) + 12 && o.y === art(d.y) && o.w === 3) as Extract<Op, { k: "rect" }>;
        };
        expect(logo("loom").role).toBe("working");
        expect(logo("quill").role).toBe("asking");
        expect(logo("sable").role).toBe("laptopOff");
    });

    it("puts the floors and the wall faces under the people, and no floor over them", () => {
        const s = scenery(plan(), "day", false);
        for (const m of ["wood", "tiles", "carpet", "face", "brick"]) {
            expect(s.under.some((o) => o.k === "fill" && o.material === m), m).toBe(true);
        }
        expect(s.over.some((o) => o.k === "fill")).toBe(false);
    });

    it("puts the tables' tops and the sofa's back over the people, the sofa's seat and arms under them", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        for (const r of p.rooms.filter((r) => r.table)) {
            const at = (o: Extract<Op, { k: "rect" }>) => o.x === art(r.table!.x) + 1 && o.y === art(r.table!.y) + 1;
            expect(rects(s.over, "desk").some(at), r.key).toBe(true);
            expect(rects(s.under, "desk").some(at), r.key).toBe(false);
        }
        expect(rects(s.over, "sofaFace").length).toBeGreaterThan(0);
        expect(rects(s.under, "sofaFace")).toHaveLength(0);
        expect(rects(s.under, "sofa").length).toBeGreaterThan(0);
    });

    it("draws the near side's chairs over the table and the far side's under it", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const room = p.rooms.find((r) => r.table)!;
        for (const seat of p.seats.filter((x) => x.room === room.key)) {
            const near = seat.bottom > room.table!.y + 20;
            const at = (o: Op) => o.k === "grid" && o.rows === NEAR_CHAIR && o.x === art(seat.x - 3) && o.y === art(seat.bottom) - 6;
            expect(s.over.some(at), seat.key).toBe(near);
            expect(rects(s.under, "chair").some((r) => r.x === art(seat.x - 3) + 2 && r.y === art(seat.bottom) - 9), seat.key).toBe(!near);
        }
    });

    it("lays the tints after the furniture and the caps after the tints", () => {
        const s = scenery(plan(), "after", false);
        const furniture = lastIndex(s.over, (o) => o.k === "rect" && (o.role === "desk" || o.role === "deskFace" || o.role === "sofaFace"));
        const tint = firstIndex(s.over, (o) => o.k === "rect" && (o.role === "dark" || o.role === "night"));
        const lastTint = lastIndex(s.over, (o) => (o.k === "rect" && (o.role === "dark" || o.role === "night")) || o.k === "pool");
        const cap = firstIndex(s.over, (o) => o.k === "rect" && o.role === "cap");
        expect(furniture).toBeLessThan(tint);
        expect(lastTint).toBeLessThan(cap);
    });

    it("darkens a room with no one at work, its wall face included", () => {
        const p = plan();
        const home = p.rooms.find((r) => r.key === "room:home")!;
        expect(home.lit).toBe(false);
        const dark = rects(scenery(p, "day", false).over, "dark").find((r) => r.x === art(home.box.x))!;
        expect(dark.y).toBe(art(home.box.y) - 3);
        expect(dark.h).toBe(art(home.box.y + home.box.h) - art(home.box.y) + 3);
    });

    it("tints the body and pools a lamp at each desk at work only after hours", () => {
        const p = plan(1050, { night: true });
        const after = scenery(p, "after", false);
        expect(rects(after.over, "night")).toHaveLength(1);
        expect(after.over.filter((o) => o.k === "pool").length).toBeGreaterThanOrEqual(p.desks.filter((d) => d.light !== "off").length);
        const day = scenery(plan(), "day", false);
        expect(rects(day.over, "night")).toHaveLength(0);
        expect(day.over.some((o) => o.k === "pool")).toBe(false);
    });

    it("puts a cup on every working desk when tired", () => {
        const p = plan();
        const working = p.desks.filter((d) => d.light === "working").length;
        expect(rects(scenery(p, "day", true).over, "cup").length - rects(scenery(p, "day", false).over, "cup").length).toBe(working);
    });

    it("gives the floors their materials", () => {
        expect(materialAt("wood", 3, 5)).toBe("seam");
        expect(materialAt("tiles", 15, 3)).toBe("grout");
        expect(materialAt("tiles", 3, 31)).toBe("grout");
        expect(materialAt("brick", 0, 12, 10)).toBe("mortar");
        expect(["carpet", "carpet2"]).toContain(materialAt("carpet", 1, 1));
        expect(materialAt("face", 8, 0)).toBe("face2");
    });
});

describe("rasterise", () => {
    const colors: OfficeColors = { ink: [0, 0, 0], wood: [200, 100, 0], dark: [0, 0, 0, 0.5] };

    it("paints opaque ops and blends translucent ones", () => {
        const px = rasterise(
            [
                { k: "rect", x: 0, y: 0, w: 2, h: 1, role: "wood" },
                { k: "rect", x: 1, y: 0, w: 1, h: 1, role: "dark" },
            ],
            2,
            1,
            colors
        );
        expect(Array.from(px.slice(0, 4))).toEqual([200, 100, 0, 255]);
        expect(Array.from(px.slice(4, 8))).toEqual([100, 50, 0, 255]);
    });

    it("leaves a pixel clear for a missing colour or a clear cell, and clips at the edges", () => {
        const px = rasterise(
            [
                { k: "rect", x: -1, y: -1, w: 1, h: 1, role: "ink" },
                { k: "rect", x: 0, y: 0, w: 1, h: 1, role: "glass" },
                { k: "grid", x: 1, y: 0, rows: [".O"], roles: { O: "ink" } },
            ],
            2,
            1,
            colors
        );
        expect(Array.from(px)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });
});

describe("sceneryKey", () => {
    const key = (p: Plan, phase: "day" | "after" = "day", tired = false, theme = "claude") => sceneryKey(p, phase, tired, theme);

    it("changes with what the canvases draw", () => {
        const p = plan();
        const k = key(p);
        expect(key(plan(1050, { agents: input().agents.map((a) => (a.id === "loom" ? { ...a, state: "idle" as const, finished: true, idleSince: NOW } : a)) }))).not.toBe(k);
        expect(key(p, "after")).not.toBe(k);
        expect(key(p, "day", true)).not.toBe(k);
        expect(key(p, "day", false, "graphite")).not.toBe(k);
        const screen = plan(1050, { runs: input().runs.map((r) => ({ ...r, tasks: r.tasks.map((t, i) => (i === 4 ? { ...t, state: "running" } : t)) })) });
        expect(key(screen)).not.toBe(k);
        expect(key(plan(1001))).not.toBe(k);
    });

    it("changes with a room's light and with a desk's light alone", () => {
        const p = plan();
        const k = key(p);
        expect(key({ ...p, rooms: p.rooms.map((r) => (r.key === "room:home" ? { ...r, lit: !r.lit } : r)) })).not.toBe(k);
        expect(key({ ...p, desks: p.desks.map((d) => (d.key === "loom" ? { ...d, light: "off" as const } : d)) })).not.toBe(k);
    });

    it("stays when only people, poses or labels change", () => {
        const p = plan();
        const moved: Plan = {
            ...p,
            desks: p.desks.map((d) => ({ ...d, pose: "cheer" as const, word: "done", tone: "done" as const, bubble: undefined, animated: true, tip: "x" })),
            seats: p.seats.map((s) => ({ ...s, pose: "doze" as const, animated: false, bubble: "?" as const })),
            loungers: [],
            loungeOverflow: ["a", "b"],
        };
        expect(key(moved)).toBe(key(p));
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/office/scenery.test.ts`
Expected: FAIL (`./scenery` does not exist).

- [ ] **Step 3: Write `scenery.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit office's building on two canvases (cockpit office spec, "Drawing"): the plan → what the canvas under
// the people and the one over them draw, in art pixels (one is PLAN_CELL CSS px), each op naming a colour role, never
// a colour. rasterise turns a list into RGBA bytes; sceneryKey says when to draw again. Ported from the canvas's
// prototype (.superpowers/design/cockpit-office-pixel/prototype/scene.mjs), op for op. Pure: no React, no DOM.

import { HWALL, WALL, type Box, type Plan } from "@/app/view/agents/officeplanmodel";
import { NEAR_CHAIR } from "./officegrids";
import type { OfficeColors, OfficePhase, OfficeRole } from "./officepalette";
import type { Rgb } from "./spritecache";

export const CELL = 3;
export const art = (v: number) => Math.round(v / CELL);
// the rows of a wall's face that fall inside the room under its box
const FACE = 3;

export type Material = "wood" | "tiles" | "carpet" | "face" | "brick";
export type Op =
    | { k: "rect"; x: number; y: number; w: number; h: number; role: OfficeRole; alpha?: number }
    | { k: "fill"; x: number; y: number; w: number; h: number; material: Material; oy?: number }
    | { k: "grid"; x: number; y: number; rows: string[]; roles: Record<string, OfficeRole> }
    | { k: "pool"; cx: number; cy: number; rx: number; ry: number };
export interface Scenery {
    width: number;
    height: number;
    under: Op[];
    over: Op[];
}
export const CHAIR_ROLES: Record<string, OfficeRole> = { O: "ink", R: "chair", r: "chairShade" };

const LEAF = ["..OOOOO..", ".OGGgGGO.", "OGgGGGGdO", "OGGGgGGdO", "OdGGGGddO", "OGdGGdGdO", ".OddGddO.", "..OOOOO.."];
const LEAF_ROLES: Record<string, OfficeRole> = { O: "ink", G: "leaf", g: "leafHi", d: "leafDark" };
// the sign's letters, a 5 x 5 pixel face
const FONT: Record<string, string[]> = {
    A: [".###.", "#...#", "#####", "#...#", "#...#"],
    R: ["####.", "#...#", "####.", "#..#.", "#...#"],
    C: [".####", "#....", "#....", "#....", ".####"],
    T: ["#####", "..#..", "..#..", "..#..", "..#.."],
    E: ["#####", "#....", "####.", "#....", "#####"],
    M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
};

/** A stable hash of small integers: where knots and the darker bricks fall, the same on every draw. */
export function hash(...n: number[]): number {
    let h = 2166136261;
    for (const v of n) {
        h ^= v + 0x9e3779b9;
        h = Math.imul(h, 16777619);
        h ^= h >>> 13;
    }
    return h >>> 0;
}

/** The role a floor's or a wall's material shows at an art pixel; coordinates are the canvas's, so floors line up. */
export function materialAt(m: Material, x: number, y: number, oy = 0): OfficeRole {
    switch (m) {
        case "tiles":
            return x % 16 === 15 || y % 16 === 15 ? "grout" : ((x >> 4) + (y >> 4)) % 2 ? "tile2" : "tile";
        case "carpet":
            return (x % 4 === 0 && y % 4 === 0) || (x % 4 === 2 && y % 4 === 2) ? "carpet2" : "carpet";
        case "face":
            return x % 8 === 0 ? "face2" : "face";
        case "brick": {
            const r = y - oy;
            if (r % 3 === 2) {
                return "mortar";
            }
            const off = Math.floor(r / 3) % 2 ? 3 : 0;
            if ((x + off) % 6 === 5) {
                return "mortar";
            }
            return hash(Math.floor((x + off) / 6), Math.floor(r / 3)) % 4 === 0 ? "brick2" : "brick";
        }
        case "wood": {
            // planks 5 rows tall and 26 long, a seam under each row and at each joint, a knot on one plank in five
            const row = Math.floor(y / 6);
            if (y % 6 === 5) {
                return "seam";
            }
            const off = (row * 11) % 26;
            const lx = (x + off) % 26;
            if (lx === 0) {
                return "seam";
            }
            const h = hash(row, Math.floor((x + off) / 26));
            if (h % 5 === 0) {
                const kx = ((h >>> 3) % 18) + 4;
                if ((lx === kx || lx === kx + 1) && y % 6 === 2) {
                    return "knot";
                }
            }
            return h % 3 === 0 ? "wood2" : "wood";
        }
    }
}

class Ops {
    list: Op[] = [];
    rect(x: number, y: number, w: number, h: number, role: OfficeRole, alpha?: number) {
        if (w > 0 && h > 0) {
            this.list.push(alpha == null ? { k: "rect", x, y, w, h, role } : { k: "rect", x, y, w, h, role, alpha });
        }
    }
    // a filled box with a 1 px outline
    box(x: number, y: number, w: number, h: number, fill: OfficeRole, ink: OfficeRole = "ink") {
        this.rect(x, y, w, h, ink);
        if (w > 2 && h > 2) {
            this.rect(x + 1, y + 1, w - 2, h - 2, fill);
        }
    }
    fill(x: number, y: number, w: number, h: number, material: Material, oy?: number) {
        if (w > 0 && h > 0) {
            this.list.push(oy == null ? { k: "fill", x, y, w, h, material } : { k: "fill", x, y, w, h, material, oy });
        }
    }
    grid(rows: string[], x: number, y: number, roles: Record<string, OfficeRole>) {
        this.list.push({ k: "grid", x, y, rows, roles });
    }
    px(x: number, y: number, role: OfficeRole) {
        this.rect(x, y, 1, 1, role);
    }
}

const artBox = (b: Box) => {
    const x = art(b.x);
    const y = art(b.y);
    return { x, y, w: art(b.x + b.w) - x, h: art(b.y + b.h) - y };
};

/** What the canvas under the people and the one over them draw, in order; sizes in art px. */
export function scenery(plan: Plan, phase: OfficePhase, tired: boolean): Scenery {
    const night = phase === "after";
    const W = Math.ceil(plan.width / CELL);
    const H = Math.ceil(plan.height / CELL);
    const under = new Ops();
    const over = new Ops();
    const top = new Ops(); // wall caps and the sign: the over canvas's last ops, which no tint covers
    // ... the prototype's render, scene.mjs lines 65–372, op for op (see the mapping above this step) ...
    return { width: W, height: H, under: under.list, over: [...over.list, ...top.list] };
}
```

Fill the body of `scenery` by porting `scene.mjs` lines 65–372 in order: `under.fill(...tiles)` →
`under.fill(x, y, w, h, "tiles")`; the rooms' `wood`/`carpet` fills likewise; `box(b)` → `artBox(b)`;
`a(...)` → `art(...)`; `shadowR` becomes a local `(x, y, w, h) => { under.rect(x + w, y + 1, 1, h, "shadow");
under.rect(x + 1, y + h, w - 1, 1, "shadow"); }`; the wall face's per-pixel lambda → `under.fill(b.x, fy, b.w, fh,
"face")`; the facade's brick lambda → `under.fill(0, fy + 3, W, H - fy - 3, "brick", fy + 3)`; the plant's leaf →
`under.grid(LEAF, x + 1, y + 1, LEAF_ROLES)`; the glass doors' halves → `Math.floor(e.w / 2)` where the prototype
writes `e.w / 2` (an entrance 23 or 25 art px wide would put an op on half a pixel); a near-side chair →
`over.grid(NEAR_CHAIR, px, pb - 6, CHAIR_ROLES)`
when `s.bottom > r.table.y + 20` (geometry only: drop the prototype's `s.pose === "back" ||`, so a pose never moves an
op); a lamp's pool → `over.list.push({ k: "pool", cx, cy, rx, ry })`; the windows: `glass` and `glass2` by both
phases, and the highlight pixels `glassHi` by day, `glass2` after hours; the night's sign glow →
`top.rect(sx0 - 1, sy0 - 1, sw0 + 2, 11, "accent", 0.35)`; each sign letter → `top.grid(FONT[ch], x, sy0 + 2,
{ "#": "accent50" })`. Skip the prototype's people, near-seat shading, bubbles, boss and composite (lines 282–310 and
374 on).

Then the raster and the key:

```ts
/** RGBA bytes for a list of ops on a w × h canvas; a role with no colour leaves its pixels as they were. */
export function rasterise(ops: Op[], w: number, h: number, colors: OfficeColors): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, c: Rgb | undefined, alpha = 1) => {
        if (c == null || x < 0 || y < 0 || x >= w || y >= h) {
            return;
        }
        const i = (y * w + x) * 4;
        const a = (c[3] ?? 1) * alpha;
        if (a >= 1) {
            d[i] = c[0];
            d[i + 1] = c[1];
            d[i + 2] = c[2];
            d[i + 3] = 255;
            return;
        }
        const da = d[i + 3] / 255;
        const oa = a + da * (1 - a);
        if (oa <= 0) {
            return;
        }
        for (let k = 0; k < 3; k++) {
            d[i + k] = (c[k] * a + d[i + k] * da * (1 - a)) / oa;
        }
        d[i + 3] = oa * 255;
    };
    for (const op of ops) {
        switch (op.k) {
            case "rect": {
                const c = colors[op.role];
                for (let y = Math.max(0, op.y); y < Math.min(h, op.y + op.h); y++) {
                    for (let x = Math.max(0, op.x); x < Math.min(w, op.x + op.w); x++) {
                        put(x, y, c, op.alpha);
                    }
                }
                break;
            }
            case "fill":
                for (let y = Math.max(0, op.y); y < Math.min(h, op.y + op.h); y++) {
                    for (let x = Math.max(0, op.x); x < Math.min(w, op.x + op.w); x++) {
                        put(x, y, colors[materialAt(op.material, x, y, op.oy)]);
                    }
                }
                break;
            case "grid":
                op.rows.forEach((row, j) => {
                    for (let i = 0; i < row.length; i++) {
                        const role = op.roles[row[i]];
                        if (role) {
                            put(op.x + i, op.y + j, colors[role]);
                        }
                    }
                });
                break;
            case "pool": {
                // a lamp's light on the floor, dithered at its rim
                const c = colors.lamp;
                for (let y = -op.ry; y <= op.ry; y++) {
                    for (let x = -op.rx; x <= op.rx; x++) {
                        const q = (x * x) / (op.rx * op.rx) + (y * y) / (op.ry * op.ry);
                        if (q > 1 || (q > 0.62 && (x + y) % 2)) {
                            continue;
                        }
                        put(op.cx + x, op.cy + y, c && [c[0], c[1], c[2]], q > 0.62 ? 0.1 : 0.2);
                    }
                }
                break;
            }
        }
    }
    return d;
}

/**
 * What the canvases draw, as a string: they draw again only when it changes. The plan's geometry, each room's light,
 * each desk's light, each run's screen, tired, the phase and the theme (a run's screen and the laptops' lights are
 * status tokens). Never a pose, a walker or a label.
 */
export function sceneryKey(plan: Plan, phase: OfficePhase, tired: boolean, theme: string): string {
    return JSON.stringify([
        plan.width,
        plan.height,
        phase,
        tired,
        theme,
        plan.body,
        plan.lounge,
        plan.entrance,
        plan.walls,
        plan.rooms.map((r) => [r.key, r.box, r.lit, r.door ?? 0, r.table ?? 0, r.screen ?? 0]),
        plan.desks.map((d) => [d.x, d.y, d.light]),
        plan.seats.map((s) => [s.x, s.bottom]),
    ]);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/office/scenery.test.ts`
Expected: PASS. If an op's coordinate test fails on a non-integer, the port missed an `art(...)` around a CSS value.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/office/scenery.ts frontend/app/view/office/scenery.test.ts
git commit -m "feat(cockpit): the office's scenery as two canvases' draw lists, their raster and the key that says when to draw again"
```

---

### Task 4: The office view on two canvases
**Depends on:** Task 2, Task 3
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitofficedevhooks.ts`, `frontend/tailwindsetup.css`

**Interfaces:**
- Consumes: everything Tasks 1–3 produce; `themePresetAtom`, `themeOverridesAtom` (`./themestore`).
- Produces: in `readOfficeProbe()`, new fields `sceneryDraws: number` (scenes drawn since the page loaded: one per
  `sceneryKey`, however many canvases), `phase: OfficePhase`, `sheetSize: number` (`4 * SHEET_POSES.length +
  BOSS_POSES.length`), `lounge: Box | null`; `unresolved` checks `[...PLAN_TOKENS, ...OFFICE_TOKENS]`. DOM:
  `canvas[data-office-canvas="under"]` and `canvas[data-office-canvas="over"]` under `[data-office-root]`, each
  carrying `data-office-drawn` once it has painted; `[data-office-plate]` on each label drawn on a plate;
  `img[data-office-ring]` the boss's ring. The buttons keep the attributes the scenarios read (`data-office-desk`,
  `data-office-seat`, `data-office-room`, `data-office-pose`). Gone from the DOM: `[data-office-floor]`,
  `[data-office-hall]`, `[data-office-dark]`, `[data-office-night]`, `[data-office-sign]` (Task 5 moves the scenario
  off them).
- Produces (`cockpitofficedevhooks.ts`): `window.__cockpitOfficeTheme(preset: string): string`, which sets
  `themePresetAtom` and returns the preset it replaced (Task 5's steps 13c and 15b).

**Shown by:** `cockpit-office` steps 1 and 1b (`cockpit-office-main.png`: the building on two canvases, names on
plates), 1c (`cockpit-office-near-ask.png`: the near-side worker who asks), 9 and 9b (`cockpit-office-night.png`: the
after-hours palette, lamps, no plates), 10 (`cockpit-office-tired.png`: the cups), 13 and 13b
(`cockpit-office-states.png`, `cockpit-office-states-night.png`: the Cast sheet by day and after hours), 13c
(`cockpit-office-theme.png`: the theme switched with the office open), 14b (`cockpit-office-lounge.png`) and 15b
(the theme switched while in Cards). Task 5 adds 1b, 1c, 4c, 9b, 12b, 13b, 13c and 15b.

- [ ] **Step 1: The phase, tired and the theme in `CockpitOffice`**

Under `const night = ...`:

```ts
    const phase: OfficePhase = night ? "after" : "day";
    const tired = energy === "tired";
    const theme = useThemeEpoch();
```

and above `CockpitOffice`:

```ts
// the theme the office's colours were last read in. Module level: tokenRgb's colours and the plan's sprites outlive
// the office, and a theme can change while it is away (Cards, another surface)
let drawnTheme: string | undefined;

// a theme re-skins the status tokens a run's screen, the laptops, the bubbles and the ring use
function useThemeEpoch(): string {
    const key = `${useAtomValue(themePresetAtom)}|${JSON.stringify(useAtomValue(themeOverridesAtom))}`;
    // mounting after the theme changed while the office was away: its vars are on <html> already, so the old colours
    // are forgotten before anything here draws (idempotent, so strict mode's second call is harmless)
    const [epoch, setEpoch] = useState(() => {
        if (drawnTheme !== key) {
            clearTokenColors();
            clearSprites("plan");
            drawnTheme = key;
        }
        return key;
    });
    // the theme changing while the office is open: the shell writes its vars in a layout effect that runs after this
    // office's own, so the colours are forgotten in a passive effect, after every layout effect, and the epoch it
    // returns redraws what used them
    useEffect(() => {
        if (epoch !== key) {
            clearTokenColors();
            clearSprites("plan");
            drawnTheme = key;
            setEpoch(key);
        }
    }, [key, epoch]);
    return epoch;
}
```

In `cockpitofficedevhooks.ts`, beside `__cockpitOfficeAnimation` (declare it in the `Window` interface too):

```ts
    window.__cockpitOfficeTheme = (preset) => {
        const prev = globalStore.get(themePresetAtom);
        globalStore.set(themePresetAtom, preset);
        return prev;
    };
```

- [ ] **Step 2: The two canvases**

```tsx
// scenes drawn since the page loaded, for the probe: one per sceneryKey, counted in CockpitOffice, not per canvas
let sceneryDraws = 0;

// the building at art resolution, scaled 3x: drawn in a passive effect (after the theme's vars are on <html>) and
// only when its ops change, which happens only when sceneryKey does (the phase and the theme are in it)
const OfficeCanvas = memo(function OfficeCanvas(p: {
    which: "under" | "over";
    ops: Op[];
    width: number;
    height: number;
    phase: OfficePhase;
    z: number;
}) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) {
            return;
        }
        const image = ctx.createImageData(p.width, p.height);
        image.data.set(rasterise(p.ops, p.width, p.height, officeColors(p.phase)));
        ctx.putImageData(image, 0, 0);
        // the bench's open time stops once every canvas has painted
        canvas.dataset.officeDrawn = "";
    }, [p.ops, p.width, p.height, p.phase]);
    return (
        <canvas
            ref={ref}
            data-office-canvas={p.which}
            width={p.width}
            height={p.height}
            className="pointer-events-none absolute left-0 top-0 [image-rendering:pixelated]"
            style={{ width: p.width * PLAN_CELL, height: p.height * PLAN_CELL, zIndex: p.z }}
        />
    );
});
```

In `CockpitOffice`, after `plan`:

```ts
    const sceneKey = sceneryKey(plan, phase, tired, theme);
    // the plan is rebuilt on every coarse tick with new objects; the ops only when what they draw has changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const scene = useMemo(() => scenery(plan, phase, tired), [sceneKey]);
    // one draw of the building per scene: both canvases paint in their own effects, which run before this one
    useEffect(() => {
        sceneryDraws++;
        probe.sceneryDraws = sceneryDraws;
    }, [scene]);
```

and in the root `<div data-office-root>`, in place of `<Building …/>`, `<Shades …/>` and `<Walls …/>`:

```tsx
                    <OfficeCanvas which="under" ops={scene.under} width={scene.width} height={scene.height} phase={phase} z={0} />
                    {/* desks, tables' buttons, seats and loungers as below */}
                    <OfficeCanvas which="over" ops={scene.over} width={scene.width} height={scene.height} phase={phase} z={2} />
```

(The canvases are `pointer-events-none`, so a click on the floor reaches the root's `onClick` as before.) Delete
`Building`, `Shades`, `Walls`, `Screen` and the constants only they used (`WOOD`, `FLOOR`, `BRICK`, `SCREEN`,
`BUBBLE`), and the `HWALL`, `WALL`, `RoomKind` imports if nothing else uses them.

- [ ] **Step 3: People on the art grid, outside their buttons**

`Person` takes the phase and a shade, and places the sprite by its left edge (CSS px, on the art grid):

```tsx
function Person(p: {
    sprite: PlanSprite;
    outfit: PlanOutfit;
    phase: OfficePhase;
    shade?: Shade;
    left: number; // a 14-wide person's left edge, CSS px
    bottom: number;
    z?: number;
    lounger?: string;
}) {
    const h = spriteH(p.sprite);
    return (
        <img
            alt=""
            draggable={false}
            data-office-sprite={p.sprite}
            data-office-lounger={p.lounger}
            src={planSpriteUrl(p.sprite, p.outfit, p.phase, p.shade ?? "")}
            className="pointer-events-none absolute [image-rendering:pixelated]"
            style={{
                left: p.left + spriteLeft(p.sprite) * PLAN_CELL,
                top: p.bottom - h,
                width: spriteWidth(p.sprite) * PLAN_CELL,
                height: h,
                zIndex: p.z ?? 1,
            }}
        />
    );
}
```

`TickPerson` and `TickSeat` pass `phase`, `left`, `bottom`, `z`, `shade` through to it. Where people sit:

- at a desk: `left = (art(d.x) + 6) * PLAN_CELL`, `bottom = (art(d.y) + 2) * PLAN_CELL`;
- at a seat: `left = art(s.x - 3) * PLAN_CELL`, `bottom = art(s.bottom) * PLAN_CELL`; a seat is on the near side
  when `s.bottom > table.y + 20` (its room's table): `z = 3`, `shade = !lit && night ? "both" : !lit ? "dark" :
  night ? "night" : ""`, and the `back` pose draws `"backseat"`; a far seat `z = 1`, no shade. Every near-side person
  is at z 3, an asking one (pose `hand`, facing you) included: the prototype puts a near seat that is not `back` under
  the over canvas, but never drew one, and there the table would cover an asking face (see Review Focus);
- in the lounge: `left = art(l.x) * PLAN_CELL`, `bottom = art(l.bottom) * PLAN_CELL`.

`DeskView` returns a fragment: the person (when seated) and the button. The button is transparent and childless,
over everything that draws:

```tsx
const DESK_CLASS =
    "absolute z-[3] cursor-pointer border-0 bg-transparent p-0 [contain-intrinsic-size:88px_98px] [content-visibility:auto] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
```

(no pseudo-elements, no spans, no `d.dim && "opacity-60"`: an away desk is no longer faded). `SeatView` likewise: a
person (`z` 1 or 3 as above) and a transparent button `z-[3]` at `left: art(s.x - 3) * PLAN_CELL`,
`top: art(s.bottom) * PLAN_CELL - 51`, `42 × 51`. Give `DeskView` and `SeatView` `phase` (and `SeatView` its room's
`lit` and `near`) as props, so their `sameValues` memo re-renders them when those change. The buttons keep the data
attributes the scenarios read: `data-office-desk`, `data-office-seat`, `data-office-room`, `data-office-pose`. `Table` keeps only its
transparent button (`z-[3]`, `bg-transparent`, no border; the table is drawn on the over canvas) and the `+N`.
`LoungerView` passes `phase`.

`Mover` snaps to the grid and uses the new width: `const w = spriteWidth(p.sprite) * PLAN_CELL;` and
`translate(${Math.round((at.x - w / 2) / PLAN_CELL) * PLAN_CELL}px, ${Math.round(at.y - h)}px)`. It takes `phase` and
passes it to `planSpriteUrl`. `BossView` shows `"stand"` (not `"down1"`) while it stands away from a desk, and draws
its ring as a sprite:

```tsx
            <img
                ref={ringRef}
                alt=""
                data-office-ring=""
                src={markUrl("ring", phase)}
                className={cn("pointer-events-none absolute left-0 top-0 z-[7] [image-rendering:pixelated]", look.moving && "will-change-transform")}
                style={{ width: 14 * PLAN_CELL, height: 5 * PLAN_CELL }}
            />
```

with the ring's transform `translate(${Math.round(at.x - 21)}px, ${Math.round(at.y - 9)}px)`. `WalkersView` and
`BossView` take `phase` (and `BossView` the theme epoch, so its ring redraws after a theme change).

- [ ] **Step 4: Labels and bubbles**

`Bubble` becomes a sprite:

```tsx
function Bubble({ mark, left, top, phase }: { mark: PlanMark; left: number; top: number; phase: OfficePhase }) {
    return (
        <img
            alt=""
            data-office-bubble={mark}
            src={markUrl(mark, phase)}
            className="pointer-events-none absolute z-[6] [image-rendering:pixelated]"
            style={{ left, top, width: 9 * PLAN_CELL, height: 9 * PLAN_CELL }}
        />
    );
}
```

placed, for a desk, at `left = (art(d.x) + 1) * PLAN_CELL`, `top = (art(d.y) - 22) * PLAN_CELL` (left of the head:
an asking person's arm is up on its right); for a seat at `left = (art(s.x - 3) + 11) * PLAN_CELL`,
`top = (art(s.bottom) - g - 5) * PLAN_CELL` with `g` 18 for a seat in `back` and 17 for any other pose (the
prototype's `bubbleAt`, `scene.mjs`).

In `Labels` (which takes `phase` and the theme epoch):

```ts
// in work hours the floor is light, so a label sits on a plate; after hours it is dark enough without
const plate = (night: boolean) => (night ? "" : "rounded-[3px] bg-office-plate px-[5px]");
```

- a desk's name: one span, centred under the desk, cut at 116 px:

  ```tsx
                    <span
                        data-office-plate={night ? undefined : ""}
                        className={cn(
                            "pointer-events-none absolute z-[6] max-w-[116px] -translate-x-1/2 truncate text-center text-[11px] leading-[14px]",
                            TONE[d.tone],
                            plate(night)
                        )}
                        style={{ left: d.x + 40, top: d.y + 34 }}
                    >
                        {d.word ? `${d.name} · ${d.word}` : d.name}
                    </span>
  ```

- a room's title and sub: the plate on each of the two inner spans, the outer span `gap-[2px]` by day;
- a lounge label and `+N in the lounge`: the plate on the label's outer span; `data-office-plate` on each plated
  element;
- delete the night lamps (the desks' and the meeting tables'): the over canvas draws them.

- [ ] **Step 5: The pose sheet and the probe**

`PoseSheet` (takes `phase`) draws the Cast board: four rows, one per look in `SHEET_SHIRTS`, of `SHEET_POSES`, then
the boss row of `BOSS_POSES` in `BOSS_OUTFIT`, each sprite at its size, bottoms aligned, with one header row of the
pose names (`font-mono text-[10.5px] text-muted`), on the phase's wood, as the Cast board draws each phase's cast on
its floor so the outlines read as they will in the office:

```tsx
function PoseSheet({ phase }: { phase: OfficePhase }) {
    const row = (sprites: PlanSprite[], outfit: PlanOutfit, key: string) => (
        <div key={key} className="flex items-end gap-2">
            {sprites.map((s) => (
                <img
                    key={s}
                    alt=""
                    src={planSpriteUrl(s, outfit, phase)}
                    className="[image-rendering:pixelated]"
                    style={{ width: spriteWidth(s) * PLAN_CELL, height: spriteH(s) }}
                />
            ))}
        </div>
    );
    return (
        <div
            data-office-sheet
            className={cn(
                "absolute left-2 top-2 z-[9] flex flex-col gap-2 rounded-md border border-edge-mid p-3",
                phase === "after" ? "bg-office-after-wood" : "bg-office-day-wood"
            )}
        >
            <div className="flex gap-2">
                {SHEET_POSES.map((s) => (
                    <span key={s} className="w-[60px] text-center font-mono text-[10.5px] text-muted">
                        {s}
                    </span>
                ))}
            </div>
            {SHEET_SHIRTS.map((shirt, i) => row(SHEET_POSES, { shirt, look: i + 1 }, shirt))}
            {row(BOSS_POSES, BOSS_OUTFIT, "boss")}
        </div>
    );
}
```

In the probe: `sceneryDraws: 0` and `phase: "day" as OfficePhase` in the `probe` object (set `probe.phase = phase`
where the other fields are assigned; `sceneryDraws` only by the scene effect of step 2); in `readOfficeProbe()` add `sheetSize: 4 * SHEET_POSES.length +
BOSS_POSES.length`, `lounge: lastPlan?.lounge ?? null`, and `unresolved: [...PLAN_TOKENS, ...OFFICE_TOKENS].filter((t)
=> tokenRgb(t) == null)`.

- [ ] **Step 6: Drop the old scenery tokens**

From `frontend/tailwindsetup.css` delete `--color-office-wall-top`, `-wall-face`, `-wood-1`, `-wood-2`, `-tile-1`,
`-tile-2`, `-carpet`, `-hall`, `-desk-top`, `-desk-face`, `-sofa`, `-brick`, `-mortar`, `-window-day`,
`-window-night`, `-plant`, `--shadow-office-sign`, `--shadow-office-sign-night`, `--shadow-office-lamp`, and trim the
block's comment to what stays (shirts, the boss, the cup, `-night`, `-dark`, `-lamp`). First run
`grep -rn -E "office-(wall-top|wall-face|wood-[12]|tile-[12]|carpet|hall|desk-top|desk-face|sofa|brick|mortar|window-day|window-night|plant)\b|shadow-office-(sign|lamp)" frontend/`
and expect no hit outside `tailwindsetup.css` (the Run office uses none of them; if it does, keep that token).

- [ ] **Step 7: Typecheck, test, and look at it**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (about 2 minutes) → exit 0.
Run: `npx vitest run frontend/app/view/office/ frontend/app/view/agents/` → PASS.
Run: `npx eslint frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitofficedevhooks.ts frontend/app/view/office/` → no new error.
Then see it in the browser build on its own ports (this worktree's `public/cockpit-fixtures/active.json` is its own):

```bash
ARC_BROWSER_CDP_PORT=9231 ARC_BROWSER_VITE_PORT=5231 ARC_DEV_DATA_DIR="$TMPDIR/arc-office-t4" node scripts/cdp/browser-app.mjs > "$TMPDIR/arc-office-t4.log" 2>&1 &
for i in $(seq 1 180); do grep -q "browser app ready" "$TMPDIR/arc-office-t4.log" && break; sleep 1; done
CDP_PORT=9231 node --experimental-websocket scripts/cdp/verify.mjs cockpit-office
```

Expected: the scenario runs (steps 7 and 14b, which read `[data-office-hall]` and `[data-office-floor]`, and step 13,
which counts 18 sprites, fail until Task 5 moves them; Task 5 adds steps 1b, 1c, 4c, 9b, 12b, 13b, 13c and 15b).
Open `cdp-shots/cockpit-office-main.png`, `-night.png`, `-tired.png`, `-states.png` and `-lounge.png` and compare
them with the canvas's `Main`, `Night` and `Cast` boards. Stop the browser app by its PID (`kill %1`).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitofficedevhooks.ts frontend/tailwindsetup.css
git commit -m "feat(cockpit): the office in pixel art on two canvases: floors, walls, furniture and lights drawn once per change, people between them, labels on plates by day"
```

---

### Task 5: The CDP scenarios, the guide and the changelog
**Depends on:** Task 4
**Files:** `scripts/cdp/cockpitofficescenarios.mjs`, `docs/guide/cockpit.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the probe's `sceneryDraws` (one per scene), `phase`, `sheetSize`, `lounge`; `canvas[data-office-canvas]`
  and its `data-office-drawn`; `[data-office-plate]`; `img[data-office-ring]`; `window.__cockpitOfficeTheme` (Task 4).

**Shown by:** the steps this task adds, each named below with its shot.

- [ ] **Step 1: Step 1b, the building on two canvases (after step 1's shot)**

```js
            // 1b. the building is two canvases: no floor, wall, shade or sign node; names sit on plates in work hours
            const building = await h.ev(`({
                canvases: document.querySelectorAll("[data-office-root] canvas[data-office-canvas]").length,
                old: document.querySelectorAll("[data-office-floor], [data-office-hall], [data-office-dark], [data-office-night], [data-office-sign]").length,
                plates: document.querySelectorAll("[data-office-root] [data-office-plate]").length,
            })`);
            p = await probe(h);
            rec(
                "1b. the building draws on two canvases, the people and labels over it; labels on plates in work hours",
                building.canvases === 2 && building.old === 0 && building.plates > 0 && p?.phase === "day",
                JSON.stringify({ ...building, phase: p?.phase })
            );
```

- [ ] **Step 1c: A near-side worker who asks (after step 1b)**

Above the scenarios, beside `OFFICE_RUNS`:

```js
// Main's runs with Billing export's task 3, on its table's near side, asking (step 1c)
const NEAR_ASK_RUNS = OFFICE_RUNS.map((r) =>
    r.title !== "Billing export" ? r : { ...r, tasks: r.tasks.map((t) => (t.id === "t3" ? { ...t, asking: true } : t)) }
);
```

and after step 1b (the boss stays at quill with its card open; `asks` gains a mozox seat after quill, and the runs go
back before step 2):

```js
            // 1c. a near-side worker who asks raises its hand facing you over the table: over the over canvas (z 3),
            // its ! bubble beside its head
            await dev(h, { runs: NEAR_ASK_RUNS });
            await sleep(400);
            const nearAsk = await h.ev(`(() => {
                const seat = document.querySelector('[data-office-seat="fx-office-run-2:t3"]');
                seat?.scrollIntoView({ block: "center" });
                const hands = [...document.querySelectorAll('[data-office-root] img[data-office-sprite^="hand"]')].filter((i) => getComputedStyle(i).zIndex === "3");
                return { pose: seat?.dataset.officePose ?? null, nearHands: hands.length, asks: document.querySelectorAll('[data-office-bubble="!"]').length };
            })()`);
            await sleep(200);
            await h.shot("cdp-shots/cockpit-office-near-ask.png");
            await dev(h, { runs: OFFICE_RUNS });
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.scrollIntoView({ block: "center" })`);
            await sleep(400);
            rec(
                "1c. a near-side worker who asks raises its hand facing you over the table, its bubble beside its head",
                nearAsk?.pose === "hand" && nearAsk.nearHands >= 1 && nearAsk.asks >= 2,
                JSON.stringify(nearAsk)
            );
```

- [ ] **Step 2: Walking draws nothing (around steps 4 and 4b)**

Before step 4, `const drawsBeforeWalk = (await probe(h))?.sceneryDraws;`; after step 4b's `rec`, add:

```js
            p = await probe(h);
            rec(
                "4c. the boss walking and the frame clock draw the scenery no more",
                p?.sceneryDraws === drawsBeforeWalk,
                JSON.stringify({ before: drawsBeforeWalk, after: p?.sceneryDraws })
            );
```

- [ ] **Step 3: Step 7 clicks the floor through the root**

Replace the click's dispatch target `root.querySelector("[data-office-hall]")` with `root` itself:
`root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${spot.x}, clientY: r.top + ${spot.y} }));`
(the canvases let the click through to the root, whose own handler walks the boss).

- [ ] **Step 4: Step 9 after hours, one redraw, no plates**

Around step 9's `dev(h, { afterHours: true })`: read `const drawsDay = (await probe(h))?.sceneryDraws;` before it,
and after its wait:

```js
            const platesAfter = await h.ev(`document.querySelectorAll("[data-office-root] [data-office-plate]").length`);
            rec(
                "9b. after hours: the after-hours palette in one redraw, and no plates",
                p?.phase === "after" && p.sceneryDraws === drawsDay + 1 && platesAfter === 0,
                JSON.stringify({ phase: p?.phase, draws: [drawsDay, p?.sceneryDraws], platesAfter })
            );
```

- [ ] **Step 5: A desk at work going idle redraws once (step 12)**

Step 12 sets `quiet` (every agent idle, the runs gone): read `const drawsBusy = (await probe(h))?.sceneryDraws;`
before `dev(h, { quiet: true })`, and `const drawsQuiet = (await probe(h))?.sceneryDraws;` right after the cheer's
shot, before `dev(h, { quiet: false, energy: 63 })` (which brings the runs back and redraws again). After the
cheer's `rec`:

```js
            rec(
                "12b. the desks going idle redraw the scenery once",
                drawsQuiet === drawsBusy + 1,
                JSON.stringify({ before: drawsBusy, after: drawsQuiet })
            );
```

- [ ] **Step 6: The Cast by day and after hours (13, 13b), a theme switch open (13c) and away (15b); 14b reads the lounge from the probe**

Step 13: `sheet.length === p?.sheetSize && sheet.every((n) => n > 0) && p?.unresolved?.length === 0` (read `p`
before the `sheet` count, or read it again), and its name becomes `"13. every sprite in every look draws, every
colour token resolved"`. Its query keeps the sources, not only their lengths, for 13b:
`const daySrcs = await h.ev(`[...document.querySelectorAll("[data-office-sheet] img")].map((i) => i.getAttribute("src") ?? "")`);`
and `sheet` becomes `daySrcs.map((s) => s.length)`.

In place of step 13's closing `await dev(h, { sheet: false });`, the Cast after hours, then a theme switched with the
office open:

```js
            // 13b. the Cast after hours, as the canvas's Cast board draws it on B's floor: the same sheet in the
            // after-hours outline, shadow and chair
            await dev(h, { afterHours: true });
            await sleep(400);
            const nightSrcs = await h.ev(`[...document.querySelectorAll("[data-office-sheet] img")].map((i) => i.getAttribute("src") ?? "")`);
            p = await probe(h);
            rec(
                "13b. after hours, every sprite on the sheet draws again in the after-hours palette",
                p?.phase === "after" &&
                    nightSrcs.length === p.sheetSize &&
                    nightSrcs.every((s) => s.length > 0) &&
                    nightSrcs.every((s, i) => s !== daySrcs[i]),
                JSON.stringify({ phase: p?.phase, sprites: nightSrcs.length, changed: nightSrcs.filter((s, i) => s !== daySrcs[i]).length })
            );
            await h.shot("cdp-shots/cockpit-office-states-night.png");
            await dev(h, { sheet: false, afterHours: false });
            await sleep(400);

            // 13c. a theme switched with the office open: the building draws once more, and the boss's ring (the
            // accent) is drawn again in the new theme's colours, no stale cached colour
            const ring = () => h.ev(`document.querySelector("[data-office-ring]")?.getAttribute("src") ?? ""`);
            const themeDraws = (await probe(h))?.sceneryDraws;
            const claudeRing = await ring();
            ctx.prevTheme = await h.ev(`window.__cockpitOfficeTheme("graphite")`);
            await sleep(500);
            p = await probe(h);
            ctx.graphiteRing = await ring();
            await h.shot("cdp-shots/cockpit-office-theme.png");
            await h.ev(`window.__cockpitOfficeTheme(${JSON.stringify(ctx.prevTheme)})`);
            await sleep(500);
            rec(
                "13c. a theme switched with the office open redraws the building once and the ring in the new accent",
                ctx.prevTheme !== "graphite" &&
                    p?.sceneryDraws === themeDraws + 1 &&
                    claudeRing !== "" &&
                    ctx.graphiteRing !== "" &&
                    ctx.graphiteRing !== claudeRing &&
                    p.unresolved?.length === 0,
                JSON.stringify({ prevTheme: ctx.prevTheme, draws: [themeDraws, p?.sceneryDraws], ringChanged: ctx.graphiteRing !== claudeRing })
            );
```

(Every sprite has an outline, `O`, which is the phase's ink, so every source changes after hours.) The scenario
starts in the default theme, whose accent (clay) is not graphite's (blue): `prevTheme` is never `"graphite"` unless a
run cut short left it so, and teardown puts it back (below).

Step 14b: replace `document.querySelector('[data-office-floor="lounge"]')?.getBoundingClientRect()` with the lounge's
box from the probe, in page coordinates:

```js
                const L = window.__cockpitOfficeProbe().lounge;
                const R = document.querySelector("[data-office-root]").getBoundingClientRect();
                const floor = L && { left: R.left + L.x, top: R.top + L.y, right: R.left + L.x + L.w, bottom: R.top + L.y + L.h };
```

Step 15b, after step 15's `rec`: a theme switched while the office is in Cards, then the office opened again, draws
in the new theme (Task 4 keeps the theme it last drew in at module level):

```js
            // 15b. a theme switched while the office is away: opened again, its ring is the new theme's, not a stale
            // cached colour
            await toggleTo(h, "Cards");
            await sleep(400);
            const prevAway = await h.ev(`window.__cockpitOfficeTheme("graphite")`);
            ctx.prevTheme ??= prevAway;
            await sleep(400);
            await toggleTo(h, "Office");
            const backIn = (await waitForOffice(h)) == null;
            await settleBoss(h);
            const awayRing = await h.ev(`document.querySelector("[data-office-ring]")?.getAttribute("src") ?? ""`);
            await h.shot("cdp-shots/cockpit-office-theme-away.png");
            await h.ev(`window.__cockpitOfficeTheme(${JSON.stringify(prevAway)})`);
            await sleep(500);
            rec(
                "15b. a theme switched while the office is in Cards: opened again, it draws in the new theme",
                backIn && prevAway !== "graphite" && awayRing !== "" && awayRing === ctx.graphiteRing,
                JSON.stringify({ backIn, prevAway, sameAsOpen: awayRing === ctx.graphiteRing })
            );
```

(13c's graphite ring and 15b's are the same sprite in the same phase, so the same data URL.) In the scenario's
teardown, before `window.__cockpitOffice?.(null)`:
`if (ctx.prevTheme != null) await h.ev(`window.__cockpitOfficeTheme?.(${JSON.stringify(ctx.prevTheme)})`);`, so a run
cut short between a switch and its restore leaves no graphite theme behind.

- [ ] **Step 7: The bench times the building's draw and prints the office's own nodes**

Row 8's open time stops at the first `[data-office-desk]`, before the canvases paint in a later passive effect. In
`r.openMs`'s loop, wait for the desks and for every canvas to have painted:

```js
                    // drawn: the desks are in and each canvas has painted (a checkout from before the canvases has none)
                    const drawn = () =>
                        document.querySelector("[data-office-desk]") &&
                        [...document.querySelectorAll("[data-office-root] canvas[data-office-canvas]")].every((c) => c.dataset.officeDrawn != null);
                    for (let i = 0; i < 600 && !drawn(); i++) await new Promise((r) => requestAnimationFrame(r));
```

(The canvases mount in the same commit as the desks, so `every` never passes on an empty list once they exist; the
before checkout of Task 6 has no canvas, and there it stops at the first desk, as today.)

After `const open = await metrics(h);`:
`r.officeNodes = await h.ev('document.querySelector("[data-office-root]")?.getElementsByTagName("*").length ?? 0');`
and row 2's detail becomes `` `${r.nodesAdded} (the office ${r.officeNodes})` ``.

- [ ] **Step 8: The guide and the changelog**

`docs/guide/cockpit.md`, section **Văn phòng (Office)**, after its first paragraph:

```markdown
Văn phòng vẽ bằng pixel art nhìn từ trên xuống: trong giờ làm thì sáng, ngoài giờ (tối, đêm, cuối tuần) thì dịu lại;
mỗi người nhận ra nhờ kiểu tóc, và sếp (bạn) đội mũ. Phòng không ai làm việc thì tắt đèn.
```

`CHANGELOG.md`, top section, under `Changed`:

```markdown
- The Office view is drawn in pixel art: a bright office in work hours and a dim one after hours, people you can tell apart by their hair, the boss in a cap.
```

(No element count here: Task 6 measures it and adds it to this line.)

- [ ] **Step 9: Run the scenario**

```bash
ARC_BROWSER_CDP_PORT=9232 ARC_BROWSER_VITE_PORT=5232 ARC_DEV_DATA_DIR="$TMPDIR/arc-office-t5" node scripts/cdp/browser-app.mjs > "$TMPDIR/arc-office-t5.log" 2>&1 &
for i in $(seq 1 180); do grep -q "browser app ready" "$TMPDIR/arc-office-t5.log" && break; sleep 1; done
CDP_PORT=9232 node --experimental-websocket scripts/cdp/verify.mjs cockpit-office
```

Expected: every row PASS. Compare `cdp-shots/cockpit-office-main.png`, `-night.png`, `-states.png` and
`-states-night.png` with the canvas's `Main`, `Night` and `Cast` boards (its A and B casts), and look at
`-near-ask.png` (a hand up facing you over Billing export's table, a `!` beside its head), `-theme.png` and
`-theme-away.png` (the ring and the sign's frame in graphite's blue). Stop the app by its PID.

- [ ] **Step 10: Commit**

```bash
git add scripts/cdp/cockpitofficescenarios.mjs docs/guide/cockpit.md CHANGELOG.md
git commit -m "test(cockpit): the office scenario checks the two canvases, draws counted while walking and at the hours' end; the guide and the changelog"
```

---

### Task 6: Measure before and after, into RAM watch
**Depends on:** Task 5
**Files:** `docs/open-issues.md`, `CHANGELOG.md`

- [ ] **Step 1: A worktree at the run's base**

```bash
BASE=$(git merge-base HEAD main)
git worktree add --detach "$TMPDIR/arc-office-before" "$BASE"
(cd "$TMPDIR/arc-office-before" && node scripts/worktree-junctions.mjs prepare)
```

- [ ] **Step 2: Two benches each, alternating, each app on its own ports and store**

```bash
bench() { # $1 checkout, $2 port suffix
    (cd "$1" && ARC_BROWSER_CDP_PORT=92$2 ARC_BROWSER_VITE_PORT=52$2 ARC_DEV_DATA_DIR="$TMPDIR/arc-office-$2" \
        node scripts/cdp/browser-app.mjs > "$TMPDIR/arc-office-$2.log" 2>&1 & echo $! > "$TMPDIR/arc-office-$2.pid")
    for i in $(seq 1 180); do grep -q "browser app ready" "$TMPDIR/arc-office-$2.log" && break; sleep 1; done
    (cd "$1" && CDP_PORT=92$2 node --experimental-websocket scripts/cdp/verify.mjs cockpit-office-bench) | tee -a "$TMPDIR/arc-office-bench-$2.txt"
    kill "$(cat "$TMPDIR/arc-office-$2.pid")"
}
bench "$TMPDIR/arc-office-before" 41; bench "$PWD" 42; bench "$TMPDIR/arc-office-before" 41; bench "$PWD" 42
```

Before the first bench, give the before checkout this run's scenario file, so its bench prints the office's own
nodes too (the bench reads only dev hooks both checkouts have):
`cp scripts/cdp/cockpitofficescenarios.mjs "$TMPDIR/arc-office-before/scripts/cdp/"`. Each run prints its PASS/FAIL
table: keep both runs' rows 2–5 and 8 for each checkout.

- [ ] **Step 3: Write it under RAM watch**

In `docs/open-issues.md`, under `### (arcterm) RAM watch`, after the "Cockpit office, walking off React" bullet:

```markdown
- **Cockpit office in pixel art** (YYYY-MM-DD, `cockpit-office-bench`, the same 76-person roster; dev app in headless
  Chrome on the Mac, before and after interleaved, two runs each, each on its own ports and store): the office's own
  DOM nodes N → M (the floors, walls, windows, dark layers, screens, sign and desk parts are now two canvases at art
  resolution, ~X MB each); busy walking a → b % over Cards, reduced motion c → d %, quiet e → f %; heap g → h MB;
  sprites i → j; time to draw k → l ms. <one sentence: whether busy moved beyond the holds' noise of ±3 points>.
```

with the numbers measured, the canvas size from `W × H × 4` of the bench's plan, and every budget's verdict. A miss
is written as a miss.

- [ ] **Step 4: The changelog's number**

Task 5's `CHANGELOG.md` line ("The Office view is drawn in pixel art: …") carries no element count. When the office's
own nodes fell (N before, M after, both runs' mean), append ` It also draws with about K fewer page elements.` to
that line, K = N − M rounded to the nearest ten. When they did not fall, leave the line as it is.

- [ ] **Step 5: Clean up**

`task worktree:cleanup` refuses a detached checkout (`worktree-junctions.mjs` exits 1 after it has unlinked the
shared dirs), so unlink with the script, check the links are gone, then remove the checkout by hand:

```bash
# unlinks node_modules, src-tauri/target and dist/bin, then refuses the detached HEAD with exit 1: expected here
node scripts/worktree-junctions.mjs cleanup "$TMPDIR/arc-office-before"
# never remove the checkout while a link to the main checkout's dirs is left in it
for d in node_modules src-tauri/target dist/bin; do
    if [ -L "$TMPDIR/arc-office-before/$d" ]; then echo "still linked: $d"; exit 1; fi
done
# --force: the copied scenario file and the bench's fixture leave the checkout dirty
git worktree remove --force "$TMPDIR/arc-office-before"
rm -rf "$TMPDIR"/arc-office-4[12]
```

If a link is still there, stop and report it: do not remove the checkout.

- [ ] **Step 6: Commit**

```bash
git add docs/open-issues.md CHANGELOG.md
git commit -m "docs(open-issues): RAM watch: the cockpit office in pixel art, nodes and busy before and after the canvases"
```
