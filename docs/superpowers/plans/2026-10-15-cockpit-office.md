# Cockpit office implementation plan

**Spec:** `docs/superpowers/specs/2026-10-15-cockpit-office-design.md` (read it first; it is part 1 of 4, and only
part 1 is built here)

**Verify:** `node scripts/verify.mjs ./pkg/memgate`

**Check:** `node --max-old-space-size=4096 --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs cockpit-office cockpit-office-bench surface-smoke`

**Prototype:** .superpowers/design/cockpit-office/project

**Goal:** a **Cards | Office** toggle on the Cockpit that draws the same cards (and the Idle section's agents) as a
2D floor plan seen from above: a band per project (agents' room left, a glass meeting room per run right), the hall
with the lounge between, the boss you walk with the arrow keys, the card of the desk you stand at beside it, lights
off where no one works, a dotted path on `n`, night and energy from the clock and the 5-hour window; with its cost
in the RAM panel, Settings → Appearance → Office, and a CDP bench that holds the spec's budgets.

**Architecture:** frontend only: no Go, no wshrpc, no model call. Pure modules decide everything:
`officebehavior.ts` (who goes where, day and night, energy), `officeplanmodel.ts` (cards → rooms, desks, seats,
doors, walls, labels, office order), `officeboss.ts` (walls, doors, paths, the desk at the boss), `officeinputs.ts`
(cards → the plan's input), `plansprite.ts` (pose grids), `spritecache.ts` (grid → cached PNG, shared with the Run
office), `officeclock.ts` (the two clocks and the meter). `cockpitoffice.tsx` draws with plain DOM; the boss, the
walkers and the path dots are small components on their own atoms, so a walk step re-renders only them.
`cockpitsurface.tsx` swaps the grid for the office and hands it the very `AgentRow` / `LeadCard` it draws.

**Tech stack:** React 19, jotai (`atomWithStorage`), Tailwind 4 tokens, lucide-react, vitest, the CDP scenario
harness (headless Chrome on a Mac through `final-verify.mjs`).

The Verify line names one small Go package only because `verify.mjs` needs a pattern; this plan changes no Go. Its
final stage runs vitest.

## Global Constraints

- No raw hex or rgba in `.ts`/`.tsx`: colours are `--color-*` tokens and shadows `--shadow-*` tokens in
  `frontend/tailwindsetup.css` `@theme` (Task 1 adds the office's). Inline `style` may use `var(--color-…)`.
- Never run prettier on `scripts/*.mjs` (hand-formatted, 4-space). Check only files you touched; never `--write`
  the tree.
- No jsdom/render tests: pure logic in a `.ts` with a `.test.ts` beside it; the UI is verified by the CDP scenarios.
- Comments say why, lowercase, minimal. Copy is sentence case, plain verbs.
- The office calls no model and adds no wshrpc command, store or timer of its own beyond the two clocks
  (`officeclock.ts`); behaviour follows the Cockpit's coarse clock (`structuralNowAtom`).
- Budgets (spec "Benchmark"), verbatim: JS heap Office minus Cards ≤ 5 MB; DOM nodes added ≤ 2,000; main thread busy
  over the 30 s hold minus the Cards baseline ≤ 2 %; same under reduced motion ≤ 0.5 %; same in a quiet office ≤
  0.3 %; sprite cache entries ≤ 600; heap after switching back to Cards minus the Cards read before ≤ 1 MB; toggle
  click to the office drawn ≤ 150 ms. A miss is reported, never fixed by raising a budget.
- The Run office in Jarvis keeps its side view and its behaviour; Task 1 only moves its cache onto the shared one.

## Review Focus

- **A project with many runs** (six or more): its meeting rooms stack in the right column and the band grows; no
  two rooms overlap and every seat stays inside its room. Pinned in Task 3.
- **Agents with the same name**, or an empty project string: desks sort by name then id, so places never swap; an
  empty or blank project goes to Home. Pinned in Task 3.
- **A narrow window** (the Cockpit under 900 px wide): the plan keeps its minimum width and the office scrolls.
  Pinned in Task 3.
- **Work hours read back from storage as garbage** (strings, start ≥ end, out of range): the office falls back to
  9–18 instead of being dark all day. Pinned in Task 2.
- **A frame hitch while an arrow is held** (a 100 ms step): the boss still cannot pass through a wall. Pinned in
  Task 4.

---

### Task 1: Shared sprite cache, the floor plan's sprite set, the office tokens

**Depends on:** none
**Files:** `frontend/app/view/office/spritecache.ts`, `frontend/app/view/office/spritecache.test.ts`, `frontend/app/view/office/plansprite.ts`, `frontend/app/view/office/plansprite.test.ts`, `frontend/app/view/jarvis/officesprites.ts`, `frontend/app/view/jarvis/officesprite.ts`, `frontend/tailwindsetup.css`

**Interfaces:**
- Produces (`spritecache.ts`): `type Rgb = [number, number, number]`; `parseColor(value: string): Rgb | undefined`;
  `tokenRgb(name: string): Rgb | undefined`; `gridPixels(grid: string[], width: number, color: (code: string) => Rgb | undefined): Uint8ClampedArray`;
  `cachedSprite(ns: string, key: string, grid: string[], width: number, color: (code: string) => Rgb | undefined, cap?: number): string`;
  `spriteCacheStats(ns: string): { entries: number; bytes: number }`.
- Produces (`plansprite.ts`): `type PlanSprite` (18 names below); `type SeatPose = "sit" | "hand" | "cheer" | "doze" | "back" | "empty"`;
  `type WalkDir = "up" | "down" | "left" | "right"`; `PLAN_W = 12`, `SIDE_W = 14`, `PLAN_CELL = 3`, `PLAN_CACHE_CAP = 600`;
  `PLAN_SPRITES: Record<PlanSprite, string[]>`; `spriteWidth(s)`; `seatSprite(pose, frame: 0 | 1): PlanSprite | undefined`;
  `walkSprite(dir, frame): PlanSprite`; `mirrorOf(dir): boolean`; `HARNESS_SHIRT`, `OTHER_SHIRT`, `LEAD_SHIRT`,
  `BOSS_SHIRT`, `LANE_SHIRTS`, `PLAN_TOKENS`; `interface PlanOutfit { shirt: string; look: number; boss?: boolean }`;
  `shirtOf(harness?: string): string`; `planToken(code: string, o: PlanOutfit): string | undefined`;
  `planSpriteUrl(s: PlanSprite, o: PlanOutfit): string`.
- The Run office keeps `spriteUrl`, `spriteCacheSize`, `OFFICE_TOKENS`, `Outfit` in `officesprites.ts` with the same
  signatures; only their insides move onto `spritecache.ts` (namespace `"run"`).

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/office/spritecache.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedSprite, gridPixels, parseColor, spriteCacheStats } from "./spritecache";

describe("spritecache", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reads hex and rgb colours, and nothing else", () => {
        expect(parseColor(" #0a0b0c ")).toEqual([10, 11, 12]);
        expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
        expect(parseColor("rgba(4, 5, 6, 0.5)")).toEqual([4, 5, 6]);
        expect(parseColor("red")).toBeUndefined();
    });

    it("paints only the coloured cells, at the grid's width", () => {
        const px = gridPixels(["A.", ".B"], 2, (c) => (c === "A" ? [1, 2, 3] : undefined));
        expect(Array.from(px.slice(0, 4))).toEqual([1, 2, 3, 255]);
        expect(Array.from(px.slice(4, 8))).toEqual([0, 0, 0, 0]);
        expect(Array.from(px.slice(12, 16))).toEqual([0, 0, 0, 0]);
    });

    it("keeps each namespace apart and drops the oldest entry past its cap", () => {
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
        const white = () => [255, 255, 255] as [number, number, number];
        cachedSprite("t1", "a", ["A"], 1, white, 2);
        cachedSprite("t1", "b", ["A"], 1, white, 2);
        cachedSprite("t1", "c", ["A"], 1, white, 2);
        cachedSprite("t2", "a", ["A"], 1, white);
        expect(spriteCacheStats("t1").entries).toBe(2);
        expect(spriteCacheStats("t2").entries).toBe(1);
        expect(spriteCacheStats("none")).toEqual({ entries: 0, bytes: 0 });
    });
});
```

`frontend/app/view/office/plansprite.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    mirrorOf,
    PLAN_SPRITES,
    planToken,
    seatSprite,
    shirtOf,
    spriteWidth,
    walkSprite,
    type PlanSprite,
} from "./plansprite";

const ALL = Object.keys(PLAN_SPRITES) as PlanSprite[];

describe("plansprite", () => {
    it("has the eighteen sprites the canvas's States board draws", () => {
        expect(ALL).toHaveLength(18);
    });

    it("draws every sprite at its width, with known codes only", () => {
        for (const s of ALL) {
            for (const row of PLAN_SPRITES[s]) {
                expect(row.length, s).toBe(spriteWidth(s));
                expect(row, s).toMatch(/^[HSETNPKC.]+$/);
            }
        }
    });

    it("keeps a pose's two frames the same height", () => {
        const pairs: [PlanSprite, PlanSprite][] = [
            ["sit", "nod"],
            ["hand1", "hand2"],
            ["cheer1", "cheer2"],
            ["down1", "down2"],
            ["up1", "up2"],
            ["side1", "side2"],
        ];
        for (const [a, b] of pairs) {
            expect(PLAN_SPRITES[a].length, a).toBe(PLAN_SPRITES[b].length);
        }
    });

    it("stands 19 rows tall and sits 12 to 14", () => {
        for (const s of ["cup", "down1", "down2", "up1", "up2", "boss"] as PlanSprite[]) {
            expect(PLAN_SPRITES[s].length, s).toBe(19);
        }
        for (const s of ["sit", "nod", "doze", "yawn", "back", "hand1", "cheer1", "stretch"] as PlanSprite[]) {
            expect(PLAN_SPRITES[s].length, s).toBeGreaterThanOrEqual(12);
            expect(PLAN_SPRITES[s].length, s).toBeLessThanOrEqual(14);
        }
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

    it("gives the boss a paper tie and anyone else one in their shirt", () => {
        expect(planToken("N", { shirt: "--x", look: 1, boss: true })).toBe("--color-office-paper");
        expect(planToken("N", { shirt: "--x", look: 1 })).toBe("--x");
        expect(planToken("H", { shirt: "--x", look: 9 })).toBe("--color-office-hair-4");
        expect(planToken("H", { shirt: "--x", look: 0 })).toBe("--color-office-hair-1");
    });

    it("dresses a harness in its shirt, anything else in the other one", () => {
        expect(shirtOf("codex")).toBe("--color-office-shirt-codex");
        expect(shirtOf("opencode")).toBe("--color-office-shirt-other");
        expect(shirtOf(undefined)).toBe("--color-office-shirt-other");
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/office`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write `frontend/app/view/office/spritecache.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Draws a pixel grid once and keeps it as a PNG data URL, for both offices: the Run office's side view
// (view/jarvis/officesprites.ts, namespace "run") and the Cockpit office's floor plan (plansprite.ts, "plan").
// A namespace keeps each office's entries apart, so each bench counts only its own; a cap bounds a namespace, the
// oldest entry going first.

export type Rgb = [number, number, number];

const caches = new Map<string, Map<string, string>>();
const colors = new Map<string, Rgb | undefined>();

/** A computed custom property's value ("#rrggbb" or "rgb(r, g, b)") as bytes; anything else undefined. */
export function parseColor(value: string): Rgb | undefined {
    const v = value.trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

/** A --color-* token's value on the root, read once: people's colours are identity tokens no theme overrides. */
export function tokenRgb(name: string): Rgb | undefined {
    if (!colors.has(name)) {
        colors.set(name, parseColor(getComputedStyle(document.documentElement).getPropertyValue(name)));
    }
    return colors.get(name);
}

/** RGBA bytes for a grid `width` cells wide, row-major; ".", a missing cell or a code with no colour stays clear. */
export function gridPixels(
    grid: string[],
    width: number,
    color: (code: string) => Rgb | undefined
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * grid.length * 4);
    grid.forEach((row, y) => {
        for (let x = 0; x < width; x++) {
            const c = row[x];
            if (c == null || c === ".") {
                continue;
            }
            const rgb = color(c);
            if (rgb == null) {
                continue;
            }
            const i = (y * width + x) * 4;
            out[i] = rgb[0];
            out[i + 1] = rgb[1];
            out[i + 2] = rgb[2];
            out[i + 3] = 255;
        }
    });
    return out;
}

/** The grid drawn once and kept under ns/key, as a data URL; "" when the page cannot draw (no 2d context). */
export function cachedSprite(
    ns: string,
    key: string,
    grid: string[],
    width: number,
    color: (code: string) => Rgb | undefined,
    cap = Number.POSITIVE_INFINITY
): string {
    let cache = caches.get(ns);
    if (cache == null) {
        cache = new Map();
        caches.set(ns, cache);
    }
    const hit = cache.get(key);
    if (hit != null) {
        return hit;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = grid.length;
    // willReadFrequently keeps the canvas in software: a GPU-backed one made toDataURL ~1.2 ms a sprite (the run
    // office's first open spent 80-95 ms there), a software one ~0.07 ms
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let url = "";
    if (ctx != null) {
        // createImageData rather than new ImageData(pixels, ...): the constructor's typing rejects a shared-buffer array
        const image = ctx.createImageData(width, grid.length);
        image.data.set(gridPixels(grid, width, color));
        ctx.putImageData(image, 0, 0);
        url = canvas.toDataURL("image/png");
    }
    if (cache.size >= cap) {
        const oldest = cache.keys().next().value;
        if (oldest != null) {
            cache.delete(oldest);
        }
    }
    cache.set(key, url);
    return url;
}

/** What a namespace holds: its entries, and their data URLs' total length in bytes. */
export function spriteCacheStats(ns: string): { entries: number; bytes: number } {
    const cache = caches.get(ns);
    let bytes = 0;
    cache?.forEach((url) => {
        bytes += url.length;
    });
    return { entries: cache?.size ?? 0, bytes };
}
```

- [ ] **Step 4: Write `frontend/app/view/office/plansprite.ts`**

The grids are the canvas's States board (`.superpowers/design/cockpit-office/project/States.dc.html`), copied cell for
cell; `N` is the tie (a role, so the boss's paper tie and anyone else's shirt-coloured one share a grid).

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's people, seen from above (cockpit office spec, "Drawing"): a grid per sprite, 12 columns (the
// sideways walk 14), a role code per cell, never a colour. planSpriteUrl draws one in an outfit once, through the
// shared cache (namespace "plan", capped at 600). The Run office keeps its side-view set (view/jarvis/officesprite.ts).

import { cachedSprite, tokenRgb } from "./spritecache";

// H hair, S skin, E eyes and mouth, T shirt, N tie (paper on the boss, the shirt on anyone else), P pants, K shoes,
// C the cup
export type PlanSprite =
    | "sit"
    | "nod"
    | "hand1"
    | "hand2"
    | "cheer1"
    | "cheer2"
    | "doze"
    | "yawn"
    | "stretch"
    | "back"
    | "cup"
    | "down1"
    | "down2"
    | "up1"
    | "up2"
    | "side1"
    | "side2"
    | "boss";
export type SeatPose = "sit" | "hand" | "cheer" | "doze" | "back" | "empty";
export type WalkDir = "up" | "down" | "left" | "right";

export const PLAN_W = 12;
export const SIDE_W = 14;
export const PLAN_CELL = 3;
export const PLAN_CACHE_CAP = 600;

const HEAD = [
    "....HHHH....",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..HSSSSSSH..",
    "..SSESSESS..",
    "..SSSSSSSS..",
    "...SSSSSS...",
    "....SSSS....",
];
const BACK_HEAD = [
    "....HHHH....",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..HHHHHHHH..",
    "..SHHHHHHS..",
    "...HHHHHH...",
    "....SSSS....",
];
const BODY = ["..TTTTTTTT..", ".TTTTTTTTTT.", ".TTTTTTTTTT.", ".TTTTTTTTTT."];
const TORSO = ["..TTTTTTTT..", ".TTTTTTTTTT.", ".TTTTTTTTTT.", ".STTTTTTTTS.", ".S.TTTTTT.S."];
const TIE = ["..TTNNNNTT..", ".TTTTNNTTTT.", ".TTTTNNTTTT.", ".STTTNNTTTS.", ".S.TTTTTT.S."];
const LEGS = ["...TTTTTT...", "...PPPPPP...", "...PP..PP...", "...PP..PP...", "...PP..PP...", "..KKK..KKK.."];
const LEGS1 = ["...TTTTTT...", "...PPPPPP...", "...PP..PP...", "...PP..PP...", "..KKK..PP...", ".......KKK.."];
const LEGS2 = ["...TTTTTT...", "...PPPPPP...", "...PP..PP...", "...PP..PP...", "...PP.KKK...", "..KKK......."];
const CHEER_TOP = [".SS......SS.", ".TT.HHHH.TT.", "..THHHHHHT.."];
const CHEER_TOP2 = ["SS........SS", "TT..HHHH..TT", ".TTHHHHHHTT."];
const SIDE_TOP = [
    "....HHHH......",
    "...HHHHHH.....",
    "...HHHSSS.....",
    "...HHSSES.....",
    "...HHSSSSS....",
    "....SSSS......",
    ".....SS.......",
    "...TTTTTT.....",
    "..TTTTTTTT....",
    "..TTTTTTTT....",
    "..TTTTTTTT....",
];
const closed = (rows: string[]) => rows.map((r) => r.replace(/E/g, "S"));

export const PLAN_SPRITES: Record<PlanSprite, string[]> = {
    sit: [...HEAD, ...BODY],
    nod: ["............", ...HEAD, ...BODY.slice(0, 3)],
    doze: closed([...HEAD, ...BODY]),
    yawn: [...HEAD.slice(0, 4), "..SSSSSSSS..", "..SSSSSSSS..", "...SSEESS...", "....SSSS....", ...BODY],
    hand1: [
        "..........SS",
        "..........TT",
        "....HHHH..TT",
        "..HHHHHHHHTT",
        "..HHHHHHHHT.",
        "..HSSSSSSH..",
        "..SSESSESS..",
        "..SSSSSSSS..",
        "...SSSSSS...",
        "....SSSS....",
        ...BODY,
    ],
    hand2: [
        ".........SS.",
        ".........TT.",
        "....HHHH.TT.",
        "..HHHHHHHTT.",
        "..HHHHHHHHT.",
        "..HSSSSSSH..",
        "..SSESSESS..",
        "..SSSSSSSS..",
        "...SSSSSS...",
        "....SSSS....",
        ...BODY,
    ],
    cheer1: [...CHEER_TOP, ...HEAD.slice(2), ...BODY],
    cheer2: [...CHEER_TOP2, ...HEAD.slice(2), ...BODY],
    stretch: closed([...CHEER_TOP, ...HEAD.slice(2), ...BODY]),
    back: [...BACK_HEAD, ...BODY],
    cup: [...HEAD, "..TTTTTTTT..", ".TTTTTTTTTT.", ".TTTTTTTTSCC", ".STTTTTTTSCC", ".S.TTTTTT...", ...LEGS],
    down1: [...HEAD, ...TIE, ...LEGS1],
    down2: [...HEAD, ...TIE, ...LEGS2],
    up1: [...BACK_HEAD, ...TORSO, ...LEGS1],
    up2: [...BACK_HEAD, ...TORSO, ...LEGS2],
    side1: [
        ...SIDE_TOP,
        "..STTTTTTS....",
        "...PPPPPP.....",
        "..PPP..PPP....",
        ".PPP....PPP...",
        "PPP......PPP..",
        "KKKK.....KKKK.",
    ],
    side2: [
        ...SIDE_TOP,
        "..STTTTTTS....",
        "...PPPPPP.....",
        "....PPPP......",
        "....PPPP......",
        "...PP.PPP.....",
        "..KKK.KKKK....",
    ],
    // the boss at a desk: its back to you, looking at it
    boss: [...BACK_HEAD, ...TORSO, ...LEGS],
};

export function spriteWidth(s: PlanSprite): number {
    return s === "side1" || s === "side2" ? SIDE_W : PLAN_W;
}

/** The sprite a seated pose shows on a frame; undefined for an empty chair. A sitting person nods on frame 1. */
export function seatSprite(pose: SeatPose, frame: 0 | 1): PlanSprite | undefined {
    switch (pose) {
        case "sit":
            return frame ? "nod" : "sit";
        case "hand":
            return frame ? "hand2" : "hand1";
        case "cheer":
            return frame ? "cheer2" : "cheer1";
        case "doze":
            return "doze";
        case "back":
            return "back";
        case "empty":
            return undefined;
    }
}

/** The sprite someone walking shows; left is the sideways sprite mirrored in CSS (mirrorOf). */
export function walkSprite(dir: WalkDir, frame: 0 | 1): PlanSprite {
    if (dir === "up") {
        return frame ? "up2" : "up1";
    }
    if (dir === "down") {
        return frame ? "down2" : "down1";
    }
    return frame ? "side2" : "side1";
}

export function mirrorOf(dir: WalkDir): boolean {
    return dir === "left";
}

// every token name spelled out in full: Tailwind 4 drops an @theme variable whose name never appears literally in
// source, so a name built from a template string would read back empty and the person would draw with no colour
export const HARNESS_SHIRT: Record<string, string> = {
    claude: "--color-office-shirt-claude",
    codex: "--color-office-shirt-codex",
    pi: "--color-office-shirt-pi",
    agy: "--color-office-shirt-agy",
};
export const OTHER_SHIRT = "--color-office-shirt-other";
export const LEAD_SHIRT = "--color-office-lead";
export const BOSS_SHIRT = "--color-office-boss";
export const LANE_SHIRTS = [
    "--color-graphlane-1",
    "--color-graphlane-2",
    "--color-graphlane-3",
    "--color-graphlane-4",
    "--color-graphlane-5",
    "--color-graphlane-6",
];
const HAIR = ["--color-office-hair-1", "--color-office-hair-2", "--color-office-hair-3", "--color-office-hair-4"];
const SKIN = ["--color-office-skin-1", "--color-office-skin-2", "--color-office-skin-3", "--color-office-skin-4"];
const PANTS = "--color-office-pants";
const INK = "--color-office-ink";
const PAPER = "--color-office-paper";
const CUP = "--color-office-cup";

/** Every property planSpriteUrl can read, for the probe's unresolved check (cockpit-office). */
export const PLAN_TOKENS: string[] = [
    ...HAIR,
    ...SKIN,
    ...Object.values(HARNESS_SHIRT),
    OTHER_SHIRT,
    LEAD_SHIRT,
    BOSS_SHIRT,
    ...LANE_SHIRTS,
    PANTS,
    INK,
    PAPER,
    CUP,
];

export interface PlanOutfit {
    shirt: string; // a --color-* token name
    look: number; // 1..4, skin and hair
    boss?: boolean;
}

export function shirtOf(harness: string | undefined): string {
    return (harness != null && HARNESS_SHIRT[harness]) || OTHER_SHIRT;
}

/** The token a cell code draws in, for an outfit; a look out of range clamps to 1..4. */
export function planToken(code: string, o: PlanOutfit): string | undefined {
    const look = Math.min(4, Math.max(1, Math.round(o.look) || 1)) - 1;
    switch (code) {
        case "H":
            return HAIR[look];
        case "S":
            return SKIN[look];
        case "E":
        case "K":
            return INK;
        case "T":
            return o.shirt;
        case "N":
            return o.boss ? PAPER : o.shirt;
        case "P":
            return PANTS;
        case "C":
            return CUP;
        default:
            return undefined;
    }
}

/** The sprite in the outfit, drawn once; "" when the page cannot draw. */
export function planSpriteUrl(s: PlanSprite, o: PlanOutfit): string {
    const key = `${s}|${o.shirt}|${o.look}|${o.boss ? 1 : 0}`;
    return cachedSprite(
        "plan",
        key,
        PLAN_SPRITES[s],
        spriteWidth(s),
        (code) => {
            const t = planToken(code, o);
            return t != null ? tokenRgb(t) : undefined;
        },
        PLAN_CACHE_CAP
    );
}
```

- [ ] **Step 5: Run the two test files**

Run: `npx vitest run frontend/app/view/office`
Expected: PASS (10 tests).

- [ ] **Step 6: Move the Run office's cache onto the shared one**

In `frontend/app/view/jarvis/officesprites.ts`:

1. Replace the import line
   `import { gridPixels, parseColor, POSES, SPRITE_W, type CellRole, type SpritePose } from "./officesprite";`
   with:
   ```ts
   import { cachedSprite, spriteCacheStats, tokenRgb } from "@/app/view/office/spritecache";
   import { POSES, SPRITE_W, type CellRole, type SpritePose } from "./officesprite";
   ```
2. Delete `const cache = new Map<string, string>();`, `const colors = new Map<...>();` and the whole
   `function token(name: string)` (the shared cache owns these now).
3. Replace the body of `spriteUrl` with:
   ```ts
   export function spriteUrl(pose: SpritePose, o: Outfit): string {
       const key = `${pose}|${o.visitor ? "v" : o.shirt}|${o.visitor ? 3 : o.look}`;
       return cachedSprite("run", key, POSES[pose], SPRITE_W, (r) => tokenRgb(roleToken(r as CellRole, o)));
   }
   ```
4. Replace the body of `spriteCacheSize` with `return spriteCacheStats("run").entries;`.
5. In the header comment, after "Draws a pose in an outfit once and keeps it (run office spec, "Drawing")", add
   "; the canvas and the cache are view/office/spritecache.ts, namespace "run"".

In `frontend/app/view/jarvis/officesprite.ts`, delete its own `parseColor` function and put in its place:

```ts
// one parser for both offices (view/office/spritecache.ts); re-exported for this module's own test
export { parseColor } from "@/app/view/office/spritecache";
```

Leave its `gridPixels` (14 columns) as it is.

- [ ] **Step 7: Add the office tokens**

In `frontend/tailwindsetup.css`, inside `@theme`, right after `--color-office-visitor: #7b7972; /* a reviewer's shirt */`:

```css
    /* The cockpit office (docs/superpowers/specs/2026-10-15-cockpit-office-design.md, "Drawing"): shirts by harness
       and the boss, and the floor plan's building, light and cup. Like the run office's people they stay at these
       values in every theme: the building is scenery, and a theme re-skins the app, not the office. */
    --color-office-shirt-claude: #d98a6a;
    --color-office-shirt-codex: #8fa0b3;
    --color-office-shirt-pi: #7fbf8f;
    --color-office-shirt-agy: #6f8fe8;
    --color-office-shirt-other: #b39ddb;
    --color-office-boss: #55657f;
    --color-office-cup: #efe9dc;
    --color-office-wall-top: #8f897f;
    --color-office-wall-face: #5e5952;
    --color-office-wood-1: #3f3229; /* a plank */
    --color-office-wood-2: #372b23; /* the seam between planks */
    --color-office-tile-1: #35383b;
    --color-office-tile-2: #303235;
    --color-office-carpet: #36302f;
    --color-office-hall: #2b2a29;
    --color-office-desk-top: #7a746b;
    --color-office-desk-face: #57524b;
    --color-office-sofa: #6a4a4a;
    --color-office-brick: #5a3a31;
    --color-office-mortar: #3f2822;
    --color-office-window-day: #7d8da0;
    --color-office-window-night: #232838;
    --color-office-plant: #34402f;
    --color-office-night: rgba(10, 14, 32, 0.45); /* the tint over the floors after hours */
    --color-office-dark: rgba(8, 8, 10, 0.5); /* a room with no one at work */
    --color-office-lamp: #f3d48a;
    --shadow-office-sign: 0 0 10px rgba(217, 119, 87, 0.4); /* the ARCTERM sign's glow by day */
    --shadow-office-sign-night: 0 0 18px rgba(217, 119, 87, 0.6);
    --shadow-office-lamp: 0 0 22px 8px rgba(243, 212, 138, 0.35); /* a desk lamp's pool of light */
```

- [ ] **Step 8: Run the office tests and the Run office's**

Run: `npx vitest run frontend/app/view/office frontend/app/view/jarvis/officesprite.test.ts frontend/app/view/jarvis/officemodel.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/view/office frontend/app/view/jarvis/officesprites.ts frontend/app/view/jarvis/officesprite.ts frontend/tailwindsetup.css
git commit -m "feat(cockpit): office sprite set seen from above, a sprite cache shared with the run office, the office tokens"
```

---

### Task 2: Behaviour, clocks and the office's settings

**Depends on:** none
**Files:** `frontend/app/view/agents/officebehavior.ts`, `frontend/app/view/agents/officebehavior.test.ts`, `frontend/app/view/office/officeclock.ts`, `frontend/app/view/office/officeclock.test.ts`, `frontend/app/view/agents/officestore.ts`, `frontend/app/view/agents/officestore.test.ts`

**Interfaces:**
- Produces (`officebehavior.ts`): `COFFEE_AFTER_MS = 300_000` (the Finished window, `IDLE_GRACE_MS`),
  `SOFA_AFTER_MS = 600_000`, `CHEER_MS = 1500`, `STRETCH_MS = 1500`, `MAX_WALKERS = 3`;
  `type Away = "coffee" | "sofa"`; `type Energy = "fresh" | "yawny" | "tired"`;
  `interface WorkHours { start: number; end: number }`; `DEFAULT_HOURS`;
  `interface BehaviorAgent { id: string; state: "asking" | "working" | "idle"; idleSince?: number; finished: boolean }`;
  `idHash(id): number`; `lookOf(id): number`; `awayTarget(a: BehaviorAgent, now: number): Away | undefined`;
  `admitWalkers(waiting: { id: string; idleSince?: number }[], walking: number): string[]`;
  `afterHours(d: Date, h: WorkHours): boolean`; `sanitizeHours(v: unknown): WorkHours`;
  `energyOf(pct?: number): Energy`; `yawnsNow(id: string, tick: number, e: Energy): boolean`;
  `isReset(prev?: number, next?: number): boolean`; `shortAge(ms: number): string`.
- Produces (`officeclock.ts`): `FRAME_MS = 450`; `officeTickAtom: PrimitiveAtom<number>`;
  `interface OfficeCounts { people: number; walking: number; animated: number }`;
  `officeCountsAtom: PrimitiveAtom<OfficeCounts | null>`; `clockShouldRun(o: { need: boolean; on: boolean; hidden: boolean; reduced: boolean }): boolean`;
  `class OfficeMeter { record(at, ms); share(now): number }`; `officeMeter`; `officeClocks(): { frame: boolean; walk: boolean }`;
  `setOfficeRoot(el: HTMLElement | null)`; `officeDomNodes(): number`; `useFrameClock(need: boolean, on: boolean): void`;
  `useWalkLoop(step: (dtMs: number) => boolean): () => void` (returns a stable `kick`).
- Produces (`officestore.ts`): `type CockpitView = "cards" | "office"`; `cockpitViewAtom`, `officeHoursAtom`,
  `officeAnimationAtom` (all `atomWithStorage`, keys `cockpit.view`, `cockpit.office.hours`,
  `cockpit.office.animation`); `DEFAULT_COCKPIT_VIEW`, `DEFAULT_OFFICE_ANIMATION`; `cockpitView(v: unknown)`,
  `officeAnimation(v: unknown)`.

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/agents/officebehavior.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    admitWalkers,
    afterHours,
    awayTarget,
    DEFAULT_HOURS,
    energyOf,
    idHash,
    isReset,
    lookOf,
    sanitizeHours,
    shortAge,
    yawnsNow,
} from "./officebehavior";

const NOW = 10_000_000;
const idle = (ago: number, finished = false) => ({ id: "a", state: "idle" as const, idleSince: NOW - ago, finished });

describe("officebehavior", () => {
    it("sends an idle agent past the Finished window to the coffee, and to the sofa after ten minutes", () => {
        expect(awayTarget(idle(2 * 60_000, true), NOW)).toBeUndefined();
        expect(awayTarget(idle(6 * 60_000, true), NOW)).toBeUndefined();
        expect(awayTarget(idle(4 * 60_000), NOW)).toBeUndefined();
        expect(awayTarget(idle(5 * 60_000), NOW)).toBe("coffee");
        expect(awayTarget(idle(10 * 60_000), NOW)).toBe("sofa");
        expect(awayTarget({ id: "w", state: "working", finished: false }, NOW)).toBeUndefined();
        expect(awayTarget({ id: "n", state: "idle", finished: false }, NOW)).toBeUndefined();
    });

    it("lets at most three walk at once, the longest idle first", () => {
        const waiting = [
            { id: "c", idleSince: 30 },
            { id: "a", idleSince: 10 },
            { id: "b", idleSince: 20 },
            { id: "d", idleSince: 40 },
        ];
        expect(admitWalkers(waiting, 0)).toEqual(["a", "b", "c"]);
        expect(admitWalkers(waiting, 2)).toEqual(["a"]);
        expect(admitWalkers(waiting, 3)).toEqual([]);
    });

    it("is after hours before the start, from the end, and all weekend", () => {
        // 2026-10-12 is a Monday, 2026-10-17 a Saturday
        expect(afterHours(new Date(2026, 9, 12, 8, 59), DEFAULT_HOURS)).toBe(true);
        expect(afterHours(new Date(2026, 9, 12, 9, 0), DEFAULT_HOURS)).toBe(false);
        expect(afterHours(new Date(2026, 9, 12, 17, 59), DEFAULT_HOURS)).toBe(false);
        expect(afterHours(new Date(2026, 9, 12, 18, 0), DEFAULT_HOURS)).toBe(true);
        expect(afterHours(new Date(2026, 9, 17, 12, 0), DEFAULT_HOURS)).toBe(true);
    });

    it("reads stored hours back, falling back to 9 to 18 on anything odd", () => {
        expect(sanitizeHours({ start: 8, end: 17 })).toEqual({ start: 8, end: 17 });
        expect(sanitizeHours({ start: 18, end: 9 })).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours({ start: "9", end: "18" })).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours({ start: -1, end: 24 })).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours(null)).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours("garbage")).toEqual(DEFAULT_HOURS);
    });

    it("turns the 5-hour window into tiredness", () => {
        expect(energyOf(undefined)).toBe("fresh");
        expect(energyOf(69.9)).toBe("fresh");
        expect(energyOf(70)).toBe("yawny");
        expect(energyOf(89.9)).toBe("yawny");
        expect(energyOf(90)).toBe("tired");
    });

    it("yawns one frame in eight when yawny, one in four when tired, never when fresh", () => {
        const count = (e: "fresh" | "yawny" | "tired") =>
            Array.from({ length: 8 }, (_, t) => yawnsNow("loom", t, e)).filter(Boolean).length;
        expect(count("fresh")).toBe(0);
        expect(count("yawny")).toBe(1);
        expect(count("tired")).toBe(2);
    });

    it("sees a reset from 70 % or more to under 20 %", () => {
        expect(isReset(75, 5)).toBe(true);
        expect(isReset(65, 5)).toBe(false);
        expect(isReset(75, 25)).toBe(false);
        expect(isReset(undefined, 5)).toBe(false);
    });

    it("keeps an agent's look and hash", () => {
        expect(idHash("loom")).toBe(idHash("loom"));
        for (const id of ["a", "b", "loom", "quill", "fx-office-scratch"]) {
            expect(lookOf(id)).toBeGreaterThanOrEqual(1);
            expect(lookOf(id)).toBeLessThanOrEqual(4);
        }
    });

    it("says an age in minutes under an hour, else in hours", () => {
        expect(shortAge(10_000)).toBe("1m");
        expect(shortAge(14 * 60_000)).toBe("14m");
        expect(shortAge(130 * 60_000)).toBe("2h");
    });
});
```

`frontend/app/view/office/officeclock.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { clockShouldRun, OfficeMeter } from "./officeclock";

describe("officeclock", () => {
    it("runs a clock only when something needs it, it is on, the window shows, and motion is allowed", () => {
        const on = { need: true, on: true, hidden: false, reduced: false };
        expect(clockShouldRun(on)).toBe(true);
        expect(clockShouldRun({ ...on, need: false })).toBe(false);
        expect(clockShouldRun({ ...on, on: false })).toBe(false);
        expect(clockShouldRun({ ...on, hidden: true })).toBe(false);
        expect(clockShouldRun({ ...on, reduced: true })).toBe(false);
    });

    it("shares the office's JS time over the last ten seconds, as a percent of one core", () => {
        const m = new OfficeMeter();
        m.record(1_000, 30);
        m.record(5_000, 20);
        expect(m.share(10_000)).toBe(0.5);
        expect(m.share(12_000)).toBe(0.2);
        expect(m.share(30_000)).toBe(0);
    });
});
```

`frontend/app/view/agents/officestore.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { cockpitView, officeAnimation } from "./officestore";

describe("officestore", () => {
    it("reads the view back as cards unless it says office", () => {
        expect(cockpitView("office")).toBe("office");
        expect(cockpitView("cards")).toBe("cards");
        expect(cockpitView("anything")).toBe("cards");
        expect(cockpitView(undefined)).toBe("cards");
    });

    it("keeps the animation on unless it is explicitly off", () => {
        expect(officeAnimation(false)).toBe(false);
        expect(officeAnimation(true)).toBe(true);
        expect(officeAnimation("off")).toBe(true);
        expect(officeAnimation(undefined)).toBe(true);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officebehavior.test.ts frontend/app/view/office/officeclock.test.ts frontend/app/view/agents/officestore.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write `frontend/app/view/agents/officebehavior.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Cockpit office's people do on their own (cockpit office spec, "Personality, day and night, energy"): idle
// people past the Finished window go to the lounge, at most three walk at once, the office follows the work hours,
// and the 5-hour window sets how tired everyone is. Pure: no React and no clock; callers pass the time.

// the Cockpit's Finished window (IDLE_GRACE_MS): past it the grid parks an idle agent in the Idle section, and the
// office sends it to the lounge
export const COFFEE_AFTER_MS = 300_000;
export const SOFA_AFTER_MS = 600_000;
export const CHEER_MS = 1500;
export const STRETCH_MS = 1500;
export const MAX_WALKERS = 3;

export type Away = "coffee" | "sofa";
export type Energy = "fresh" | "yawny" | "tired";
export interface WorkHours {
    start: number;
    end: number;
}
export const DEFAULT_HOURS: WorkHours = { start: 9, end: 18 };

export interface BehaviorAgent {
    id: string;
    state: "asking" | "working" | "idle";
    idleSince?: number;
    finished: boolean;
}

/** FNV-1a over the id, so an agent keeps its look and its yawn offset. */
export function idHash(id: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

/** Skin and hair, 1 to 4. */
export function lookOf(id: string): number {
    return (idHash(id) % 4) + 1;
}

/** Where an idle agent goes: the coffee machine past the Finished window, the sofa from ten minutes; none while
 * it is still in the window, at work, or of unknown age. */
export function awayTarget(a: BehaviorAgent, now: number): Away | undefined {
    if (a.state !== "idle" || a.finished || a.idleSince == null) {
        return undefined;
    }
    const idle = now - a.idleSince;
    return idle >= SOFA_AFTER_MS ? "sofa" : idle >= COFFEE_AFTER_MS ? "coffee" : undefined;
}

/** Of those waiting to walk, the ones that may start while `walking` already are: the longest idle first. */
export function admitWalkers(waiting: { id: string; idleSince?: number }[], walking: number): string[] {
    const room = Math.max(0, MAX_WALKERS - walking);
    return [...waiting]
        .sort((a, b) => (a.idleSince ?? 0) - (b.idleSince ?? 0) || a.id.localeCompare(b.id))
        .slice(0, room)
        .map((w) => w.id);
}

/** Outside work hours: before the start, from the end on, and all of Saturday and Sunday. */
export function afterHours(d: Date, h: WorkHours): boolean {
    const day = d.getDay();
    if (day === 0 || day === 6) {
        return true;
    }
    const hour = d.getHours();
    return hour < h.start || hour >= h.end;
}

/** Hours read back from storage: whole hours 0 to 23 with the start before the end, else 9 to 18. */
export function sanitizeHours(v: unknown): WorkHours {
    const o = (typeof v === "object" && v != null ? v : {}) as Record<string, unknown>;
    const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 23;
    return ok(o.start) && ok(o.end) && o.start < o.end ? { start: o.start, end: o.end } : DEFAULT_HOURS;
}

/** The 5-hour window's use as tiredness: under 70 % fresh, 70 to 90 yawny, 90 and over tired; unknown is fresh. */
export function energyOf(pct: number | undefined): Energy {
    if (pct == null || Number.isNaN(pct)) {
        return "fresh";
    }
    return pct >= 90 ? "tired" : pct >= 70 ? "yawny" : "fresh";
}

/** Whether a working person yawns on this tick: one frame in eight when yawny, one in four when tired. */
export function yawnsNow(id: string, tick: number, e: Energy): boolean {
    if (e === "fresh") {
        return false;
    }
    return (idHash(id) + tick) % (e === "tired" ? 4 : 8) === 0;
}

/** The 5-hour window reset: from 70 % or more to under 20 %. */
export function isReset(prev: number | undefined, next: number | undefined): boolean {
    return prev != null && next != null && prev >= 70 && next < 20;
}

/** An age for a label: minutes under an hour, else hours. */
export function shortAge(ms: number): string {
    const m = Math.max(1, Math.floor(ms / 60_000));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}
```

- [ ] **Step 4: Write `frontend/app/view/office/officeclock.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's two clocks and what they cost (cockpit office spec, "Motion" and "Its cost in the RAM panel").
// The frame clock flips two-frame poses every 450 ms; the walk loop moves people on animation frames. Each runs only
// while something needs it, both stop when the window is hidden, under reduced motion, or with the animation off,
// and every step is timed into the meter the RAM panel's Office line reads.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

export const FRAME_MS = 450;
export const METER_WINDOW_MS = 10_000;
// a longer gap than this (a hidden window, a long task) moves people as if this much time passed, not the whole gap
const MAX_STEP_MS = 100;

/** Counts up every frame; a two-frame pose shows frame tick % 2. */
export const officeTickAtom = atom(0) as PrimitiveAtom<number>;

export interface OfficeCounts {
    people: number;
    walking: number;
    animated: number;
}
/** What the office draws; null while it is not mounted, so the RAM panel has no Office line. */
export const officeCountsAtom = atom<OfficeCounts | null>(null) as PrimitiveAtom<OfficeCounts | null>;

export function clockShouldRun(o: { need: boolean; on: boolean; hidden: boolean; reduced: boolean }): boolean {
    return o.need && o.on && !o.hidden && !o.reduced;
}

/** The office's own JS time, sample by sample, kept for the last ten seconds. */
export class OfficeMeter {
    private samples: { at: number; ms: number }[] = [];

    record(at: number, ms: number): void {
        this.samples.push({ at, ms });
        this.trim(at);
    }

    /** JS time over the window as a percent of one core, to 0.1. */
    share(now: number): number {
        this.trim(now);
        const ms = this.samples.reduce((s, x) => s + x.ms, 0);
        return Math.round((ms / METER_WINDOW_MS) * 1000) / 10;
    }

    private trim(now: number): void {
        const from = now - METER_WINDOW_MS;
        let i = 0;
        while (i < this.samples.length && this.samples[i].at < from) {
            i++;
        }
        if (i > 0) {
            this.samples.splice(0, i);
        }
    }
}
export const officeMeter = new OfficeMeter();

const clocks = { frame: false, walk: false };
let root: HTMLElement | null = null;

/** Whether each clock runs, for the probe and the Office line. */
export function officeClocks(): { frame: boolean; walk: boolean } {
    return { ...clocks };
}

export function setOfficeRoot(el: HTMLElement | null): void {
    root = el;
}

/** The office's DOM nodes, counted when asked: the RAM panel asks once a second while it is open. */
export function officeDomNodes(): number {
    return root ? root.getElementsByTagName("*").length : 0;
}

function timed(fn: () => void): void {
    const t = performance.now();
    try {
        fn();
    } finally {
        officeMeter.record(Date.now(), performance.now() - t);
    }
}

/** The frame clock: ticks while `need` and `on`, the window shows, and motion is allowed. */
export function useFrameClock(need: boolean, on: boolean): void {
    useEffect(() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
        let timer: number | undefined;
        const sync = () => {
            const run = clockShouldRun({ need, on, hidden: document.hidden, reduced: reduce.matches });
            if (run && timer == null) {
                timer = window.setInterval(
                    () => timed(() => globalStore.set(officeTickAtom, globalStore.get(officeTickAtom) + 1)),
                    FRAME_MS
                );
            } else if (!run && timer != null) {
                window.clearInterval(timer);
                timer = undefined;
                globalStore.set(officeTickAtom, 0);
            }
            clocks.frame = timer != null;
        };
        sync();
        document.addEventListener("visibilitychange", sync);
        reduce.addEventListener("change", sync);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            reduce.removeEventListener("change", sync);
            if (timer != null) {
                window.clearInterval(timer);
            }
            clocks.frame = false;
        };
    }, [need, on]);
}

/** The walk loop: step(dt) on animation frames while it returns true. The returned kick starts it again; a kick
 * while it runs does nothing. */
export function useWalkLoop(step: (dtMs: number) => boolean): () => void {
    const stepRef = useRef(step);
    stepRef.current = step;
    const raf = useRef<number | undefined>(undefined);
    useEffect(
        () => () => {
            if (raf.current != null) {
                cancelAnimationFrame(raf.current);
            }
            raf.current = undefined;
            clocks.walk = false;
        },
        []
    );
    return useCallback(() => {
        if (raf.current != null) {
            return;
        }
        let last = performance.now();
        const frame = (t: number) => {
            const dt = Math.min(MAX_STEP_MS, t - last);
            last = t;
            let more = false;
            timed(() => {
                more = stepRef.current(dt);
            });
            raf.current = more ? requestAnimationFrame(frame) : undefined;
            clocks.walk = raf.current != null;
        };
        raf.current = requestAnimationFrame(frame);
        clocks.walk = true;
    }, []);
}
```

- [ ] **Step 5: Write `frontend/app/view/agents/officestore.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's per-viewer choices (cockpit office spec, "Where it lives" and "Motion"), kept in localStorage
// like the pet's. Read them through cockpitView, officeAnimation and sanitizeHours, which turn anything unexpected
// into the default.

import type { PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_HOURS, type WorkHours } from "./officebehavior";

export type CockpitView = "cards" | "office";
export const DEFAULT_COCKPIT_VIEW: CockpitView = "cards";
export const DEFAULT_OFFICE_ANIMATION = true;

// Cards by default: the office is something to ask for (compact by default)
export const cockpitViewAtom = atomWithStorage<CockpitView>("cockpit.view", DEFAULT_COCKPIT_VIEW, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<CockpitView>;
export const officeHoursAtom = atomWithStorage<WorkHours>("cockpit.office.hours", DEFAULT_HOURS, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<WorkHours>;
export const officeAnimationAtom = atomWithStorage<boolean>(
    "cockpit.office.animation",
    DEFAULT_OFFICE_ANIMATION,
    undefined,
    { getOnInit: true }
) as PrimitiveAtom<boolean>;

export function cockpitView(v: unknown): CockpitView {
    return v === "office" ? "office" : "cards";
}

export function officeAnimation(v: unknown): boolean {
    return v !== false;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officebehavior.test.ts frontend/app/view/office/officeclock.test.ts frontend/app/view/agents/officestore.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/view/agents/officebehavior.ts frontend/app/view/agents/officebehavior.test.ts frontend/app/view/office/officeclock.ts frontend/app/view/office/officeclock.test.ts frontend/app/view/agents/officestore.ts frontend/app/view/agents/officestore.test.ts
git commit -m "feat(cockpit): office behaviour, its two clocks and meter, and its stored choices"
```

---

### Task 3: The floor plan and its input

**Depends on:** Task 1, Task 2
**Files:** `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/agents/officeinputs.ts`, `frontend/app/view/agents/officeinputs.test.ts`

**Interfaces:**
- Consumes: `SeatPose` (`plansprite.ts`); `Away`, `shortAge` (`officebehavior.ts`).
- Produces (`officeplanmodel.ts`): the types `Box`, `Point`, `PlanAgent`, `PlanTask`, `PlanRun`, `PlanInput`,
  `RoomKind`, `DoorSide`, `ScreenCell`, `Room`, `Tone`, `Light`, `Bubble`, `Desk`, `Seat`, `Lounger`, `Plan` exactly as
  written below; constants `WALL = 8`, `HWALL = 18`, `HALL_W = 234`, `MIN_W = 900`, `DESK_DX = 120`, `DESK_DY = 130`,
  `ROOM_TOP = 120`, `MEETING_H = 132`, `SEAT_DX = 56`, `MAX_SEATS = 12`, `LOUNGE_H = 230`, `BOOTH_W = 152`,
  `FACADE_H = 40`, `DOOR = 50`, `HOME = "Home"`, `OTHER_RUNS = "Other runs"`; functions `agentLook`, `taskLook`,
  `screenCell`, `runLit`, `cut`, `buildPlan(input: PlanInput): Plan`.
- Produces (`officeinputs.ts`): `planAgent(a: AgentVM, finished: boolean): PlanAgent`;
  `officeInputs(cards: GridCard[], parked: AgentVM[], leadVMs: Map<string, LeadCardVM>, roster: AgentVM[], lineage: Lineage): { agents: PlanAgent[]; runs: PlanRun[] }`.
- Keys: a desk's key is its agent id; a run's lead seat key is the run card's id (`PlanRun.id`); a task seat's key is
  the run card's row key for that task (`PlanTask.key`), else `${runCardId}:${taskId}`. These are the Cockpit's
  cursor ids, so `plan.order` and `plan.asks` feed the keyboard directly.

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/agents/officeplanmodel.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentLook,
    buildPlan,
    cut,
    HALL_W,
    MEETING_H,
    MIN_W,
    taskLook,
    WALL,
    type Box,
    type PlanAgent,
    type PlanInput,
    type PlanRun,
    type PlanTask,
} from "./officeplanmodel";

const NOW = 1_000_000_000;
const ag = (id: string, o: Partial<PlanAgent> = {}): PlanAgent => ({
    id,
    name: id,
    project: "p",
    state: "working",
    finished: false,
    ...o,
});
const task = (id: string, state = "running", o: Partial<PlanTask> = {}): PlanTask => ({
    id,
    label: id,
    state,
    asking: false,
    ...o,
});
const run = (id: string, o: Partial<PlanRun> = {}): PlanRun => ({
    id,
    title: id,
    project: "p",
    createdTs: 1,
    done: false,
    leadAsking: false,
    tasks: [],
    ...o,
});
const plan = (agents: PlanAgent[], runs: PlanRun[] = [], o: Partial<PlanInput> = {}) =>
    buildPlan({ agents, runs, width: 1050, now: NOW, away: {}, night: false, ...o });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("officeplanmodel", () => {
    it("makes a band per project by name, and seats agents with no project in Home's booth", () => {
        const p = plan([ag("z1", { project: "zeta" }), ag("a1", { project: "alpha" }), ag("h1", { project: undefined }), ag("h2", { project: "  " })]);
        expect(p.rooms.filter((r) => r.kind === "agents").map((r) => r.title)).toEqual(["alpha", "zeta"]);
        expect(p.rooms.filter((r) => r.kind === "meeting")).toHaveLength(2);
        expect(p.rooms.find((r) => r.kind === "home")?.sub).toBe("2 agents");
        expect(p.order).toEqual(["a1", "z1", "h1", "h2"]);
    });

    it("sets desks in rows of three by name, then id, 120 apart and 130 between rows", () => {
        const p = plan([ag("d"), ag("c"), ag("b"), ag("a"), ag("a2", { name: "a" })]);
        expect(p.desks.map((d) => d.key)).toEqual(["a", "a2", "b", "c", "d"]);
        const [a, a2, b, c] = p.desks;
        expect(a2.x - a.x).toBe(120);
        expect(b.x - a2.x).toBe(120);
        expect(c.x).toBe(a.x);
        expect(c.y - a.y).toBe(130);
    });

    it("gives each run a meeting room by start, the last stretched to the band", () => {
        const agents = Array.from({ length: 10 }, (_, i) => ag(`a${i}`));
        const p = plan(agents, [run("r2", { createdTs: 2 }), run("r1", { createdTs: 1 })]);
        const meet = p.rooms.filter((r) => r.kind === "meeting");
        expect(meet.map((r) => r.runId)).toEqual(["r1", "r2"]);
        const band = p.rooms.find((r) => r.kind === "agents")!;
        expect(meet[0].box.h).toBe(MEETING_H);
        expect(meet[1].box.y + meet[1].box.h).toBe(band.box.y + band.box.h);
    });

    it("stacks many runs without overlap and keeps every seat in its room", () => {
        const runs = Array.from({ length: 7 }, (_, i) => run(`r${i}`, { createdTs: i, tasks: [task("t1"), task("t2")] }));
        const p = plan([ag("a")], runs);
        const meet = p.rooms.filter((r) => r.kind === "meeting");
        expect(meet).toHaveLength(7);
        for (let i = 0; i < meet.length; i++) {
            for (let j = i + 1; j < meet.length; j++) {
                expect(overlaps(meet[i].box, meet[j].box), `${i} ${j}`).toBe(false);
            }
        }
        for (const s of p.seats) {
            const room = p.rooms.find((r) => r.key === s.room)!;
            expect(s.x).toBeGreaterThanOrEqual(room.box.x);
            expect(s.bottom).toBeLessThanOrEqual(room.box.y + room.box.h);
        }
    });

    it("seats the lead first and alternates the workers' sides, with +N past eleven tasks", () => {
        const p = plan([], [run("r", { tasks: Array.from({ length: 13 }, (_, i) => task(`t${i + 1}`)) })]);
        expect(p.seats).toHaveLength(12);
        expect(p.seats[0].key).toBe("r");
        expect(p.seats[1].pose).toBe("back");
        expect(p.seats[2].pose).toBe("sit");
        expect(p.rooms.find((r) => r.runId === "r")?.more).toBe(2);
        expect(p.order.slice(0, 3)).toEqual(["r", "r:t1", "r:t2"]);
    });

    it("keys a task seat by its card row when it has one", () => {
        const p = plan([], [run("r", { tasks: [task("t1", "running", { key: "row:x" })] })]);
        expect(p.seats[1].key).toBe("row:x");
    });

    it("keeps every place when only a state changes", () => {
        const a = plan([ag("loom"), ag("quill")]);
        const b = plan([ag("loom", { state: "asking" }), ag("quill", { state: "idle", idleSince: NOW - 1000, finished: true })]);
        expect(b.desks.map((d) => [d.key, d.x, d.y])).toEqual(a.desks.map((d) => [d.key, d.x, d.y]));
    });

    it("draws each agent state as the spec's poses table says", () => {
        expect(agentLook(ag("a", { state: "asking" }), NOW, undefined, false)).toMatchObject({ pose: "hand", word: "Needs you", bubble: "!", light: "asking" });
        expect(agentLook(ag("a"), NOW, undefined, false)).toMatchObject({ pose: "sit", animated: true, light: "working" });
        expect(agentLook(ag("a", { state: "idle", idleSince: NOW - 1000, finished: true }), NOW, undefined, false)).toMatchObject({ pose: "doze", word: "done", tone: "done" });
        expect(agentLook(ag("a", { state: "idle", idleSince: NOW - 6 * 60_000 }), NOW, undefined, false)).toMatchObject({ pose: "doze", state: "idle 6m" });
        expect(agentLook(ag("a", { state: "idle" }), NOW, "coffee", false)).toMatchObject({ pose: "empty", dim: true, state: "at the coffee machine" });
        expect(agentLook(ag("a", { state: "idle", finished: true }), NOW, undefined, true)).toMatchObject({ pose: "empty", word: "gone home" });
        expect(agentLook(ag("a"), NOW, undefined, true)).toMatchObject({ pose: "sit" });
    });

    it("draws each task state as the spec's seat table says", () => {
        expect(taskLook(task("t", "pending"))).toMatchObject({ pose: "empty" });
        expect(taskLook(task("t", "stalled"))).toMatchObject({ pose: "doze", bubble: "?" });
        expect(taskLook(task("t", "review-failed"))).toMatchObject({ pose: "sit", bubble: "×" });
        expect(taskLook(task("t", "done"))).toMatchObject({ pose: "doze" });
        expect(taskLook(task("t", "running"))).toMatchObject({ pose: "sit", animated: true });
        expect(taskLook(task("t", "reviewing"))).toMatchObject({ pose: "sit", animated: false });
        expect(taskLook(task("t", "done", { asking: true }))).toMatchObject({ pose: "hand", bubble: "!" });
    });

    it("puts the lounge's people in the lounge with their age", () => {
        const p = plan([ag("t", { state: "idle", idleSince: NOW - 6 * 60_000 })], [], { away: { t: "coffee" } });
        expect(p.loungers).toEqual([expect.objectContaining({ agentId: "t", at: "coffee", label: "t · idle 6m" })]);
        expect(p.desks[0].pose).toBe("empty");
    });

    it("turns the lights off where no one is at work, and on when someone starts", () => {
        const dark = plan([ag("a", { state: "idle", idleSince: NOW - 1000, finished: true })], [run("r", { tasks: [task("t", "done")] })]);
        expect(dark.rooms.filter((r) => !r.lit).map((r) => r.kind).sort()).toEqual(["agents", "meeting"]);
        const lit = plan([ag("a")], [run("r", { tasks: [task("t", "running")] })]);
        expect(lit.rooms.every((r) => r.lit)).toBe(true);
        expect(lit.rooms.find((r) => r.kind === "lounge")?.lit).toBe(true);
    });

    it("opens a door from every room onto the hall, and leaves the hall's walls open there", () => {
        const p = plan([ag("a"), ag("h", { project: undefined })], [run("r")]);
        const doors = p.rooms.filter((r) => r.door).map((r) => r.door!);
        expect(doors).toHaveLength(3);
        for (const d of doors) {
            for (const w of p.walls) {
                expect(overlaps(d, w), JSON.stringify({ d, w })).toBe(false);
            }
        }
        const left = p.rooms.find((r) => r.kind === "agents")!;
        expect(left.door!.x).toBe(left.box.x + left.box.w);
        expect(p.hall.w).toBe(HALL_W);
    });

    it("cuts a wall around its doors", () => {
        expect(cut({ x: 0, y: 0, w: WALL, h: 100 }, [{ x: 0, y: 40, w: WALL, h: 20 }])).toEqual([
            { x: 0, y: 0, w: WALL, h: 40 },
            { x: 0, y: 60, w: WALL, h: 40 },
        ]);
    });

    it("lists the asks in office order", () => {
        const p = plan([ag("b", { state: "asking" }), ag("a")], [run("r", { tasks: [task("t", "running", { asking: true })] })]);
        expect(p.asks).toEqual(["b", "r:t"]);
    });

    it("keeps its minimum width in a narrow Cockpit", () => {
        expect(plan([ag("a")], [], { width: 600 }).width).toBe(MIN_W);
    });

    it("shows each task on its run's screen", () => {
        const p = plan([], [run("r", { tasks: [task("a", "done"), task("b", "running"), task("c", "pending"), task("d", "failed")] })]);
        expect(p.rooms.find((r) => r.runId === "r")?.screen).toEqual(["done", "work", "wait", "fail"]);
    });
});
```

`frontend/app/view/agents/officeinputs.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import type { GridCard } from "./cardgridlayout";
import type { LeadCardVM } from "./leadcardmodel";
import { officeInputs } from "./officeinputs";
import type { Lineage, RunInfo } from "./runlineage";

const agent = (id: string, o: Partial<AgentVM> = {}): AgentVM =>
    ({ id, name: id, task: "", state: "working", project: "p", agent: "claude", ...o }) as AgentVM;

describe("officeinputs", () => {
    it("draws the grid's agents (an idle one is in the Finished window) and the Idle section's", () => {
        const cards: GridCard[] = [
            { kind: "agent", id: "a", agent: agent("a") },
            { kind: "agent", id: "b", agent: agent("b", { state: "idle", idleSince: 5 }) },
        ];
        const parked = [agent("c", { state: "idle", idleSince: 1 }), agent("a")];
        const lineage = { runs: {}, roles: {} } as unknown as Lineage;
        const { agents } = officeInputs(cards, parked, new Map(), [], lineage);
        expect(agents.map((a) => [a.id, a.finished])).toEqual([
            ["a", false],
            ["b", true],
            ["c", false],
        ]);
        expect(agents[0].harness).toBe("claude");
    });

    it("turns a run card into its tasks, with the card's row keys and who is asking", () => {
        const run = {
            runId: "run1",
            title: "Gallery",
            project: "p",
            createdTs: 7,
            dag: { tasks: [{ id: "t1", label: "Model", state: "running" }, { id: "t2", state: "pending" }] },
        } as unknown as RunInfo;
        const worker = agent("w1", { state: "asking" });
        const lineage = {
            runs: { run1: run },
            roles: { w1: { kind: "worker", leadRunId: "run1", taskId: "t1" } },
        } as unknown as Lineage;
        const vm = { rows: [{ key: "row:t1", taskId: "t1" }], waiting: [], done: [] } as unknown as LeadCardVM;
        const cards: GridCard[] = [{ kind: "run", id: "card1", run }];
        const { runs } = officeInputs(cards, [], new Map([["card1", vm]]), [worker], lineage);
        expect(runs).toEqual([
            {
                id: "card1",
                title: "Gallery",
                project: "p",
                createdTs: 7,
                done: false,
                leadAsking: false,
                tasks: [
                    { id: "t1", label: "Model", state: "running", asking: true, key: "row:t1", workerId: "w1" },
                    { id: "t2", label: "t2", state: "pending", asking: false, key: undefined, workerId: undefined },
                ],
            },
        ]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeinputs.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write `frontend/app/view/agents/officeplanmodel.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's floor plan (cockpit office spec, "The plan" and "Poses"): the cards the grid would draw and
// the Idle section's agents, laid out as a band of rooms per project around a hall, with every room, door, wall,
// desk, seat and label, the office order the keyboard walks, and which rooms have their lights on. Pure: no React,
// no DOM; sizes are CSS pixels at the office's width.

import type { SeatPose } from "@/app/view/office/plansprite";
import { shortAge, type Away } from "./officebehavior";

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface Point {
    x: number;
    y: number;
}

export interface PlanAgent {
    id: string;
    name: string;
    project?: string;
    state: "asking" | "working" | "idle";
    idleSince?: number;
    // in the Cockpit's Finished window: an idle card the grid still draws
    finished: boolean;
    harness?: string;
}
export interface PlanTask {
    id: string;
    label: string;
    state: string;
    asking: boolean;
    // the run card's row key for this task, a Cockpit cursor stop; none when the card shows no row for it
    key?: string;
    workerId?: string;
}
export interface PlanRun {
    // the run card's id, which is also its lead seat's key
    id: string;
    title: string;
    project?: string;
    createdTs?: number;
    done: boolean;
    leadAsking: boolean;
    tasks: PlanTask[];
}
export interface PlanInput {
    agents: PlanAgent[];
    runs: PlanRun[];
    width: number;
    now: number;
    away: Record<string, Away>;
    night: boolean;
}

export type RoomKind = "agents" | "meeting" | "lounge" | "home";
export type DoorSide = "left" | "right" | "top";
export type ScreenCell = "done" | "work" | "wait" | "fail";
export interface Room {
    key: string;
    kind: RoomKind;
    box: Box;
    door?: Box;
    doorSide?: DoorSide;
    title: string;
    sub: string;
    lit: boolean;
    runId?: string;
    table?: Box;
    more?: number;
    screen?: ScreenCell[];
}
export type Tone = "plain" | "asking" | "done" | "muted";
export type Light = "working" | "asking" | "off";
export type Bubble = "!" | "?" | "×";
export interface Desk {
    key: string;
    room: string;
    x: number; // the desk top's left edge
    y: number; // the desk top's top edge
    spot: Point; // where the boss stands to look at it
    pose: SeatPose;
    animated: boolean;
    light: Light;
    dim: boolean;
    name: string;
    word?: string;
    tone: Tone;
    tip: string;
    bubble?: Bubble;
    harness?: string;
}
export interface Seat {
    key: string;
    room: string;
    runId: string;
    taskId?: string;
    x: number; // the person's left edge
    bottom: number; // the person's bottom edge
    spot: Point;
    pose: SeatPose;
    animated: boolean;
    lane: number; // 0 the lead, 1.. the task's position
    bubble?: Bubble;
    tip: string;
}
export interface Lounger {
    agentId: string;
    at: Away;
    x: number;
    bottom: number;
    label: string;
    harness?: string;
}
export interface Plan {
    width: number;
    height: number;
    body: Box; // under the outer top wall, above the facade
    hall: Box;
    hallFloor: Box[]; // where one may stand in the hall: all of it but Home's booth
    lounge: Box;
    coffee: Point; // feet at the coffee machine
    sofa: Point; // feet on the sofa
    entrance: Box;
    rooms: Room[];
    walls: Box[];
    desks: Desk[];
    seats: Seat[];
    loungers: Lounger[];
    order: string[];
    asks: string[];
}

export const WALL = 8; // a vertical wall: its top only
export const HWALL = 18; // a horizontal wall: top 8, face 10
export const HALL_W = 234;
export const MIN_W = 900;
export const DESK_DX = 120;
export const DESK_DY = 130;
export const ROOM_TOP = 120; // the first desk row's top below its room's top
export const MEETING_H = 132;
export const SEAT_DX = 56;
export const MAX_SEATS = 12; // the lead and eleven tasks
export const LOUNGE_H = 230;
export const BOOTH_W = 152;
export const FACADE_H = 40;
export const DOOR = 50;
export const HOME = "Home";
export const OTHER_RUNS = "Other runs";

const RUNNING = new Set(["running"]);
const AT_WORK = new Set(["ready", "running", "reviewing", "verifying", "blocked-merge"]);
const EMPTY = new Set(["pending", "cancelled", "skipped"]);
const FAILED = new Set(["review-failed", "verify-failed", "failed"]);

const byName = (a: PlanAgent, b: PlanAgent) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const byStart = (a: PlanRun, b: PlanRun) => (a.createdTs ?? 0) - (b.createdTs ?? 0) || a.id.localeCompare(b.id);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type Look = Pick<Desk, "pose" | "animated" | "light" | "dim" | "word" | "tone" | "bubble"> & { state: string };

/** How an agent sits at its desk and what its desk says (the spec's agent poses table). */
export function agentLook(a: PlanAgent, now: number, away: Away | undefined, night: boolean): Look {
    if (a.state === "asking") {
        return { pose: "hand", animated: true, light: "asking", dim: false, word: "Needs you", tone: "asking", bubble: "!", state: "Needs you" };
    }
    if (a.state === "working") {
        return { pose: "sit", animated: true, light: "working", dim: false, tone: "plain", state: "working" };
    }
    if (night) {
        return { pose: "empty", animated: false, light: "off", dim: true, word: "gone home", tone: "muted", state: "gone home" };
    }
    if (away) {
        const state = away === "coffee" ? "at the coffee machine" : "on the sofa";
        return { pose: "empty", animated: false, light: "off", dim: true, tone: "muted", state };
    }
    // the cheer as one finishes is the view's (cockpitoffice.tsx): this plan's clock is too coarse for 1.5 s
    if (a.finished) {
        return { pose: "doze", animated: false, light: "off", dim: false, word: "done", tone: "done", state: "done" };
    }
    const state = a.idleSince != null ? `idle ${shortAge(now - a.idleSince)}` : "idle";
    return { pose: "doze", animated: false, light: "off", dim: false, tone: "plain", state };
}

/** How a run's worker sits at its table, by its task's state (pkg/orchestrate/dag.go). */
export function taskLook(t: PlanTask): Pick<Seat, "pose" | "animated" | "bubble"> {
    if (t.asking) {
        return { pose: "hand", animated: true, bubble: "!" };
    }
    if (EMPTY.has(t.state)) {
        return { pose: "empty", animated: false };
    }
    if (t.state === "stalled") {
        return { pose: "doze", animated: false, bubble: "?" };
    }
    if (FAILED.has(t.state)) {
        return { pose: "sit", animated: false, bubble: "×" };
    }
    if (t.state === "done") {
        return { pose: "doze", animated: false };
    }
    return { pose: "sit", animated: RUNNING.has(t.state) };
}

/** A task on its run's wall screen. */
export function screenCell(t: PlanTask): ScreenCell {
    if (t.state === "done") {
        return "done";
    }
    if (FAILED.has(t.state) || t.state === "stalled") {
        return "fail";
    }
    return AT_WORK.has(t.state) ? "work" : "wait";
}

/** A meeting room's lights: on while its lead or a worker asks, or a task runs. */
export function runLit(r: PlanRun): boolean {
    return r.leadAsking || r.tasks.some((t) => t.asking || RUNNING.has(t.state));
}

/** A vertical wall with its doors left open. */
export function cut(wall: Box, doors: Box[]): Box[] {
    const out: Box[] = [];
    let y = wall.y;
    for (const d of [...doors].sort((a, b) => a.y - b.y)) {
        if (d.y > y) {
            out.push({ ...wall, y, h: d.y - y });
        }
        y = Math.max(y, d.y + d.h);
    }
    if (y < wall.y + wall.h) {
        out.push({ ...wall, y, h: wall.y + wall.h - y });
    }
    return out;
}

export function buildPlan(input: PlanInput): Plan {
    const width = Math.max(MIN_W, Math.round(input.width));
    const colW = Math.floor((width - 4 * WALL - HALL_W) / 2);
    const leftX = WALL;
    const hallX = leftX + colW + WALL;
    const rightX = hallX + HALL_W + WALL;
    const top = HWALL;

    // a band per project with an agent or a run, by name; agents with no project go to Home's booth
    const bands = new Map<string, { agents: PlanAgent[]; runs: PlanRun[] }>();
    const band = (name: string) => {
        let b = bands.get(name);
        if (b == null) {
            b = { agents: [], runs: [] };
            bands.set(name, b);
        }
        return b;
    };
    const home: PlanAgent[] = [];
    for (const a of input.agents) {
        const p = a.project?.trim();
        if (p) {
            band(p).agents.push(a);
        } else {
            home.push(a);
        }
    }
    for (const r of input.runs) {
        band(r.project?.trim() || OTHER_RUNS).runs.push(r);
    }
    const names = [...bands.keys()].sort((a, b) => a.localeCompare(b));
    home.sort(byName);

    const heights = names.map((n) => {
        const b = bands.get(n)!;
        b.agents.sort(byName);
        b.runs.sort(byStart);
        const rows = Math.max(1, Math.ceil(b.agents.length / 3));
        const meetings = Math.max(1, b.runs.length);
        return Math.max(ROOM_TOP + rows * DESK_DY, meetings * MEETING_H + (meetings - 1) * HWALL);
    });
    const boothH = home.length ? 60 + home.length * DESK_DY : 0;
    const bandsH = heights.reduce((s, h) => s + h, 0) + Math.max(0, heights.length - 1) * HWALL;
    const bodyH = Math.max(bandsH, LOUNGE_H + (boothH ? boothH + HWALL : 0) + 80);
    // the last band stretches to the hall when the hall is the taller
    if (heights.length > 0 && bodyH > bandsH) {
        heights[heights.length - 1] += bodyH - bandsH;
    }

    const rooms: Room[] = [];
    const walls: Box[] = [];
    const desks: Desk[] = [];
    const seats: Seat[] = [];
    const loungers: Lounger[] = [];
    const order: string[] = [];
    const asks: string[] = [];
    const leftDoors: Box[] = [];
    const rightDoors: Box[] = [];

    const placeDesks = (list: PlanAgent[], room: Room, x0: number, y0: number, perRow: number) => {
        list.forEach((a, i) => {
            const x = x0 + (i % perRow) * DESK_DX;
            const y = y0 + Math.floor(i / perRow) * DESK_DY;
            const away = input.away[a.id];
            const { state, ...look } = agentLook(a, input.now, away, input.night);
            desks.push({
                key: a.id,
                room: room.key,
                x,
                y,
                spot: { x: x + 40, y: y + 108 },
                ...look,
                name: a.name,
                tip: `${a.name} · ${state} (Enter opens the card)`,
                harness: a.harness,
            });
            order.push(a.id);
            if (a.state === "asking") {
                asks.push(a.id);
            }
            if (away && !input.night && a.state === "idle") {
                const age = a.idleSince != null ? `idle ${shortAge(input.now - a.idleSince)}` : "idle";
                loungers.push({ agentId: a.id, at: away, x: 0, bottom: 0, label: `${a.name} · ${age}`, harness: a.harness });
            }
        });
    };

    const placeSeats = (r: PlanRun, room: Room) => {
        const shown = r.tasks.slice(0, MAX_SEATS - 1);
        const far = Math.ceil((shown.length + 1) / 2);
        const tw = Math.max(170, far * SEAT_DX + 30);
        const tx = room.box.x + Math.round((room.box.w - tw) / 2) - 20;
        const ty = room.box.y + Math.round(room.box.h / 2) + 12;
        room.table = { x: tx, y: ty, w: tw, h: 33 };
        if (r.tasks.length > shown.length) {
            room.more = r.tasks.length - shown.length;
        }
        const spotY = Math.min(room.box.y + room.box.h - 6, ty + 76);
        const lead = r.leadAsking
            ? { pose: "hand" as const, animated: true, bubble: "!" as const }
            : { pose: (r.done ? "doze" : "sit") as SeatPose, animated: false };
        seats.push({ key: r.id, room: room.key, runId: r.id, x: tx + 20, bottom: ty + 6, spot: { x: tx + 38, y: spotY }, ...lead, lane: 0, tip: `${r.title} · lead (Enter opens the run)` });
        order.push(r.id);
        if (r.leadAsking) {
            asks.push(r.id);
        }
        shown.forEach((t, i) => {
            const n = i + 1; // seat 0 is the lead
            const farSide = n % 2 === 0;
            const k = Math.floor(n / 2);
            const x = farSide ? tx + 20 + k * SEAT_DX : tx + 46 + k * SEAT_DX;
            const look = taskLook(t);
            // the near side shows its back, whatever it does
            const pose: SeatPose = look.pose === "empty" ? "empty" : farSide ? look.pose : "back";
            const key = t.key ?? `${r.id}:${t.id}`;
            seats.push({
                key,
                room: room.key,
                runId: r.id,
                taskId: t.id,
                x,
                bottom: farSide ? ty + 6 : ty + 54,
                spot: { x: x + 18, y: spotY },
                pose,
                animated: farSide && look.animated,
                bubble: look.bubble,
                lane: n,
                tip: `Task ${n} · ${t.label} · ${t.asking ? "Needs you" : t.state}`,
            });
            order.push(key);
            if (t.asking) {
                asks.push(key);
            }
        });
    };

    let y = top;
    names.forEach((name, bi) => {
        const b = bands.get(name)!;
        const h = heights[bi];
        const sub = [b.agents.length ? plural(b.agents.length, "agent") : "", b.runs.length ? plural(b.runs.length, "run") : ""]
            .filter(Boolean)
            .join(" · ");
        const agentsRoom: Room = {
            key: `room:${name}`,
            kind: "agents",
            box: { x: leftX, y, w: colW, h },
            door: { x: leftX + colW, y: y + Math.min(150, h - DOOR - 10), w: WALL, h: DOOR },
            doorSide: "right",
            title: name,
            sub: sub || "no one here",
            lit: b.agents.some((a) => a.state !== "idle"),
        };
        rooms.push(agentsRoom);
        leftDoors.push(agentsRoom.door!);
        placeDesks(b.agents, agentsRoom, leftX + 32, y + ROOM_TOP, 3);

        // a meeting room per run, the last stretched to the band; a band with no run keeps an empty one
        const runs: (PlanRun | undefined)[] = b.runs.length ? b.runs : [undefined];
        let ry = y;
        runs.forEach((r, ri) => {
            const rh = ri === runs.length - 1 ? y + h - ry : MEETING_H;
            const done = r ? r.tasks.filter((t) => t.state === "done").length : 0;
            const room: Room = {
                key: r ? `meet:${r.id}` : `meet:${name}`,
                kind: "meeting",
                box: { x: rightX, y: ry, w: colW, h: rh },
                door: { x: rightX - WALL, y: ry + 50, w: WALL, h: DOOR },
                doorSide: "left",
                title: r ? r.title : "Meeting room",
                sub: r ? `run · ${done} of ${r.tasks.length} done` : "no run",
                lit: r ? runLit(r) : false,
                runId: r?.id,
                screen: r ? r.tasks.map(screenCell) : undefined,
            };
            rooms.push(room);
            rightDoors.push(room.door!);
            if (r) {
                placeSeats(r, room);
            }
            if (ri < runs.length - 1) {
                walls.push({ x: rightX, y: ry + rh, w: colW, h: HWALL });
            }
            ry += rh + HWALL;
        });
        if (bi < names.length - 1) {
            walls.push({ x: leftX, y: y + h, w: colW, h: HWALL }, { x: rightX, y: y + h, w: colW, h: HWALL });
        }
        y += h + HWALL;
    });

    // the hall: the lounge at its top, Home's booth at its foot by the entrance
    const hall: Box = { x: hallX, y: top, w: HALL_W, h: bodyH };
    const lounge: Box = { x: hallX, y: top, w: HALL_W, h: LOUNGE_H };
    rooms.push({ key: "lounge", kind: "lounge", box: lounge, title: "Lounge", sub: "", lit: true });
    let hallFloor: Box[] = [hall];
    if (home.length) {
        const by = top + bodyH - boothH;
        const booth: Room = {
            key: "room:home",
            kind: "home",
            box: { x: hallX, y: by, w: BOOTH_W, h: boothH },
            door: { x: hallX + 52, y: by - HWALL, w: 40, h: HWALL },
            doorSide: "top",
            title: HOME,
            sub: plural(home.length, "agent"),
            lit: home.some((a) => a.state !== "idle"),
        };
        rooms.push(booth);
        walls.push(
            { x: hallX, y: by - HWALL, w: 52, h: HWALL },
            { x: hallX + 92, y: by - HWALL, w: BOOTH_W - 92, h: HWALL },
            { x: hallX + BOOTH_W, y: by - HWALL, w: WALL, h: boothH + HWALL }
        );
        placeDesks(home, booth, hallX + 40, by + 70, 1);
        hallFloor = [
            { x: hallX, y: top, w: HALL_W, h: bodyH - boothH - HWALL },
            { x: hallX + BOOTH_W + WALL, y: by - HWALL, w: HALL_W - BOOTH_W - WALL, h: boothH + HWALL },
        ];
    }

    walls.push(
        { x: 0, y: 0, w: width, h: HWALL },
        { x: 0, y: 0, w: WALL, h: top + bodyH },
        { x: width - WALL, y: 0, w: WALL, h: top + bodyH },
        ...cut({ x: hallX - WALL, y: top, w: WALL, h: bodyH }, leftDoors),
        ...cut({ x: rightX - WALL, y: top, w: WALL, h: bodyH }, rightDoors)
    );

    // feet at the coffee machine and on the sofa; the lounge's people stand and sit beside each other
    const coffee = { x: hallX + 138, y: top + 150 };
    const sofa = { x: hallX + 96, y: top + 168 };
    loungers
        .filter((l) => l.at === "coffee")
        .forEach((l, i) => {
            l.x = coffee.x - 18 - i * 40;
            l.bottom = coffee.y;
        });
    loungers
        .filter((l) => l.at === "sofa")
        .forEach((l, i) => {
            l.x = sofa.x - 58 + (i % 3) * 40;
            l.bottom = sofa.y;
        });

    return {
        width,
        height: top + bodyH + FACADE_H,
        body: { x: 0, y: top, w: width, h: bodyH },
        hall,
        hallFloor,
        lounge,
        coffee,
        sofa,
        entrance: { x: hallX + HALL_W - 72, y: top + bodyH, w: 72, h: FACADE_H },
        rooms,
        walls,
        desks,
        seats,
        loungers,
        order,
        asks,
    };
}
```

- [ ] **Step 4: Write `frontend/app/view/agents/officeinputs.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Cockpit office draws (cockpit office spec, "Where it lives"): the grid's cards and the Idle section's
// agents, as the floor plan's input. Pure.

import { projectOf, type AgentVM } from "./agentsviewmodel";
import type { GridCard } from "./cardgridlayout";
import type { LeadCardVM } from "./leadcardmodel";
import type { PlanAgent, PlanRun } from "./officeplanmodel";
import { runFinished, taskAgentOf, type Lineage } from "./runlineage";

export function planAgent(a: AgentVM, finished: boolean): PlanAgent {
    return {
        id: a.id,
        name: a.name,
        project: projectOf(a) || undefined,
        state: a.state,
        idleSince: a.idleSince,
        finished,
        harness: a.agent,
    };
}

export function officeInputs(
    cards: GridCard[],
    parked: AgentVM[],
    leadVMs: Map<string, LeadCardVM>,
    roster: AgentVM[],
    lineage: Lineage
): { agents: PlanAgent[]; runs: PlanRun[] } {
    const agents: PlanAgent[] = [];
    const runs: PlanRun[] = [];
    for (const c of cards) {
        if (c.kind === "agent") {
            // an idle card is in the Finished window: past it the grid parks the agent in the Idle section
            agents.push(planAgent(c.agent, c.agent.state === "idle"));
            continue;
        }
        const vm = leadVMs.get(c.id);
        const rows = vm ? [...vm.rows, ...vm.waiting, ...vm.done] : [];
        runs.push({
            id: c.id,
            title: c.run.title,
            project: c.run.project || undefined,
            createdTs: c.run.createdTs,
            done: runFinished(c.run),
            leadAsking: c.lead?.state === "asking",
            tasks: (c.run.dag?.tasks ?? []).map((t) => {
                const worker = taskAgentOf(lineage, roster, c.run.runId, t.id);
                return {
                    id: t.id,
                    label: t.label || t.id,
                    state: t.state,
                    asking: worker?.state === "asking",
                    key: rows.find((r) => r.taskId === t.id)?.key,
                    workerId: worker?.id,
                };
            }),
        });
    }
    const shown = new Set(agents.map((a) => a.id));
    for (const a of parked) {
        if (!shown.has(a.id)) {
            agents.push(planAgent(a, false));
        }
    }
    return { agents, runs };
}
```

If `Lineage` is not an exported type of `runlineage.ts`, export it there (it is the type `taskAgentOf` already
takes); change nothing else in that file.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeinputs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/view/agents/officeplanmodel.ts frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeinputs.ts frontend/app/view/agents/officeinputs.test.ts
git commit -m "feat(cockpit): office floor plan, a band per project with a meeting room per run, from the grid's cards"
```

---

### Task 4: How the boss moves

**Depends on:** Task 3
**Files:** `frontend/app/view/agents/officeboss.ts`, `frontend/app/view/agents/officeboss.test.ts`

**Interfaces:**
- Consumes: `Box`, `Plan`, `Point`, `Room` (`officeplanmodel.ts`); `WalkDir` (`plansprite.ts`).
- Produces: `type Dir = WalkDir`; `STEP_PX = 3`, `BOSS_SPEED = 160`, `JUMP_SPEED = 400`, `WALKER_SPEED = 60`;
  `canStand(plan, p): boolean`; `stepToward(plan, from, dir, dist): Point`; `roomAt(plan, p): string` (a room key,
  or `"hall"`; the lounge counts as hall); `pathBetween(plan, from, to): Point[]`;
  `dotsAlong(path, gap = 14): Point[]`; `advance(path, dist): { at: Point; rest: Point[] }`;
  `facing(a, b, was?: Dir): Dir`; `spotOf(plan, key): Point | undefined`; `deskAt(plan, p): string | undefined`.

- [ ] **Step 1: Write the failing test** — `frontend/app/view/agents/officeboss.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    advance,
    canStand,
    deskAt,
    dotsAlong,
    facing,
    pathBetween,
    roomAt,
    spotOf,
    stepToward,
} from "./officeboss";
import { buildPlan, type PlanAgent } from "./officeplanmodel";

const ag = (id: string, project?: string): PlanAgent => ({ id, name: id, project, state: "working", finished: false });
const plan = buildPlan({
    agents: [ag("a1", "alpha"), ag("a2", "alpha"), ag("b1", "beta"), ag("h1")],
    runs: [{ id: "r1", title: "R", project: "alpha", done: false, leadAsking: false, tasks: [{ id: "t1", label: "t1", state: "running", asking: false }] }],
    width: 1050,
    now: 0,
    away: {},
    night: false,
});
const room = (k: string) => plan.rooms.find((r) => r.key === k)!;
const a1 = spotOf(plan, "a1")!;

describe("officeboss", () => {
    it("lets one stand in rooms, doors and the hall, never in a wall", () => {
        expect(canStand(plan, a1)).toBe(true);
        const door = room("room:alpha").door!;
        expect(canStand(plan, { x: door.x + 4, y: door.y + 25 })).toBe(true);
        expect(canStand(plan, { x: door.x + 4, y: door.y - 20 })).toBe(false);
        expect(roomAt(plan, { x: plan.hall.x + 100, y: plan.hall.y + 300 })).toBe("hall");
        expect(roomAt(plan, a1)).toBe("room:alpha");
    });

    it("stops at a wall and goes through a door", () => {
        const r = room("room:alpha");
        const blocked = stepToward(plan, a1, "right", 600);
        expect(blocked.x).toBeLessThanOrEqual(r.box.x + r.box.w);
        expect(roomAt(plan, blocked)).toBe("room:alpha");
        const atDoor = { x: a1.x, y: r.door!.y + r.door!.h / 2 };
        expect(roomAt(plan, stepToward(plan, atDoor, "right", 600))).toBe("hall");
    });

    it("does not tunnel through a wall on a long step", () => {
        const r = room("room:alpha");
        const nearWall = { x: r.box.x + r.box.w - 3, y: a1.y };
        expect(stepToward(plan, nearWall, "right", 30).x).toBeLessThanOrEqual(r.box.x + r.box.w);
    });

    it("walks out of one room, along the hall and into another, on floor all the way", () => {
        const b1 = spotOf(plan, "b1")!;
        const path = pathBetween(plan, a1, b1);
        expect(path[0]).toEqual(a1);
        expect(path[path.length - 1]).toEqual(b1);
        expect(path.some((p) => p.x === plan.hall.x + plan.hall.w - 36)).toBe(true);
        for (const p of path) {
            expect(canStand(plan, p), JSON.stringify(p)).toBe(true);
        }
        const a2 = spotOf(plan, "a2")!;
        expect(pathBetween(plan, a1, a2)).toEqual([a1, a2]);
        const h1 = spotOf(plan, "h1")!;
        expect(pathBetween(plan, a1, h1).every((p) => canStand(plan, p))).toBe(true);
    });

    it("lays dots every 14 px along a path, across its corners", () => {
        expect(dotsAlong([{ x: 0, y: 0 }, { x: 28, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 14, y: 0 }]);
        expect(dotsAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 4 }]);
    });

    it("advances along a path and says what is left", () => {
        const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
        expect(advance(path, 15)).toEqual({ at: { x: 10, y: 5 }, rest: [{ x: 10, y: 5 }, { x: 10, y: 10 }] });
        expect(advance(path, 50)).toEqual({ at: { x: 10, y: 10 }, rest: [{ x: 10, y: 10 }] });
    });

    it("faces the way it moves most", () => {
        expect(facing({ x: 0, y: 0 }, { x: -5, y: 1 })).toBe("left");
        expect(facing({ x: 0, y: 0 }, { x: 1, y: 5 })).toBe("down");
        expect(facing({ x: 0, y: 0 }, { x: 0, y: 0 }, "up")).toBe("up");
    });

    it("finds the desk or seat at the boss, and none in the hall", () => {
        expect(deskAt(plan, a1)).toBe("a1");
        expect(deskAt(plan, spotOf(plan, "r1")!)).toBe("r1");
        expect(deskAt(plan, { x: plan.hall.x + 100, y: plan.hall.y + 300 })).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/agents/officeboss.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `frontend/app/view/agents/officeboss.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How the boss moves through the Cockpit office (cockpit office spec, "The boss"): walls stop it, doors let it
// through, a jump to a desk walks out of its room, along the hall and in through the other door, and the desk the
// boss stands at is the selected card. Walkers to the lounge take the same paths. Pure: no React, no DOM.

import type { WalkDir } from "@/app/view/office/plansprite";
import type { Box, Plan, Point, Room } from "./officeplanmodel";

export type Dir = WalkDir;

export const STEP_PX = 3; // one pixel-art cell: moves happen in whole cells
export const BOSS_SPEED = 160;
export const JUMP_SPEED = 400;
export const WALKER_SPEED = 60;
const DOOR_REACH = 14;
// the hall's walking lane, clear of Home's booth at the hall's foot
const LANE_FROM_RIGHT = 36;

const DELTA: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const inside = (p: Point, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Where anyone may stand: every room, every door, and the hall's floor. */
export function canStand(plan: Plan, p: Point): boolean {
    return (
        plan.hallFloor.some((b) => inside(p, b)) ||
        plan.rooms.some((r) => inside(p, r.box) || (r.door != null && inside(p, r.door)))
    );
}

/** Up to `dist` px toward dir, a cell at a time, stopping before the first spot no one may stand on. */
export function stepToward(plan: Plan, from: Point, dir: Dir, dist: number): Point {
    const d = DELTA[dir];
    let at = from;
    for (let moved = STEP_PX; moved <= dist; moved += STEP_PX) {
        const next = { x: from.x + d.x * moved, y: from.y + d.y * moved };
        if (!canStand(plan, next)) {
            break;
        }
        at = next;
    }
    return at;
}

/** The room a point is in, or "hall" (the lounge is part of the hall). */
export function roomAt(plan: Plan, p: Point): string {
    return plan.rooms.find((r) => r.kind !== "lounge" && inside(p, r.box))?.key ?? "hall";
}

function doorPoints(r: Room): { inner: Point; outer: Point } {
    const d = r.door!;
    const mid = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
    if (r.doorSide === "right") {
        return { inner: { x: d.x - DOOR_REACH, y: mid.y }, outer: { x: d.x + d.w + DOOR_REACH, y: mid.y } };
    }
    if (r.doorSide === "left") {
        return { inner: { x: d.x + d.w + DOOR_REACH, y: mid.y }, outer: { x: d.x - DOOR_REACH, y: mid.y } };
    }
    return { inner: { x: mid.x, y: d.y + d.h + DOOR_REACH }, outer: { x: mid.x, y: d.y - DOOR_REACH } };
}

const dedupe = (pts: Point[]) => pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);

/** The way between two spots: straight within a room, else out through one door, along the hall's lane, and in
 * through the other. */
export function pathBetween(plan: Plan, from: Point, to: Point): Point[] {
    const a = roomAt(plan, from);
    const b = roomAt(plan, to);
    if (a === b) {
        return [from, to];
    }
    const roomOf = (k: string) => plan.rooms.find((r) => r.key === k);
    const lane = plan.hall.x + plan.hall.w - LANE_FROM_RIGHT;
    const out: Point[] = [from];
    let hallFrom = from;
    if (a !== "hall") {
        const d = doorPoints(roomOf(a)!);
        out.push(d.inner, d.outer);
        hallFrom = d.outer;
    }
    const enter = b !== "hall" ? doorPoints(roomOf(b)!) : undefined;
    const hallTo = enter ? enter.outer : to;
    out.push({ x: lane, y: hallFrom.y }, { x: lane, y: hallTo.y });
    if (enter) {
        out.push(enter.outer, enter.inner);
    }
    out.push(to);
    return dedupe(out);
}

/** Dots every `gap` px along a path, for the hint `n` shows. */
export function dotsAlong(path: Point[], gap = 14): Point[] {
    const dots: Point[] = [];
    let carry = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let d = carry;
        while (d < len) {
            dots.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
            d += gap;
        }
        carry = d - len;
    }
    return dots;
}

/** Walks `dist` px along a path: the point reached, and the path still ahead starting there. */
export function advance(path: Point[], dist: number): { at: Point; rest: Point[] } {
    let left = dist;
    let at = path[0];
    for (let i = 0; i < path.length - 1; i++) {
        const b = path[i + 1];
        const len = Math.hypot(b.x - at.x, b.y - at.y);
        if (len > left) {
            at = { x: at.x + ((b.x - at.x) * left) / len, y: at.y + ((b.y - at.y) * left) / len };
            return { at, rest: [at, ...path.slice(i + 1)] };
        }
        left -= len;
        at = b;
    }
    return { at, rest: [at] };
}

/** The way someone faces going from a to b: the larger of the two moves. */
export function facing(a: Point, b: Point, was: Dir = "down"): Dir {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) {
        return was;
    }
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
}

/** Where the boss stands for a desk or seat key. */
export function spotOf(plan: Plan, key: string): Point | undefined {
    return plan.desks.find((d) => d.key === key)?.spot ?? plan.seats.find((s) => s.key === key)?.spot;
}

/** The desk or seat whose spot is nearest, in the room the boss stands in; undefined in the hall or the lounge. */
export function deskAt(plan: Plan, p: Point): string | undefined {
    const room = roomAt(plan, p);
    if (room === "hall") {
        return undefined;
    }
    let best: string | undefined;
    let dist = Number.POSITIVE_INFINITY;
    for (const s of [...plan.desks, ...plan.seats]) {
        if (s.room !== room) {
            continue;
        }
        const d = Math.hypot(s.spot.x - p.x, s.spot.y - p.y);
        if (d < dist) {
            dist = d;
            best = s.key;
        }
    }
    return best;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run frontend/app/view/agents/officeboss.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/officeboss.ts frontend/app/view/agents/officeboss.test.ts
git commit -m "feat(cockpit): office boss movement: walls, doors, paths through the hall, the desk at the boss"
```

---

### Task 5: The office view, wired into the Cockpit, with its CDP scenario

**Depends on:** Task 4
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/cockpitofficedevhooks.ts`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cockpit-fixtures/scenarios.mjs`, `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cdp/scenarios.mjs`

**Interfaces:**
- Consumes: everything Tasks 1–4 produce.
- Produces (`cockpitoffice.tsx`): `CockpitOffice` (props `CockpitOfficeProps` below); `interface OfficeHandle`;
  `interface OfficeDev`; `officeDevAtom`; `readOfficeProbe()`.
- Produces (`usecockpitkeyboard.ts`): `ARROW_DIR: Record<string, Dir>`; `interface OfficeKeys`; new optional deps
  `office?: OfficeKeys` and `toggleView?: () => void`.
- Produces (scenarios): `makeCockpitOfficeScenarios(fx: { arrangeFixtureRun, teardownFixtureRun })` returning
  `{ cockpitOffice }`; exported `OFFICE_RUNS`, `BENCH_RUNS`, `key`, `hold`, `probe`, `dev`, `focusCockpit`,
  `settleBoss`, `waitForOffice`, `FIXTURE`, `VIEW_KEY` for Task 6 and Task 7; fixture rosters `office` and
  `office-bench` in `scripts/cockpit-fixtures/scenarios.mjs`.

- [ ] **Step 1: Write `frontend/app/view/agents/cockpitoffice.tsx`**

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office (docs/superpowers/specs/2026-10-15-cockpit-office-design.md): the Cockpit's cards drawn as a
// floor plan seen from above, the boss you walk around, and the card of the desk you stand at. Thin by design: the
// plan is officeplanmodel.ts, who goes where officebehavior.ts, how the boss moves officeboss.ts, the pixels
// plansprite.ts, the clocks officeclock.ts. This file owns the DOM, the walk state and the popup.
//
// Cost is the point of most choices (the spec's Benchmark): a person is one <img> from a cache; a desk's top and face
// are pseudo-elements; the boss, the walkers and the path dots are small components on their own atoms, so a walk
// step re-renders only them; only animated people read the frame clock; no clock runs while nothing moves.

import { globalStore } from "@/app/store/jotaiStore";
import {
    officeClocks,
    officeCountsAtom,
    officeTickAtom,
    setOfficeRoot,
    useFrameClock,
    useWalkLoop,
} from "@/app/view/office/officeclock";
import {
    BOSS_SHIRT,
    LANE_SHIRTS,
    LEAD_SHIRT,
    mirrorOf,
    PLAN_CELL,
    PLAN_SPRITES,
    PLAN_TOKENS,
    planSpriteUrl,
    seatSprite,
    shirtOf,
    spriteWidth,
    walkSprite,
    type PlanOutfit,
    type PlanSprite,
    type SeatPose,
} from "@/app/view/office/plansprite";
import { spriteCacheStats, tokenRgb } from "@/app/view/office/spritecache";
import { cn } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { Moon, Sun, Zap } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
    Fragment,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MutableRefObject,
    type ReactNode,
} from "react";
import {
    admitWalkers,
    afterHours,
    awayTarget,
    CHEER_MS,
    energyOf,
    isReset,
    lookOf,
    sanitizeHours,
    STRETCH_MS,
    yawnsNow,
    type Away,
    type Energy,
} from "./officebehavior";
import {
    advance,
    BOSS_SPEED,
    deskAt,
    dotsAlong,
    facing,
    JUMP_SPEED,
    pathBetween,
    roomAt,
    spotOf,
    STEP_PX,
    stepToward,
    WALKER_SPEED,
    type Dir,
} from "./officeboss";
import {
    buildPlan,
    HWALL,
    WALL,
    type Box,
    type Desk,
    type Lounger,
    type Plan,
    type PlanAgent,
    type PlanRun,
    type Point,
    type Room,
    type RoomKind,
    type Seat,
    type Tone,
} from "./officeplanmodel";
import { officeAnimation, officeAnimationAtom, officeHoursAtom } from "./officestore";

/** What the CDP scenarios set through cockpitofficedevhooks.ts; always null in a real session. */
export interface OfficeDev {
    runs?: PlanRun[]; // drawn after the live ones
    energy?: number; // the 5-hour window's use, in place of the meter's
    afterHours?: boolean; // in place of the clock and the work hours
    quiet?: boolean; // everyone idle in the Finished window and no run: nothing moves
    patrol?: boolean; // the boss walks desk to desk without end (the bench)
    walkers?: number; // this many people walk desk to coffee and back without end (the bench)
    sheet?: boolean; // every sprite on a sheet over the office (the States board)
}
export const officeDevAtom = atom<OfficeDev | null>(null) as PrimitiveAtom<OfficeDev | null>;

export interface OfficeHandle {
    walk(dir: Dir): void;
    release(dir: Dir): void;
    goTo(key: string): void;
    showPath(key: string): void;
    dismiss(): void;
    order(): string[];
    asks(): string[];
}

export interface CockpitOfficeProps {
    agents: PlanAgent[];
    runs: PlanRun[];
    now: number;
    fiveHourPct?: number;
    cursorId?: string;
    onCursor: (key: string) => void;
    renderCard: (key: string) => ReactNode;
    handleRef: MutableRefObject<OfficeHandle | null>;
}

interface BossState {
    at: Point;
    path: Point[];
    dir: Dir;
    speed: number;
    holding?: Dir;
}
interface Walker {
    id: string;
    at: Point;
    path: Point[];
    dir: Dir;
    to?: Away;
    outfit: PlanOutfit;
    loop?: [Point, Point];
}

const bossAtom = atom<BossState | null>(null) as PrimitiveAtom<BossState | null>;
// walkers' positions, read only by WalkersView; who walks where to is walkingAtom, read by the office, which
// changes only when a walk starts or ends
const walkersAtom = atom<Walker[]>([]) as PrimitiveAtom<Walker[]>;
const walkingAtom = atom<Record<string, Away | null>>({}) as PrimitiveAtom<Record<string, Away | null>>;
const dotsAtom = atom<Point[]>([]) as PrimitiveAtom<Point[]>;
const popupHiddenAtom = atom(false) as PrimitiveAtom<boolean>;

const BOSS_OUTFIT: PlanOutfit = { shirt: BOSS_SHIRT, look: 1, boss: true };
const WALK_FRAME_MS = 180;
const ARROW_STEP_PX = 24; // one arrow press when people do not walk (reduced motion, animation off)
const PATH_HINT_MS = 1000;

// what the probe reads, kept up to date as the office draws
const probe = {
    people: 0,
    desks: 0,
    seats: 0,
    rooms: 0,
    dark: [] as string[],
    night: false,
    lamps: 0,
    cups: 0,
    walking: 0,
    popup: "" as "" | "agent" | "run",
};
let lastPlan: Plan | null = null;

/** What the office drew, for the DEV probe (cockpitofficedevhooks.ts). */
export function readOfficeProbe() {
    const b = globalStore.get(bossAtom);
    return {
        ...probe,
        boss:
            b && lastPlan
                ? {
                      x: Math.round(b.at.x),
                      y: Math.round(b.at.y),
                      room: roomAt(lastPlan, b.at),
                      moving: b.path.length > 1 || b.holding != null,
                  }
                : null,
        dots: globalStore.get(dotsAtom).length,
        clock: officeClocks(),
        cache: spriteCacheStats("plan"),
        unresolved: PLAN_TOKENS.filter((t) => tokenRgb(t) == null),
    };
}

const box = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h });
const spriteH = (s: PlanSprite) => PLAN_SPRITES[s].length * PLAN_CELL;
const walkFrame = () => (Math.floor(performance.now() / WALK_FRAME_MS) % 2) as 0 | 1;
const sameSpot = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

function withAway(s: Record<string, Away>, id: string, to: Away | undefined): Record<string, Away> {
    const next = { ...s };
    if (to) {
        next[id] = to;
    } else {
        delete next[id];
    }
    return next;
}

// the floors' materials: planks in the agents' rooms and Home, tiles in meeting rooms, carpet in the lounge
const WOOD: CSSProperties = {
    background:
        "repeating-linear-gradient(90deg, var(--color-office-wood-1) 0 15px, var(--color-office-wood-2) 15px 16px)",
};
const FLOOR: Record<RoomKind, CSSProperties> = {
    agents: WOOD,
    home: WOOD,
    meeting: {
        background:
            "repeating-conic-gradient(var(--color-office-tile-1) 0 25%, var(--color-office-tile-2) 0 50%) 0 0 / 24px 24px",
    },
    lounge: { background: "var(--color-office-carpet)" },
};
const BRICK: CSSProperties = {
    backgroundColor: "var(--color-office-brick)",
    backgroundImage: "repeating-linear-gradient(0deg, transparent 0 9px, var(--color-office-mortar) 9px 11px)",
};
const TONE: Record<Tone, string> = {
    plain: "text-muted",
    asking: "font-semibold text-asking",
    done: "font-semibold text-success",
    muted: "text-ink-faint",
};
const SCREEN: Record<string, string> = {
    done: "bg-success/45",
    work: "bg-working",
    wait: "bg-edge-mid",
    fail: "bg-error",
};
const BUBBLE: Record<string, string> = {
    "!": "bg-asking text-on-warning",
    "?": "bg-asking text-on-warning",
    "×": "bg-error text-background",
};

export function CockpitOffice(props: CockpitOfficeProps) {
    const { cursorId, onCursor, renderCard, handleRef } = props;
    const dev = useAtomValue(officeDevAtom);
    const hours = sanitizeHours(useAtomValue(officeHoursAtom));
    const animationOn = officeAnimation(useAtomValue(officeAnimationAtom));
    const reduced = useReducedMotion() ?? false;
    // people walk only with the animation on and no reduced motion; otherwise they are at once where they go
    const moving = animationOn && !reduced;

    const now = props.now;
    const pct = dev?.energy ?? props.fiveHourPct;
    const energy = energyOf(pct);
    const night = dev?.afterHours ?? afterHours(new Date(now), hours);
    const agents = useMemo(
        () =>
            dev?.quiet
                ? props.agents.map((a) => ({ ...a, state: "idle" as const, finished: true, idleSince: now - 60_000 }))
                : props.agents,
        [props.agents, dev?.quiet, now]
    );
    const runs = useMemo(
        () => (dev?.quiet ? [] : [...props.runs, ...(dev?.runs ?? [])]),
        [props.runs, dev?.quiet, dev?.runs]
    );

    const scrollRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        // the content box: the scroller's 20 px gutters each side
        const measure = () => setWidth(el.clientWidth - 40);
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);

    // who is where: an idle agent past the Finished window goes to the lounge, walking there when people move
    const targets = useMemo(() => {
        const t: Record<string, Away> = {};
        for (const a of agents) {
            const at = awayTarget(a, now);
            if (at) {
                t[a.id] = at;
            }
        }
        return t;
    }, [agents, now]);
    const [settled, setSettled] = useState<Record<string, Away>>(targets);
    const walking = useAtomValue(walkingAtom);
    const walkingIds = useMemo(() => new Set(Object.keys(walking)), [walking]);
    // a walker is at neither end: the plan seats it nowhere, its desk empty and the lounge without it
    const planAway = useMemo(() => {
        const a = { ...settled };
        for (const [id, to] of Object.entries(walking)) {
            a[id] = to ?? a[id] ?? "coffee";
        }
        return a;
    }, [settled, walking]);
    const plan = useMemo(
        () => buildPlan({ agents, runs, width, now, away: planAway, night }),
        [agents, runs, width, now, planAway, night]
    );
    lastPlan = plan;

    const planRef = useRef(plan);
    planRef.current = plan;
    const cursorRef = useRef(cursorId);
    cursorRef.current = cursorId;
    const onCursorRef = useRef(onCursor);
    onCursorRef.current = onCursor;
    const movingRef = useRef(moving);
    movingRef.current = moving;
    const devRef = useRef(dev);
    devRef.current = dev;
    const arrivedRef = useRef<string | undefined>(undefined);
    const carry = useRef(0);
    const bossWasMoving = useRef(false);
    const hintTimer = useRef<number | undefined>(undefined);

    // the boss has stopped: the desk it stands at becomes the Cockpit's cursor
    const afterStop = () => {
        const b = globalStore.get(bossAtom);
        if (!b) {
            return;
        }
        const key = deskAt(planRef.current, b.at);
        if (key) {
            globalStore.set(bossAtom, { ...b, dir: "up" });
            if (key !== cursorRef.current) {
                arrivedRef.current = key;
                onCursorRef.current(key);
            }
        }
        rootRef.current?.querySelector("[data-office-boss]")?.scrollIntoView({ block: "nearest" });
    };

    const stepAll = (dt: number): boolean => {
        const plan = planRef.current;
        let bossBusy = false;
        const b = globalStore.get(bossAtom);
        if (b) {
            if (b.path.length > 1) {
                const r = advance(b.path, (b.speed * dt) / 1000);
                const done = r.rest.length < 2;
                globalStore.set(bossAtom, { ...b, at: r.at, path: done ? [] : r.rest, dir: facing(b.at, r.at, b.dir) });
                bossBusy = !done;
            } else if (b.holding) {
                carry.current += (BOSS_SPEED * dt) / 1000;
                if (carry.current >= STEP_PX) {
                    const dist = Math.floor(carry.current / STEP_PX) * STEP_PX;
                    carry.current -= dist;
                    globalStore.set(bossAtom, { ...b, at: stepToward(plan, b.at, b.holding, dist), dir: b.holding });
                }
                bossBusy = true;
            } else if (devRef.current?.patrol && plan.order.length > 1) {
                const at = deskAt(plan, b.at);
                const next = plan.order[(plan.order.indexOf(at ?? "") + 1) % plan.order.length];
                const spot = spotOf(plan, next);
                if (spot) {
                    globalStore.set(bossAtom, { ...b, path: pathBetween(plan, b.at, spot), speed: BOSS_SPEED });
                }
                bossBusy = true;
            }
        }
        if (bossWasMoving.current && !bossBusy) {
            afterStop();
        }
        bossWasMoving.current = bossBusy;

        const ws = globalStore.get(walkersAtom);
        let walkersBusy = false;
        if (ws.length > 0) {
            const next: Walker[] = [];
            const arrived: Walker[] = [];
            for (const w of ws) {
                const r = advance(w.path, (WALKER_SPEED * dt) / 1000);
                if (r.rest.length >= 2) {
                    next.push({ ...w, at: r.at, path: r.rest, dir: facing(w.at, r.at, w.dir) });
                } else if (w.loop) {
                    const back = sameSpot(r.at, w.loop[0]) ? w.loop[1] : w.loop[0];
                    next.push({ ...w, at: r.at, path: pathBetween(plan, r.at, back) });
                } else {
                    arrived.push(w);
                }
            }
            globalStore.set(walkersAtom, next);
            if (arrived.length > 0) {
                const left = { ...globalStore.get(walkingAtom) };
                for (const w of arrived) {
                    delete left[w.id];
                }
                globalStore.set(walkingAtom, left);
                setSettled((s) => arrived.reduce((acc, w) => withAway(acc, w.id, w.to), s));
            }
            walkersBusy = next.length > 0;
        }
        return bossBusy || walkersBusy;
    };
    const kick = useWalkLoop(stepAll);

    const goTo = (key: string) => {
        const b = globalStore.get(bossAtom);
        const spot = spotOf(planRef.current, key);
        if (!b || !spot) {
            return;
        }
        arrivedRef.current = key;
        globalStore.set(popupHiddenAtom, false);
        if (!movingRef.current) {
            globalStore.set(bossAtom, { ...b, at: spot, path: [], holding: undefined, dir: "up" });
            return;
        }
        globalStore.set(bossAtom, {
            ...b,
            path: pathBetween(planRef.current, b.at, spot),
            speed: JUMP_SPEED,
            holding: undefined,
        });
        kick();
    };
    const showPath = (key: string) => {
        const b = globalStore.get(bossAtom);
        const spot = spotOf(planRef.current, key);
        if (!b || !spot) {
            return;
        }
        arrivedRef.current = key;
        globalStore.set(dotsAtom, dotsAlong(pathBetween(planRef.current, b.at, spot)));
        window.clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => {
            globalStore.set(dotsAtom, []);
            goTo(key);
        }, PATH_HINT_MS);
    };
    const walk = (dir: Dir) => {
        const b = globalStore.get(bossAtom);
        if (!b) {
            return;
        }
        globalStore.set(popupHiddenAtom, false);
        if (!movingRef.current) {
            globalStore.set(bossAtom, {
                ...b,
                at: stepToward(planRef.current, b.at, dir, ARROW_STEP_PX),
                dir,
                path: [],
            });
            afterStop();
            return;
        }
        if (b.holding === dir) {
            return;
        }
        globalStore.set(bossAtom, { ...b, holding: dir, dir, path: [] });
        kick();
    };
    const release = (dir: Dir) => {
        const b = globalStore.get(bossAtom);
        if (b?.holding === dir) {
            globalStore.set(bossAtom, { ...b, holding: undefined });
        }
    };
    handleRef.current = {
        walk,
        release,
        goTo,
        showPath,
        dismiss: () => globalStore.set(popupHiddenAtom, true),
        order: () => planRef.current.order,
        asks: () => planRef.current.asks,
    };

    const pickRef = useRef((key: string) => {
        goTo(key);
        onCursor(key);
    });
    pickRef.current = (key: string) => {
        goTo(key);
        onCursor(key);
    };
    const onPick = useCallback((key: string) => pickRef.current(key), []);

    // the boss comes to where the Cockpit's cursor already is (a pick in the rail, Needs you, a reload)
    useEffect(() => {
        if (width === 0) {
            return;
        }
        if (globalStore.get(bossAtom) == null) {
            const at = (cursorId && spotOf(plan, cursorId)) ||
                spotOf(plan, plan.asks[0] ?? "") ||
                spotOf(plan, plan.order[0] ?? "") || {
                    x: plan.lounge.x + plan.lounge.w / 2,
                    y: plan.lounge.y + plan.lounge.h - 20,
                };
            globalStore.set(bossAtom, { at, path: [], dir: "up", speed: BOSS_SPEED });
            arrivedRef.current = cursorId;
            return;
        }
        if (cursorId && cursorId !== arrivedRef.current) {
            goTo(cursorId);
        }
    }, [cursorId, width > 0]);

    // idle people walk to the lounge and back, at most three at once
    useEffect(() => {
        const ids = Object.keys({ ...targets, ...settled }).filter(
            (id) => targets[id] !== settled[id] && !(id in walking)
        );
        if (ids.length === 0) {
            return;
        }
        if (!moving) {
            setSettled(targets);
            return;
        }
        const admit = admitWalkers(
            ids.map((id) => ({ id, idleSince: agents.find((a) => a.id === id)?.idleSince })),
            Object.keys(walking).length
        );
        const started: Walker[] = [];
        const dest: Record<string, Away | null> = { ...walking };
        for (const id of admit) {
            const desk = plan.desks.find((d) => d.key === id);
            const a = agents.find((x) => x.id === id);
            if (!desk || !a) {
                setSettled((s) => withAway(s, id, targets[id]));
                continue;
            }
            const spotFor = (at: Away | undefined) => (at === "sofa" ? plan.sofa : at === "coffee" ? plan.coffee : desk.spot);
            const from = spotFor(settled[id]);
            const to = spotFor(targets[id]);
            started.push({
                id,
                at: from,
                path: pathBetween(plan, from, to),
                dir: "down",
                to: targets[id],
                outfit: { shirt: shirtOf(a.harness), look: lookOf(id) },
            });
            dest[id] = targets[id] ?? null;
        }
        if (started.length === 0) {
            return;
        }
        globalStore.set(walkersAtom, [...globalStore.get(walkersAtom), ...started]);
        globalStore.set(walkingAtom, dest);
        kick();
    }, [targets, settled, walking, moving, plan]);

    // DEV (the bench): this many people walk desk to coffee and back without end
    useEffect(() => {
        const n = moving ? (dev?.walkers ?? 0) : 0;
        const all = globalStore.get(walkersAtom);
        const loops = all.filter((w) => w.loop);
        if (n === loops.length || width === 0) {
            return;
        }
        const made: Walker[] = plan.desks
            .filter((d) => d.pose !== "empty" && !walkingIds.has(d.key))
            .slice(0, n)
            .map((d) => ({
                id: d.key,
                at: d.spot,
                path: pathBetween(plan, d.spot, plan.coffee),
                dir: "down",
                outfit: { shirt: shirtOf(d.harness), look: lookOf(d.key) },
                loop: [d.spot, plan.coffee],
            }));
        globalStore.set(walkersAtom, [...all.filter((w) => !w.loop), ...made]);
        const dest = { ...globalStore.get(walkingAtom) };
        for (const w of loops) {
            delete dest[w.id];
        }
        for (const w of made) {
            dest[w.id] = null;
        }
        globalStore.set(walkingAtom, dest);
        if (made.length > 0) {
            kick();
        }
    }, [dev?.walkers, moving, width > 0]);

    useEffect(() => {
        if (dev?.patrol && moving) {
            kick();
        }
    }, [dev?.patrol, moving]);

    // motion turned off mid-walk: everyone is at once where they were going
    useEffect(() => {
        if (moving) {
            return;
        }
        const b = globalStore.get(bossAtom);
        if (b && (b.path.length > 1 || b.holding)) {
            globalStore.set(bossAtom, { ...b, at: b.path[b.path.length - 1] ?? b.at, path: [], holding: undefined });
        }
        const ws = globalStore.get(walkersAtom);
        if (ws.length > 0) {
            globalStore.set(walkersAtom, []);
            globalStore.set(walkingAtom, {});
            setSettled((s) => ws.reduce((acc, w) => (w.loop ? acc : withAway(acc, w.id, w.to)), s));
        }
    }, [moving]);

    useEffect(
        () => () => {
            window.clearTimeout(hintTimer.current);
            globalStore.set(bossAtom, null);
            globalStore.set(walkersAtom, []);
            globalStore.set(walkingAtom, {});
            globalStore.set(dotsAtom, []);
            globalStore.set(popupHiddenAtom, false);
            globalStore.set(officeCountsAtom, null);
            setOfficeRoot(null);
            lastPlan = null;
        },
        []
    );

    // the 5-hour window reset: everyone at a desk stretches once
    const prevPct = useRef(pct);
    const [stretching, setStretching] = useState(false);
    useEffect(() => {
        const reset = isReset(prevPct.current, pct);
        prevPct.current = pct;
        if (!reset) {
            return;
        }
        setStretching(true);
        const t = window.setTimeout(() => setStretching(false), STRETCH_MS);
        return () => window.clearTimeout(t);
    }, [pct]);

    const animated =
        plan.desks.filter((d) => d.animated && !walkingIds.has(d.key)).length +
        plan.seats.filter((s) => s.animated).length;
    useFrameClock(animated > 0 || stretching, animationOn);

    useEffect(() => {
        setOfficeRoot(rootRef.current);
        const seated =
            plan.desks.filter((d) => d.pose !== "empty" && !walkingIds.has(d.key)).length +
            plan.seats.filter((s) => s.pose !== "empty").length;
        const lounging = plan.loungers.filter((l) => !walkingIds.has(l.agentId)).length;
        const people = seated + lounging + walkingIds.size + 1;
        const prev = globalStore.get(officeCountsAtom);
        if (prev?.people !== people || prev.walking !== walkingIds.size || prev.animated !== animated) {
            globalStore.set(officeCountsAtom, { people, walking: walkingIds.size, animated });
        }
        Object.assign(probe, {
            people,
            desks: plan.desks.length,
            seats: plan.seats.length,
            rooms: plan.rooms.length,
            dark: plan.rooms.filter((r) => !r.lit).map((r) => r.key),
            night,
            lamps: night ? plan.desks.filter((d) => d.light !== "off").length : 0,
            cups: energy === "tired" ? plan.desks.filter((d) => d.light === "working").length : 0,
            walking: walkingIds.size,
        });
    });

    return (
        <div ref={scrollRef} data-cockpit-office className="min-h-0 flex-1 overflow-auto px-5 pb-3 pt-2.5">
            <OfficeHeading now={now} night={night} pct={pct} />
            {width > 0 ? (
                <div ref={rootRef} className="relative isolate mt-2" style={{ width: plan.width, height: plan.height }}>
                    <Building plan={plan} night={night} />
                    {plan.desks.map((d) => (
                        <DeskView
                            key={d.key}
                            d={d}
                            hidePerson={walkingIds.has(d.key)}
                            energy={energy}
                            stretching={stretching}
                            onPick={onPick}
                        />
                    ))}
                    {plan.rooms.map((r) => (r.table ? <Table key={r.key} room={r} onPick={onPick} /> : null))}
                    {plan.seats.map((s) => (
                        <SeatView key={s.key} s={s} onPick={onPick} />
                    ))}
                    {plan.loungers
                        .filter((l) => !walkingIds.has(l.agentId))
                        .map((l) => (
                            <LoungerView key={l.agentId} l={l} />
                        ))}
                    <Shades plan={plan} night={night} />
                    <Walls plan={plan} night={night} />
                    <Labels plan={plan} walking={walkingIds} night={night} />
                    <WalkersView />
                    <BossView plan={plan} />
                    <PathDots />
                    <OfficePopup plan={plan} cursorId={cursorId} renderCard={renderCard} />
                    {dev?.sheet ? <PoseSheet /> : null}
                </div>
            ) : null}
        </div>
    );
}

function OfficeHeading({ now, night, pct }: { now: number; night: boolean; pct?: number }) {
    const time = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const tired = pct != null && pct >= 90;
    const kbd = "rounded border border-edge-mid bg-surface-raised px-1 font-mono text-[10.5px] text-secondary";
    return (
        <div data-office-heading className="flex items-center gap-4 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
                {night ? <Moon size={14} className="text-ink-mid" /> : <Sun size={14} className="text-graphlane-3" />}
                <span className="tabular-nums text-primary">{time}</span>
                {night ? "after hours" : "work hours"}
            </span>
            <span
                title="Claude's 5-hour window, as the app bar meter reads it"
                className={cn("flex items-center gap-1.5 tabular-nums", tired && "text-asking")}
            >
                <Zap size={14} />
                {pct == null ? "—" : `${Math.round(pct)} %`}
            </span>
            <span className="ml-auto flex items-center gap-2.5 text-[11.5px]">
                <span>
                    <kbd className={kbd}>←↑↓→</kbd> walk
                </span>
                <span>
                    <kbd className={kbd}>j</kbd> <kbd className={kbd}>k</kbd> desk
                </span>
                <span>
                    <kbd className={kbd}>n</kbd> next ask
                </span>
                <span>
                    <kbd className={kbd}>o</kbd> cards
                </span>
            </span>
        </div>
    );
}

function Person({ sprite, outfit, left, bottom }: { sprite: PlanSprite; outfit: PlanOutfit; left: number; bottom: number }) {
    const h = spriteH(sprite);
    return (
        <img
            alt=""
            draggable={false}
            src={planSpriteUrl(sprite, outfit)}
            className="pointer-events-none absolute z-[1] [image-rendering:pixelated]"
            style={{ left, top: bottom - h, width: spriteWidth(sprite) * PLAN_CELL, height: h }}
        />
    );
}

// the cheer as a desk turns done: the plan's coarse clock would miss a 1.5 s pose, so the view times it
function useCheerOnce(done: boolean): boolean {
    const [on, setOn] = useState(false);
    const was = useRef(done);
    useEffect(() => {
        const fresh = done && !was.current;
        was.current = done;
        if (!fresh) {
            return;
        }
        setOn(true);
        const t = window.setTimeout(() => setOn(false), CHEER_MS);
        return () => window.clearTimeout(t);
    }, [done]);
    return on;
}

function TickPerson(p: { id: string; pose: SeatPose; outfit: PlanOutfit; working: boolean; energy: Energy; stretching: boolean }) {
    const tick = useAtomValue(officeTickAtom);
    const sprite: PlanSprite =
        p.working && p.stretching
            ? "stretch"
            : p.working && yawnsNow(p.id, tick, p.energy)
              ? "yawn"
              : (seatSprite(p.pose, (tick % 2) as 0 | 1) ?? "doze");
    return <Person sprite={sprite} outfit={p.outfit} left={26} bottom={56} />;
}

const DESK_CLASS =
    "absolute z-[1] isolate cursor-pointer border-0 bg-transparent p-0 [contain-intrinsic-size:88px_98px] [content-visibility:auto] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
    // the desk's top and face are pseudo-elements, not nodes: the bench's 2,000-node budget
    "before:absolute before:left-[4px] before:top-[50px] before:z-[2] before:h-[22px] before:w-[80px] before:bg-office-desk-top before:content-[''] " +
    "after:absolute after:left-[4px] after:top-[72px] after:z-[2] after:h-[8px] after:w-[80px] after:bg-office-desk-face after:content-['']";

const DeskView = memo(function DeskView(p: { d: Desk; hidePerson: boolean; energy: Energy; stretching: boolean; onPick: (key: string) => void }) {
    const { d, hidePerson, energy, stretching, onPick } = p;
    const outfit = useMemo<PlanOutfit>(() => ({ shirt: shirtOf(d.harness), look: lookOf(d.key) }), [d.harness, d.key]);
    const cheering = useCheerOnce(d.word === "done");
    const seated = !hidePerson && d.pose !== "empty";
    const working = d.light === "working";
    const pose: SeatPose = cheering ? "cheer" : d.pose;
    const ticks = d.animated || cheering || (working && (energy !== "fresh" || stretching));
    return (
        <button
            type="button"
            data-office-desk={d.key}
            data-office-pose={seated ? pose : "empty"}
            title={d.tip}
            aria-label={d.tip}
            onClick={() => onPick(d.key)}
            className={cn(DESK_CLASS, d.dim && "opacity-60")}
            style={{ left: d.x - 4, top: d.y - 50, width: 88, height: 98 }}
        >
            {seated ? (
                ticks ? (
                    <TickPerson id={d.key} pose={pose} outfit={outfit} working={working} energy={energy} stretching={stretching} />
                ) : (
                    <Person sprite={seatSprite(pose, 0) ?? "doze"} outfit={outfit} left={26} bottom={56} />
                )
            ) : null}
            <span className="absolute left-[30px] top-[44px] z-[3] box-border h-[18px] w-[28px] border-2 border-solid border-surface-hover bg-surface-code" />
            <span
                className={cn(
                    "absolute left-[42px] top-[54px] z-[4] h-[2px] w-[4px]",
                    working ? "bg-working" : d.light === "asking" ? "bg-asking" : "bg-edge-mid"
                )}
            />
            <span className="absolute left-[66px] top-[42px] z-[3] box-border h-[22px] w-[12px] border border-solid border-surface-hover bg-surface-code" />
            {energy === "tired" && working ? (
                <span className="absolute left-[12px] top-[54px] z-[4] h-[9px] w-[7px] rounded-b-[2px] bg-office-cup" />
            ) : null}
        </button>
    );
});

function TickSeat({ pose, outfit }: { pose: SeatPose; outfit: PlanOutfit }) {
    const tick = useAtomValue(officeTickAtom);
    return <Person sprite={seatSprite(pose, (tick % 2) as 0 | 1) ?? "doze"} outfit={outfit} left={0} bottom={42} />;
}

const SeatView = memo(function SeatView({ s, onPick }: { s: Seat; onPick: (key: string) => void }) {
    const outfit = useMemo<PlanOutfit>(
        () => ({ shirt: s.lane === 0 ? LEAD_SHIRT : LANE_SHIRTS[(s.lane - 1) % LANE_SHIRTS.length], look: lookOf(s.key) }),
        [s.lane, s.key]
    );
    if (s.pose === "empty") {
        return null;
    }
    return (
        <button
            type="button"
            data-office-seat={s.key}
            data-office-pose={s.pose}
            title={s.tip}
            aria-label={s.tip}
            onClick={() => onPick(s.key)}
            className="absolute cursor-pointer border-0 bg-transparent p-0 [contain-intrinsic-size:36px_42px] [content-visibility:auto] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            // the near side is in front of the table, the far side behind it
            style={{ left: s.x, top: s.bottom - 42, width: 36, height: 42, zIndex: s.pose === "back" ? 3 : 1 }}
        >
            {s.animated ? (
                <TickSeat pose={s.pose} outfit={outfit} />
            ) : (
                <Person sprite={seatSprite(s.pose, 0) ?? "doze"} outfit={outfit} left={0} bottom={42} />
            )}
        </button>
    );
});

function Table({ room, onPick }: { room: Room; onPick: (key: string) => void }) {
    const t = room.table!;
    return (
        <>
            <button
                type="button"
                data-office-room={room.key}
                title={`${room.title} (Enter opens the run)`}
                aria-label={`${room.title}, the run's card`}
                onClick={() => room.runId && onPick(room.runId)}
                className="absolute z-[2] box-border cursor-pointer rounded-md border-0 border-b-[7px] border-solid border-office-desk-face bg-office-desk-top p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={box(t)}
            />
            {room.more ? (
                <span
                    className="pointer-events-none absolute z-[2] text-[11px] font-semibold text-primary"
                    style={{ left: t.x + t.w - 30, top: t.y + 6 }}
                >
                    +{room.more}
                </span>
            ) : null}
        </>
    );
}

function LoungerView({ l }: { l: Lounger }) {
    const outfit = useMemo<PlanOutfit>(() => ({ shirt: shirtOf(l.harness), look: lookOf(l.agentId) }), [l.harness, l.agentId]);
    return <Person sprite={l.at === "sofa" ? "back" : "cup"} outfit={outfit} left={l.x} bottom={l.bottom} />;
}

function Screen({ r }: { r: Room }) {
    const cells = r.screen ?? [];
    const done = cells.filter((c) => c === "done").length;
    return (
        <span
            className="absolute z-[1] box-border flex flex-col justify-between border-[3px] border-solid border-edge-strong bg-surface-code p-[5px]"
            style={{ left: r.box.x + r.box.w - 170, top: r.box.y + 8, width: 152, height: 36 }}
        >
            <span className="flex flex-wrap gap-[3px]">
                {cells.map((c, i) => (
                    <span key={i} className={cn("h-[8px] w-[10px]", SCREEN[c])} />
                ))}
            </span>
            <span className="h-[3px] w-full bg-edge-mid">
                <span className="block h-[3px] bg-working" style={{ width: cells.length ? `${(100 * done) / cells.length}%` : 0 }} />
            </span>
        </span>
    );
}

function Building({ plan, night }: { plan: Plan; night: boolean }) {
    const l = plan.lounge;
    const e = plan.entrance;
    const y = plan.body.y + plan.body.h;
    const windows: number[] = [];
    for (let x = 60; x < plan.width - 60; x += 140) {
        if (x + 36 < e.x - 20 || x > e.x + e.w + 20) {
            windows.push(x);
        }
    }
    return (
        <>
            <span className="absolute z-0 bg-office-hall" style={box(plan.hall)} />
            {plan.rooms.map((r) => (
                <span key={r.key} data-office-floor={r.kind} className="absolute z-0" style={{ ...box(r.box), ...FLOOR[r.kind] }} />
            ))}
            {/* the lounge: the TV on the wall, the sofa facing it, the coffee machine, a plant */}
            <span className="absolute z-[1] box-border border-2 border-solid border-surface-hover bg-surface-code" style={{ left: l.x + 62, top: l.y, width: 110, height: 14 }} />
            <span className="absolute z-[1] rounded-t-[4px] bg-edge-strong" style={{ left: l.x + 168, top: l.y + 104, width: 30, height: 46 }} />
            <span className="absolute z-[2] rounded-t-[8px] bg-office-sofa" style={{ left: l.x + 40, top: l.y + 150, width: 150, height: 20 }} />
            <span className="absolute z-[2] rounded-[6px] bg-office-sofa brightness-75" style={{ left: l.x + 34, top: l.y + 166, width: 162, height: 16 }} />
            <span className="absolute z-[1] rounded-b-[4px] rounded-t-[11px] bg-office-plant" style={{ left: l.x + 204, top: l.y + 176, width: 22, height: 34 }} />
            {plan.rooms
                .filter((r) => r.kind === "agents")
                .map((r) => (
                    <span key={`plant:${r.key}`} className="absolute z-[1] rounded-b-[4px] rounded-t-[11px] bg-office-plant" style={{ left: r.box.x + r.box.w - 40, top: r.box.y + r.box.h - 60, width: 22, height: 34 }} />
                ))}
            {plan.rooms
                .filter((r) => r.kind === "meeting" && r.runId)
                .map((r) => (
                    <Screen key={`screen:${r.key}`} r={r} />
                ))}
            {/* the facade: brick, windows, the glass doors at the hall's foot, the sign over them */}
            <span className="absolute z-[1]" style={{ left: 0, top: y, width: plan.width, height: plan.height - y, ...BRICK }} />
            {windows.map((x) => (
                <span
                    key={x}
                    className={cn("absolute z-[1] box-border border-[3px] border-solid border-office-wall-top", night ? "bg-office-window-night" : "bg-office-window-day")}
                    style={{ left: x, top: y + 8, width: 36, height: 20 }}
                />
            ))}
            <span className="absolute z-[1] box-border border-x-[3px] border-solid border-office-wall-top bg-white/15" style={box(e)} />
            <span
                data-office-sign
                className={cn(
                    "absolute z-[6] flex items-center justify-center rounded-[4px] border-2 border-solid border-accent bg-surface-code font-mono text-[14px] font-extrabold tracking-[0.18em] text-accent-50",
                    night ? "shadow-office-sign-night" : "shadow-office-sign"
                )}
                style={{ left: e.x + e.w / 2 - 80, top: y - 16, width: 160, height: 26 }}
            >
                ARCTERM
            </span>
        </>
    );
}

function Shades({ plan, night }: { plan: Plan; night: boolean }) {
    return (
        <>
            {plan.rooms
                .filter((r) => !r.lit)
                .map((r) => (
                    <span key={r.key} data-office-dark={r.key} className="pointer-events-none absolute z-[4] bg-office-dark" style={box(r.box)} />
                ))}
            {night ? <span data-office-night className="pointer-events-none absolute z-[4] bg-office-night" style={box(plan.body)} /> : null}
        </>
    );
}

function Walls({ plan, night }: { plan: Plan; night: boolean }) {
    const windows: number[] = [];
    for (let x = 60; x < plan.width - 60; x += 130) {
        windows.push(x);
    }
    return (
        <>
            {plan.walls.map((w, i) => (
                <span
                    key={i}
                    className={cn(
                        "pointer-events-none absolute z-[5]",
                        w.h === HWALL && w.w > WALL
                            ? "box-border border-t-8 border-solid border-office-wall-top bg-office-wall-face"
                            : "bg-office-wall-top"
                    )}
                    style={box(w)}
                />
            ))}
            {windows.map((x) => (
                <span
                    key={`w${x}`}
                    className={cn("pointer-events-none absolute z-[5] h-[6px] w-[26px]", night ? "bg-office-window-night" : "bg-office-window-day")}
                    style={{ left: x, top: 10 }}
                />
            ))}
        </>
    );
}

function Bubble({ mark, left, top }: { mark: string; left: number; top: number }) {
    return (
        <span
            className={cn("pointer-events-none absolute z-[6] flex size-5 items-center justify-center rounded-[6px] text-[13px] font-extrabold", BUBBLE[mark])}
            style={{ left, top }}
        >
            {mark}
        </span>
    );
}

function Labels({ plan, walking, night }: { plan: Plan; walking: Set<string>; night: boolean }) {
    return (
        <>
            {plan.rooms
                .filter((r) => r.kind !== "lounge")
                .map((r) => (
                    <span key={r.key} className="pointer-events-none absolute z-[6] flex flex-col" style={{ left: r.box.x + 14, top: r.box.y + 10 }}>
                        <span className="text-[13px] font-bold text-primary">{r.title}</span>
                        <span className="text-[11px] text-secondary">{r.sub}</span>
                    </span>
                ))}
            {plan.desks.map((d) => (
                <Fragment key={d.key}>
                    <span
                        className={cn("pointer-events-none absolute z-[6] w-[140px] truncate text-center text-[11px]", TONE[d.tone])}
                        style={{ left: d.x - 30, top: d.y + 34 }}
                    >
                        {d.word ? `${d.name} · ${d.word}` : d.name}
                    </span>
                    {d.bubble && !walking.has(d.key) ? <Bubble mark={d.bubble} left={d.x + 56} top={d.y - 46} /> : null}
                    {night && d.light !== "off" ? (
                        <span className="pointer-events-none absolute z-[6] h-[6px] w-[12px] rounded-t-[3px] bg-office-lamp shadow-office-lamp" style={{ left: d.x + 4, top: d.y - 10 }} />
                    ) : null}
                </Fragment>
            ))}
            {plan.seats
                .filter((s) => s.bubble)
                .map((s) => (
                    <Bubble key={s.key} mark={s.bubble!} left={s.x + 22} top={s.bottom - 58} />
                ))}
            {/* after hours a meeting room with a running task lights its table */}
            {night
                ? plan.rooms
                      .filter((r) => r.kind === "meeting" && r.lit && r.table)
                      .map((r) => (
                          <span
                              key={`lamp:${r.key}`}
                              className="pointer-events-none absolute z-[6] h-[6px] w-[12px] rounded-t-[3px] bg-office-lamp shadow-office-lamp"
                              style={{ left: r.table!.x + r.table!.w / 2 - 6, top: r.table!.y - 8 }}
                          />
                      ))
                : null}
            {plan.loungers
                .filter((l) => !walking.has(l.agentId))
                .map((l) => (
                    <span key={l.agentId} className="pointer-events-none absolute z-[6] w-[120px] truncate text-center text-[11px] text-muted" style={{ left: l.x - 42, top: l.bottom + 4 }}>
                        {l.label}
                    </span>
                ))}
        </>
    );
}

function Mover(p: { at: Point; sprite: PlanSprite; mirror: boolean; outfit: PlanOutfit; boss?: boolean }) {
    const w = spriteWidth(p.sprite) * PLAN_CELL;
    const h = spriteH(p.sprite);
    return (
        <img
            alt=""
            draggable={false}
            data-office-boss={p.boss ? "" : undefined}
            src={planSpriteUrl(p.sprite, p.outfit)}
            className="pointer-events-none absolute left-0 top-0 z-[7] [image-rendering:pixelated]"
            style={{
                width: w,
                height: h,
                transform: `translate(${Math.round(p.at.x - w / 2)}px, ${Math.round(p.at.y - h)}px)${p.mirror ? " scaleX(-1)" : ""}`,
            }}
        />
    );
}

function WalkersView() {
    const ws = useAtomValue(walkersAtom);
    const frame = walkFrame();
    return (
        <>
            {ws.map((w) => (
                <Mover key={w.id} at={w.at} sprite={walkSprite(w.dir, frame)} mirror={mirrorOf(w.dir)} outfit={w.outfit} />
            ))}
        </>
    );
}

function BossView({ plan }: { plan: Plan }) {
    const b = useAtomValue(bossAtom);
    if (!b) {
        return null;
    }
    const moving = b.path.length > 1 || b.holding != null;
    const sprite: PlanSprite = moving ? walkSprite(b.dir, walkFrame()) : deskAt(plan, b.at) ? "boss" : "down1";
    return (
        <>
            <span
                className="pointer-events-none absolute left-0 top-0 z-[7] h-3 w-11 rounded-full bg-accent/35"
                style={{ transform: `translate(${Math.round(b.at.x - 22)}px, ${Math.round(b.at.y - 8)}px)` }}
            />
            <Mover at={b.at} sprite={sprite} mirror={moving && mirrorOf(b.dir)} outfit={BOSS_OUTFIT} boss />
        </>
    );
}

function PathDots() {
    const dots = useAtomValue(dotsAtom);
    if (dots.length === 0) {
        return null;
    }
    const end = dots[dots.length - 1];
    return (
        <>
            {dots.map((p, i) => (
                <span
                    key={i}
                    data-office-dot
                    className="pointer-events-none absolute left-0 top-0 z-[7] size-1.5 rounded-full bg-asking"
                    style={{ transform: `translate(${Math.round(p.x - 3)}px, ${Math.round(p.y - 3)}px)` }}
                />
            ))}
            <span className="pointer-events-none absolute z-[7] w-[120px] text-center text-[11px] font-semibold text-asking" style={{ left: end.x - 60, top: end.y + 8 }}>
                next Needs you
            </span>
        </>
    );
}

function OfficePopup({ plan, cursorId, renderCard }: { plan: Plan; cursorId?: string; renderCard: (key: string) => ReactNode }) {
    const b = useAtomValue(bossAtom);
    const hidden = useAtomValue(popupHiddenAtom);
    const still = b != null && b.path.length < 2 && b.holding == null;
    const at = still && cursorId ? deskAt(plan, b.at) : undefined;
    const desk = at != null && at === cursorId ? plan.desks.find((d) => d.key === cursorId) : undefined;
    const seat = at != null && at === cursorId && !desk ? plan.seats.find((s) => s.key === cursorId) : undefined;
    const room = plan.rooms.find((r) => r.key === (desk?.room ?? seat?.room));
    const card = !hidden && room != null && cursorId != null ? renderCard(cursorId) : null;
    probe.popup = card ? (desk ? "agent" : "run") : "";
    if (!card || !room) {
        return null;
    }
    const anchor = desk ? { x: desk.x, y: desk.y } : { x: seat!.x, y: seat!.bottom - 40 };
    // beside the desk, over the hall: right of the agents' rooms, left of a meeting room
    const right = room.kind !== "meeting";
    const left = Math.max(0, Math.min(plan.width - 380, right ? anchor.x + 100 : room.box.x - 380));
    const top = Math.max(0, Math.min(plan.height - 320, anchor.y - 60));
    return (
        <div data-office-popup={desk ? "agent" : "run"} className="absolute z-[8] w-[380px] rounded-md border border-edge-mid bg-surface-raised shadow-popover" style={{ left, top }}>
            <span
                className={cn("absolute size-2.5 rotate-45 border-edge-mid bg-surface-raised", right ? "-left-[6px] border-b border-l" : "-right-[6px] border-r border-t")}
                style={{ top: Math.max(8, Math.min(300, anchor.y + 4 - top)) }}
            />
            {card}
        </div>
    );
}

// DEV (the States board): every sprite, to judge the set at a glance
function PoseSheet() {
    const outfit: PlanOutfit = { shirt: shirtOf("claude"), look: 1 };
    return (
        <div data-office-sheet className="absolute left-2 top-2 z-[9] grid grid-cols-6 gap-3 rounded-md border border-edge-mid bg-surface-raised p-3">
            {(Object.keys(PLAN_SPRITES) as PlanSprite[]).map((s) => (
                <div key={s} className="flex flex-col items-center gap-1">
                    <img
                        alt=""
                        src={planSpriteUrl(s, s.startsWith("down") || s === "boss" ? BOSS_OUTFIT : outfit)}
                        className="[image-rendering:pixelated]"
                        style={{ width: spriteWidth(s) * PLAN_CELL, height: spriteH(s) }}
                    />
                    <span className="font-mono text-[10.5px] text-muted">{s}</span>
                </div>
            ))}
        </div>
    );
}
```

- [ ] **Step 2: Write `frontend/app/view/agents/cockpitofficedevhooks.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-only seams for the cockpit-office scenarios (scripts/cdp/cockpitofficescenarios.mjs): set what the office draws
// in place of live data, and read what it drew. cockpitsurface.tsx imports this dynamically under
// import.meta.env.DEV only, so a production build never has it.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "./agents";
import { officeDevAtom, readOfficeProbe, type OfficeDev } from "./cockpitoffice";
import { officeAnimationAtom } from "./officestore";

declare global {
    interface Window {
        __cockpitOffice?: (o: OfficeDev | null) => void;
        __cockpitOfficeProbe?: () => unknown;
        __cockpitOfficeAnimation?: (on: boolean) => void;
    }
}

export function installCockpitOfficeDevHooks(model: AgentsViewModel): void {
    window.__cockpitOffice = (o) =>
        globalStore.set(officeDevAtom, o == null ? null : { ...(globalStore.get(officeDevAtom) ?? {}), ...o });
    window.__cockpitOfficeAnimation = (on) => globalStore.set(officeAnimationAtom, on);
    window.__cockpitOfficeProbe = () => {
        const cursor = globalStore.get(model.cursorIdAtom);
        const sel = cursor ? (globalStore.get(model.answerSelAtom)[cursor] ?? {}) : {};
        return {
            ...readOfficeProbe(),
            cursor,
            answerSel: Object.fromEntries(Object.entries(sel).map(([q, s]) => [q, [...(s as Set<number>)]])),
        };
    };
}
```

If `model.cursorIdAtom` or `model.answerSelAtom` is not a plain readable atom on `AgentsViewModel`, read them the
way `cockpitsurface.tsx` does (`useModelAtom(model.cursorIdAtom)` there shows the field names).

- [ ] **Step 3: The keyboard: Office keys and `o`**

In `frontend/app/view/agents/usecockpitkeyboard.ts`:

1. Add after the imports:
   ```ts
   import type { Dir } from "./officeboss";

   export const ARROW_DIR: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

   /** What the Cockpit's keys can ask of the office (cockpitoffice.tsx's handle), while it shows Office. */
   export interface OfficeKeys {
       walk(dir: Dir): void;
       goTo(key: string): void;
       showPath(key: string): void;
       dismiss(): void;
       order(): string[];
       asks(): string[];
   }
   ```
2. In `CockpitKeyDeps`, after `focusRowComposer: (id: string) => void;`, add:
   ```ts
       // set while the Cockpit shows Office: the arrows walk, j k n go desk by desk in office order
       office?: OfficeKeys;
       toggleView?: () => void;
   ```
3. In the destructuring at the top of `useCockpitKeyboard`, after `focusRowComposer,` add `office,` and `toggleView,`.
4. Right after
   ```ts
           if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) {
               return; // typing — let the input own its keys
           }
   ```
   insert:
   ```ts
           if (e.key === "o" && !e.metaKey && !e.ctrlKey && !e.altKey && toggleView) {
               e.preventDefault();
               toggleView();
               return;
           }
           if (office) {
               const dir = ARROW_DIR[e.key];
               if (dir) {
                   e.preventDefault();
                   office.walk(dir);
                   return;
               }
               if (e.key === "j" || e.key === "k") {
                   e.preventDefault();
                   const next = moveCursor(office.order(), cursorId, e.key === "j" ? 1 : -1);
                   if (next) {
                       setCursorId(next);
                       office.goTo(next);
                   }
                   return;
               }
               if (e.key === "n") {
                   e.preventDefault();
                   const target = nextAskId(office.asks(), lastJumpRef.current);
                   if (target) {
                       lastJumpRef.current = target;
                       setCursorId(target);
                       office.showPath(target);
                   }
                   return;
               }
               if (e.key === "Escape") {
                   office.dismiss();
                   return;
               }
               if (e.key === "h" || e.key === "l") {
                   // a question with several parts keeps h/l for its tabs; in the office they do nothing else
                   const asker = askerAt(cursorId, roster, rowTargets);
                   const n = asker?.ask?.questions?.length ?? 0;
                   if (asker?.state === "asking" && n > 1) {
                       e.preventDefault();
                       const curTab = Math.min(answerTab[asker.id] ?? 0, n - 1);
                       selectQuestion(asker.id, Math.max(0, Math.min(n - 1, curTab + (e.key === "h" ? -1 : 1))));
                   }
                   return;
               }
           }
   ```

- [ ] **Step 4: Wire the office into `frontend/app/view/agents/cockpitsurface.tsx`**

1. Change `import { useEffect, useMemo, useRef, useState } from "react";` to
   `import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";`.
2. Change `import { useCockpitKeyboard } from "./usecockpitkeyboard";` to
   `import { ARROW_DIR, useCockpitKeyboard, type OfficeKeys } from "./usecockpitkeyboard";` and add below it:
   ```ts
   import { CockpitOffice, type OfficeHandle } from "./cockpitoffice";
   import { officeInputs } from "./officeinputs";
   import { cockpitView, cockpitViewAtom } from "./officestore";
   import { usePlanDonuts } from "./usagemeters";
   ```
3. Delete this block (it moves below the cards, step 6):
   ```ts
       // open a live transcript stream + git tracking per rendered active agent; keep recently-idle
       // streams during the grace window so final transcript writes cannot race the stop event.
       useCardStreams(
           streamableTranscriptAgents([...asking, ...working, ...recentlyIdle], structuralNow)
               .filter((a) => a.transcriptPath)
               .map((a) => ({ id: a.id, path: a.transcriptPath!, agent: a.agent, blockId: a.blockId })),
           { trackGit: true },
       );
   ```
4. After `const setChip = (c: ChipFilter) => globalStore.set(model.chipFilterAtom, c);` add:
   ```ts
       // the Cockpit is the card grid or the office (cockpit office spec); the office draws the same cards
       const view = cockpitView(useAtomValue(cockpitViewAtom));
       const officeRef = useRef<OfficeHandle | null>(null);
       const fiveHour = usePlanDonuts(model).find((d) => d.provider === "claude")?.fivehour.pct;
   ```
5. In the grid's ResizeObserver effect, change its closing
   ```ts
           ro.observe(el);
           measure();
           return () => ro.disconnect();
       }, []);
   ```
   to `}, [view]);` (the grid's scroller mounts again when the Cockpit comes back from Office).
6. After `const readyCount = shownCards.filter((c) => cardMatchesChip(c, "idle", cardNeedsYou(c))).length;` add:
   ```ts
       // open a live transcript stream + git tracking per rendered active agent; keep recently-idle
       // streams during the grace window so final transcript writes cannot race the stop event. The office opens only
       // the card beside the boss, so it streams that agent and the runs' leads, not one per card.
       const streamable = streamableTranscriptAgents([...asking, ...working, ...recentlyIdle], structuralNow).filter(
           (a) => a.transcriptPath
       );
       const officeLeads = new Set(cards.flatMap((c) => (c.kind === "run" && c.lead ? [c.lead.id] : [])));
       useCardStreams(
           (view === "office" ? streamable.filter((a) => a.id === cursorId || officeLeads.has(a.id)) : streamable).map(
               (a) => ({ id: a.id, path: a.transcriptPath!, agent: a.agent, blockId: a.blockId })
           ),
           { trackGit: true },
       );
   ```
7. After `const shownBackgrounded = backgrounded.filter((a) => matchesProjectFilter(a, projectFilter));` add:
   ```ts
       // the office draws the cards and the Idle section's agents (cockpit office spec, "Where it lives")
       const officeIn = view === "office" ? officeInputs(cards, shownParkedIdle, leadVMs, agents, lineage) : null;
   ```
8. Replace the cursor effect
   ```ts
       useEffect(() => {
           const next = resolveCursor(cursorId, navigableIds, cursorAlias);
           if (next !== cursorId) {
               setCursorId(next);
           }
       }, [navigableIds.join(","), cursorId]);
   ```
   with:
   ```ts
       useEffect(() => {
           // the office's stops include the Idle section's agents and seats with no card row
           const stops = view === "office" ? [...navigableIds, ...(officeRef.current?.order() ?? [])] : navigableIds;
           const next = resolveCursor(cursorId, stops, cursorAlias);
           if (next !== cursorId) {
               setCursorId(next);
           }
       }, [navigableIds.join(","), cursorId, view]);
   ```
9. Replace the `useCockpitKeyboard({ ... })` call with:
   ```ts
       const officeKeys = useMemo<OfficeKeys>(
           () => ({
               walk: (d) => officeRef.current?.walk(d),
               goTo: (k) => officeRef.current?.goTo(k),
               showPath: (k) => officeRef.current?.showPath(k),
               dismiss: () => officeRef.current?.dismiss(),
               order: () => officeRef.current?.order() ?? [],
               asks: () => officeRef.current?.asks() ?? [],
           }),
           []
       );
       const toggleView = () => globalStore.set(cockpitViewAtom, view === "office" ? "cards" : "office");
       const onKeyDown = useCockpitKeyboard({
           model, navigableIds, cursorId, setCursorId, answerTab, answerSel,
           navCols, rowTargets, askTargets, roster: agents, lastJumpRef, setOpenComposerId,
           selectQuestion, toggleAnswer, submitAnswer, toggleBackground, openFocus, scrollToPulse, focusRowComposer,
           office: view === "office" ? officeKeys : undefined,
           toggleView,
       });
   ```
10. Right before `const phase = rosterLoadPhase(` add:
    ```tsx
        // the card beside the desk the boss stands at: an agent's AgentRow, or for a seat or a meeting room its run's
        // LeadCard, the very ones the grid draws; an agent of the Idle section gets its row too
        const renderOfficeCard = (key: string): ReactNode => {
            const c = cards.find((x) =>
                x.kind === "agent"
                    ? x.id === key
                    : x.id === key || key.startsWith(`${x.id}:`) || rowsOf(x).some((r) => r.key === key)
            );
            if (c) {
                return renderCard(c);
            }
            const parked = shownParkedIdle.find((a) => a.id === key);
            return parked ? renderAgent(parked, cardShare(false, false)) : null;
        };
    ```
11. Right before `const gridScrollRef = useRef<HTMLDivElement>(null);` add:
    ```ts
        // DEV-only seams for the cockpit-office scenarios; never in a production build
        useEffect(() => {
            if (import.meta.env.DEV) {
                void import("./cockpitofficedevhooks").then((m) => m.installCockpitOfficeDevHooks(model));
            }
        }, []);
    ```
12. On the container `<div ref={containerRef} data-cockpit-surface ...>`, after `onKeyDown={onKeyDown}` add:
    ```tsx
                onKeyUp={(e) => {
                    const dir = ARROW_DIR[e.key];
                    if (view === "office" && dir) {
                        officeRef.current?.release(dir);
                    }
                }}
    ```
13. In the heading row, right before `<ProjectSwitcher model={model} variant="header" />`, add:
    ```tsx
                            <div
                                role="group"
                                aria-label="Cockpit view"
                                data-cockpit-view-toggle
                                className="flex gap-0.5 rounded border border-edge-mid bg-surface p-0.5"
                            >
                                {(["cards", "office"] as const).map((v) => (
                                    <button
                                        key={v}
                                        type="button"
                                        aria-pressed={view === v}
                                        title={`${v === "cards" ? "Cards" : "Office"} (o)`}
                                        onClick={() => globalStore.set(cockpitViewAtom, v)}
                                        className={cn(
                                            "cursor-pointer rounded-[4px] border-0 px-2.5 py-[3px] text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                            view === v ? "bg-surface-selected text-primary" : "bg-transparent text-muted hover:text-ink-hi"
                                        )}
                                    >
                                        {v === "cards" ? "Cards" : "Office"}
                                    </button>
                                ))}
                            </div>
    ```
14. Replace the grid's scroller
    ```tsx
                        <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-2.5">
                            <div className="flex items-start gap-2.5">
                                {columns.map((col, ci) => (
                                    <div
                                        key={ci}
                                        className="flex min-w-0 flex-1 flex-col gap-2.5"
                                        style={{ minHeight: gridViewportPx }}
                                    >
                                        <AnimatePresence initial={false}>{col.map(renderCard)}</AnimatePresence>
                                    </div>
                                ))}
                            </div>
                        </div>
    ```
    with the same block wrapped so Office takes its place:
    ```tsx
                        {view === "office" ? (
                            officeIn && (
                                <CockpitOffice
                                    agents={officeIn.agents}
                                    runs={officeIn.runs}
                                    now={structuralNow}
                                    fiveHourPct={fiveHour}
                                    cursorId={cursorId}
                                    onCursor={(key) => setCursorId(key)}
                                    renderCard={renderOfficeCard}
                                    handleRef={officeRef}
                                />
                            )
                        ) : (
                            <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-2.5">
                                <div className="flex items-start gap-2.5">
                                    {columns.map((col, ci) => (
                                        <div
                                            key={ci}
                                            className="flex min-w-0 flex-1 flex-col gap-2.5"
                                            style={{ minHeight: gridViewportPx }}
                                        >
                                            <AnimatePresence initial={false}>{col.map(renderCard)}</AnimatePresence>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
    ```
15. Change `<IdleSection agents={shownParkedIdle} onOpen={(id) => model.openTerminal(id)} />` to
    `{view === "office" ? null : <IdleSection agents={shownParkedIdle} onOpen={(id) => model.openTerminal(id)} />}`
    (in Office those agents are in the lounge).

- [ ] **Step 5: Document the keys**

In `frontend/app/store/keybindings/bindings.ts`, `buildCockpitBindings`, after
`doc("cockpit:background", "b", "Background the agent (keeps running)"),` add:

```ts
        doc("cockpit:office", "o", "Switch the Cockpit between Cards and Office"),
        doc("cockpit:office-walk", "ArrowRight", "Office: walk the boss (← ↑ ↓ →); j / k go desk by desk"),
```

In `docs/keyboard-shortcuts.md`, in the `### Cockpit` table, after the `| \`b\` | Background the agent (keeps it running) |`
row, add:

```md
| `o` | Switch the Cockpit between Cards and Office |
| `←` `↑` `↓` `→` (Office) | Walk the boss; walls stop it, doors let it through |
| `j` / `k` (Office) | The boss walks to the next / previous desk or seat |
| `n` (Office) | Show the way to the next Needs you for a second, then walk there |
| `Esc` (Office) | Hide the card beside the desk until the boss moves |
```

- [ ] **Step 6: The fixture rosters**

In `scripts/cockpit-fixtures/scenarios.mjs`, before `export const SCENARIOS`, add (4-space indent, by hand; never
prettier):

```js
// the cockpit office's canvas (docs/superpowers/specs/2026-10-15-cockpit-office-design.md): arcterm, mozox and Home,
// every agent state the plan draws. Idle past the Finished window (5 min) is the lounge: tern at the coffee, wren on
// the sofa, scratch out of Home's booth.
function office(now) {
    const said = (text) => [{ kind: "message", text }];
    return [
        { id: "fx-office-loom", name: "loom", project: "arcterm", task: "office plan model", state: "working", agent: "claude", model: "opus", activeMs: 720_000, activity: "running vitest", blockId: "fx-blk-office-loom", previousInfo: said("Laying out the bands.") },
        {
            id: "fx-office-quill", name: "quill", project: "arcterm", task: "merge the gallery", state: "asking", agent: "claude", model: "opus", blockedMs: 180_000, blockId: "fx-blk-office-quill", previousInfo: said("The branch is ready."),
            ask: {
                askId: "fx-office-quill-ask",
                oref: "block:fx-blk-office-quill",
                questions: [{ header: "Merge", question: "Merge wave/7c1e into main now, or wait for the Final shots?", options: [{ label: "Merge now" }, { label: "Wait for the Final shots" }, { label: "Show me the diff first" }] }],
            },
        },
        { id: "fx-office-sable", name: "sable", project: "arcterm", task: "sprite cache", state: "idle", agent: "codex", model: "gpt", idleSince: now - 60_000, blockId: "fx-blk-office-sable", previousInfo: said("Moved the sprite cache into view/office.") },
        { id: "fx-office-harbor", name: "harbor", project: "mozox", task: "invoice rounding", state: "working", agent: "pi", model: "pi", activeMs: 480_000, activity: "go test ./internal/billing", blockId: "fx-blk-office-harbor", previousInfo: said("Fixing the rounding.") },
        { id: "fx-office-pike", name: "pike", project: "mozox", task: "orders lint", state: "working", agent: "claude", model: "sonnet", activeMs: 1_260_000, activity: "npm run lint", blockId: "fx-blk-office-pike", previousInfo: said("Linting the routes.") },
        { id: "fx-office-tern", name: "tern", project: "mozox", task: "webhook retries", state: "idle", agent: "agy", model: "gemini", idleSince: now - 6 * 60_000, blockId: "fx-blk-office-tern", previousInfo: said("Added the retry budget.") },
        { id: "fx-office-wren", name: "wren", project: "mozox", task: "onboarding copy", state: "idle", agent: "claude", model: "sonnet", idleSince: now - 14 * 60_000, blockId: "fx-blk-office-wren", previousInfo: said("Rewrote the onboarding copy.") },
        { id: "fx-office-scratch", name: "scratch", task: "zshrc", state: "idle", agent: "claude", model: "haiku", idleSince: now - 7 * 60_000, blockId: "fx-blk-office-scratch", previousInfo: said("nvm loads lazily now.") },
    ];
}

// the cockpit office's bench: 48 agents over 6 projects, every state, 2 asking
const BENCH_PROJECTS = ["arcterm", "mozox", "thesis", "cuscofi", "notes", "infra"];
function officeBench(now) {
    const out = [];
    for (let i = 0; i < 48; i++) {
        const slot = Math.floor(i / 6);
        const base = {
            id: `fx-bench-${i}`,
            name: `bench ${String(i).padStart(2, "0")}`,
            project: BENCH_PROJECTS[i % 6],
            task: `bench task ${i}`,
            agent: ["claude", "codex", "pi", "agy"][i % 4],
            model: "sonnet",
            blockId: `fx-blk-bench-${i}`,
            previousInfo: [{ kind: "message", text: `bench agent ${i}` }],
        };
        if (slot === 0 && i < 2) {
            out.push({ ...base, state: "asking", blockedMs: 60_000, ask: { askId: `fx-bench-ask-${i}`, oref: `block:fx-blk-bench-${i}`, questions: [{ header: "Go", question: "Carry on?", options: [{ label: "Yes" }, { label: "No" }] }] } });
        } else if (slot < 4) {
            out.push({ ...base, state: "working", activeMs: 300_000, activity: "working" });
        } else if (slot === 4) {
            out.push({ ...base, state: "idle", idleSince: now - 60_000 });
        } else if (slot < 7) {
            out.push({ ...base, state: "idle", idleSince: now - 6 * 60_000 });
        } else {
            out.push({ ...base, state: "idle", idleSince: now - 12 * 60_000 });
        }
    }
    return out;
}
```

and add `office,` and `"office-bench": officeBench,` to the `SCENARIOS` object.

Run: `node scripts/cockpit-fixtures/validate.mjs` if it has a CLI, else `npx vitest run scripts/cockpit-fixtures`
Expected: both new rosters validate.

- [ ] **Step 7: The `cockpit-office` scenario** — create `scripts/cdp/cockpitofficescenarios.mjs` (4-space indent, by
hand; never prettier):

```js
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's scenarios (docs/superpowers/specs/2026-10-15-cockpit-office-design.md). cockpit-office draws
// the canvas's boards (Main, NextAsk, Night, Tired, States, RamPanel) on a fixture roster, one real run held in
// planning (its meeting room opens a real LeadCard) and fixture runs handed in through the DEV-only hooks
// (frontend/app/view/agents/cockpitofficedevhooks.ts), and drives the boss with real keys.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCENARIOS as ROSTERS } from "../cockpit-fixtures/scenarios.mjs";

export const FIXTURE = new URL("../../public/cockpit-fixtures/active.json", import.meta.url);
export const VIEW_KEY = "cockpit.view";
const KEY_CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, n: 78, o: 79, 1: 49 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fixture runs the office draws after the live ones
function devRuns(prefix, specs) {
    return specs.map(([title, project, states], r) => ({
        id: `${prefix}-${r + 1}`,
        title,
        project,
        createdTs: r + 1,
        done: false,
        leadAsking: false,
        tasks: states.map((state, t) => ({ id: `t${t + 1}`, label: `${title} task ${t + 1}`, state, asking: false })),
    }));
}
export const OFFICE_RUNS = devRuns("fx-office-run", [
    ["Canvas gallery", "arcterm", ["done", "reviewing", "running"]],
    ["Billing export", "mozox", ["done", "done", "running", "running", "stalled", "failed", "pending"]],
]);
const BENCH_STATES = ["running", "running", "running", "done", "done", "reviewing", "pending", "stalled"];
export const BENCH_RUNS = devRuns("fx-bench-run", [
    ["Bench run one", "arcterm", BENCH_STATES],
    ["Bench run two", "mozox", BENCH_STATES],
    ["Bench run three", "thesis", BENCH_STATES],
]);

// a real key on the page: keyDown, keyUp, or both
export async function key(h, k, type = "both") {
    const code = k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k;
    const base = { key: k, code, windowsVirtualKeyCode: KEY_CODES[k] };
    if (type !== "up") await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.length === 1 ? { text: k } : {}) });
    if (type !== "down") await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// holds a key for ms: the boss walks while an arrow is down
export async function hold(h, k, ms) {
    await key(h, k, "down");
    await sleep(ms);
    await key(h, k, "up");
}

export const probe = (h) => h.ev("window.__cockpitOfficeProbe ? window.__cockpitOfficeProbe() : null");
export const dev = (h, o) => h.ev(`window.__cockpitOffice(${JSON.stringify(o)})`);
export const focusCockpit = (h) => h.ev(`document.querySelector("[data-cockpit-surface]")?.focus()`);

// the office and its hooks load after a reload; null when both are there, else what is missing
export async function waitForOffice(h) {
    return h.ev(`(async () => {
        const ready = () => typeof window.__cockpitOffice === "function" && !!document.querySelector("[data-cockpit-office] [data-office-desk]");
        for (let i = 0; i < 120 && !ready(); i++) await new Promise((r) => setTimeout(r, 250));
        return ready() ? null : "after 30 s the Cockpit shows no office or its dev hooks";
    })()`);
}

// waits until the boss stands still and no path hint shows, up to ms
export async function settleBoss(h, ms = 4000) {
    for (let t = 0; t < ms; t += 100) {
        const p = await probe(h);
        if (p?.boss && !p.boss.moving && p.dots === 0) return p;
        await sleep(100);
    }
    return probe(h);
}

const desk = (id) => `[data-office-desk="${id}"]`;

// fx: { arrangeFixtureRun, teardownFixtureRun } from scenarios.mjs
export function makeCockpitOfficeScenarios(fx) {
    const cockpitOffice = {
        name: "cockpit-office",
        surface: "cockpit",
        async arrange(h) {
            const ctx = {
                cwd: mkdtempSync(join(tmpdir(), "cockpit-office-")),
                prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null,
            };
            await fx.arrangeFixtureRun(h, ctx, "cockpit-office", "office lead", { project: "arcterm" });
            // arrangeFixtureRun wrote its own roster around the run's lead: keep the lead, draw the office's roster
            const lead = JSON.parse(readFileSync(FIXTURE, "utf8")).find((a) => a.runId === ctx.runId);
            mkdirSync(new URL(".", FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify([...(lead ? [lead] : []), ...ROSTERS.office(Date.now())], null, 2));
            ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("office"))`);
            await h.ev("location.reload()");
            await sleep(500);
            await h.goto("cockpit");
            ctx.missing = await waitForOffice(h);
            if (!ctx.missing) await dev(h, { runs: OFFICE_RUNS, afterHours: false, energy: 63 });
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }

            // 1. Main: quill's card beside its desk
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.click()`);
            let p = await settleBoss(h);
            rec(
                "1. a click on quill's desk walks the boss there and opens its card beside the desk",
                p?.cursor === "fx-office-quill" && p.popup === "agent",
                JSON.stringify({ cursor: p?.cursor, popup: p?.popup, boss: p?.boss })
            );
            await h.shot("cdp-shots/cockpit-office-main.png");

            // 2. 1 answers from that card
            await focusCockpit(h);
            await key(h, "1");
            await sleep(200);
            p = await probe(h);
            rec("2. 1 picks quill's first answer from the card beside the desk", JSON.stringify(p?.answerSel?.["0"]) === "[0]", JSON.stringify(p?.answerSel));

            // 3. the real run's meeting room opens its LeadCard
            await h.ev(`[...document.querySelectorAll("[data-office-room]")].find((b) => !b.dataset.officeRoom.includes("fx-office-run"))?.click()`);
            p = await settleBoss(h);
            const runText = await h.ev(`(document.querySelector('[data-office-popup="run"]')?.textContent ?? "").length`);
            rec("3. a click on a meeting room opens its run's card", p?.popup === "run" && runText > 0, JSON.stringify({ popup: p?.popup, cursor: p?.cursor, runText }));
            await h.shot("cdp-shots/cockpit-office-run.png");

            // 4. a wall stops the boss, a door lets it through
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-loom"))})?.click()`);
            await settleBoss(h);
            await focusCockpit(h);
            await hold(h, "ArrowRight", 1500);
            const blocked = await settleBoss(h, 1000);
            await hold(h, "ArrowUp", 400);
            await hold(h, "ArrowRight", 2500);
            const through = await settleBoss(h, 1000);
            rec(
                "4. the arrows walk the boss: the room's wall stops it, its door lets it into the hall",
                blocked?.boss?.room === "room:arcterm" && through?.boss?.room === "hall",
                JSON.stringify({ blocked: blocked?.boss, through: through?.boss })
            );

            // 5. NextAsk: n shows the way, then the boss walks it
            await focusCockpit(h);
            await key(h, "n");
            await sleep(150);
            const hint = await probe(h);
            await h.shot("cdp-shots/cockpit-office-next-ask.png");
            p = await settleBoss(h, 5000);
            rec(
                "5. n shows the way to the next Needs you for a second, then the boss walks there",
                hint?.dots > 0 && p?.cursor === "fx-office-quill" && p.popup === "agent",
                JSON.stringify({ dots: hint?.dots, cursor: p?.cursor, popup: p?.popup })
            );

            // 6. lights
            p = await probe(h);
            rec(
                "6. Home's booth, where no one works, has its lights off; arcterm's room is lit",
                p?.dark?.includes("room:home") && !p.dark.includes("room:arcterm"),
                JSON.stringify(p?.dark)
            );

            // 7. Night
            await dev(h, { afterHours: true });
            await sleep(400);
            p = await probe(h);
            const gone = await h.ev(`document.querySelectorAll('[data-office-desk][data-office-pose="empty"]').length`);
            rec("7. after hours: idle people have gone home, people at work have a lamp", p?.night && p.lamps > 0 && gone > 0, JSON.stringify({ night: p?.night, lamps: p?.lamps, gone }));
            await h.shot("cdp-shots/cockpit-office-night.png");

            // 8. Tired
            await dev(h, { afterHours: false, energy: 94 });
            await sleep(400);
            p = await probe(h);
            const heading = await h.ev(`document.querySelector("[data-office-heading]")?.textContent ?? ""`);
            rec("8. the 5-hour window at 94 %: coffee on the working desks, the heading says 94 %", p?.cups > 0 && heading.includes("94"), JSON.stringify({ cups: p?.cups, heading }));
            await h.shot("cdp-shots/cockpit-office-tired.png");

            // 9. States: every sprite
            await dev(h, { energy: 63, sheet: true });
            await sleep(400);
            const sheet = await h.ev(`[...document.querySelectorAll("[data-office-sheet] img")].map((i) => (i.getAttribute("src") ?? "").length)`);
            p = await probe(h);
            rec(
                "9. every sprite draws, every colour token resolved",
                sheet.length === 18 && sheet.every((n) => n > 0) && p?.unresolved?.length === 0,
                JSON.stringify({ sheet, unresolved: p?.unresolved })
            );
            await h.shot("cdp-shots/cockpit-office-states.png");
            await dev(h, { sheet: false });

            // 10. animation off
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await sleep(700);
            const off = await probe(h);
            await h.ev("window.__cockpitOfficeAnimation(true)");
            await sleep(700);
            const on = await probe(h);
            rec(
                "10. with the animation off no clock runs; on again, the frame clock runs",
                off?.clock?.frame === false && off.clock.walk === false && on?.clock?.frame === true,
                JSON.stringify({ off: off?.clock, on: on?.clock })
            );

            return steps;
        },
        async teardown(h, ctx) {
            await fx.teardownFixtureRun(h, ctx, "cockpit-office", {
                what: "put back the view, the roster and the dev state",
                fn: async () => {
                    await h.ev("window.__cockpitOffice?.(null)");
                    await h.ev(
                        ctx.prevView == null
                            ? `localStorage.removeItem(${JSON.stringify(VIEW_KEY)})`
                            : `localStorage.setItem(${JSON.stringify(VIEW_KEY)}, ${JSON.stringify(ctx.prevView)})`
                    );
                    if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
                    rmSync(ctx.cwd, { recursive: true, force: true });
                },
            });
        },
    };
    return { cockpitOffice };
}
```

- [ ] **Step 8: List the scenario**

In `scripts/cdp/scenarios.mjs`:
1. After `import { makeOfficeScenarios } from "./officescenarios.mjs";` add
   `import { makeCockpitOfficeScenarios } from "./cockpitofficescenarios.mjs";`.
2. Directly after the statement `const { jarvisOffice, jarvisOfficeBench, jarvisOfficeFloor } = makeOfficeScenarios({ ... });`
   (it ends with `});`), add:
   `const { cockpitOffice } = makeCockpitOfficeScenarios({ arrangeFixtureRun, teardownFixtureRun });`
3. In the scenario list, after the line `    jarvisOfficeFloor,` add `    cockpitOffice,`.

- [ ] **Step 9: Typecheck, test, and try it**

Run: `node --max-old-space-size=4096 --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
Expected: exit 0.

Run: `npx vitest run frontend/app/view/agents frontend/app/view/office frontend/app/store/keybindings`
Expected: PASS (a keybinding test that lists the Cockpit's ids may need the two new ids; add them there).

Run: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs cockpit-office`
Expected: every step of `cockpit-office` PASS; open the shots under `cdp-shots/` and compare them with the canvas's
`Main`, `NextAsk`, `Night`, `Tired` and `States` boards.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/view/agents/cockpitoffice.tsx frontend/app/view/agents/cockpitofficedevhooks.ts frontend/app/view/agents/cockpitsurface.tsx frontend/app/view/agents/usecockpitkeyboard.ts frontend/app/store/keybindings/bindings.ts docs/keyboard-shortcuts.md scripts/cockpit-fixtures/scenarios.mjs scripts/cdp/cockpitofficescenarios.mjs scripts/cdp/scenarios.mjs
git commit -m "feat(cockpit): Office view: the floor plan, the boss you walk, the card beside the desk"
```

---

### Task 6: The Office line in the RAM panel, and Settings → Appearance → Office

**Depends on:** Task 5
**Files:** `frontend/app/view/agents/consumerspanel.tsx`, `frontend/app/view/agents/settingspages/appearance.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/view/agents/settingssurface.tsx`, `scripts/cdp/cockpitofficescenarios.mjs`

**Interfaces:**
- Consumes: `officeCountsAtom`, `officeMeter`, `officeClocks`, `officeDomNodes` (`officeclock.ts`);
  `spriteCacheStats` (`spritecache.ts`); `officeAnimationAtom`, `officeHoursAtom`, `officeAnimation`,
  `DEFAULT_OFFICE_ANIMATION` (`officestore.ts`); `sanitizeHours`, `DEFAULT_HOURS`, `WorkHours` (`officebehavior.ts`).
- Produces: `[data-consumers-office]` and `[data-consumers-office-toggle]` in the Consumers panel; settings rows
  `appearance.officeanimation` and `appearance.officehours`.

- [ ] **Step 1: Update the settings test first**

In `frontend/app/view/agents/settingsmodel.test.ts`, after the `expect(cards["appearance/jarvis"])...` assertion add:

```ts
        expect(cards["appearance/office"]).toEqual(["appearance.officeanimation", "appearance.officehours"]);
```

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts`
Expected: FAIL (`appearance/office` is undefined).

- [ ] **Step 2: Register the rows** — in `frontend/app/view/agents/settingsmodel.ts`, after the `jarvis` card (the
one whose last row is `appearance.petquotes`), add a card:

```ts
                {
                    id: "office",
                    label: "Office",
                    rows: [
                        {
                            id: "appearance.officeanimation",
                            title: "Office animation",
                            desc: "People in the Cockpit's Office type, walk and wave. Off, everyone holds still and the boss moves at once; the RAM panel's Office line shows what it costs.",
                            key: "cockpit.office.animation",
                            scope: "local",
                        },
                        {
                            id: "appearance.officehours",
                            title: "Work hours",
                            desc: "Outside them, and all weekend, the office dims, idle people go home and desk lamps come on.",
                            key: "cockpit.office.hours",
                            scope: "local",
                        },
                    ],
                },
```

Run the test again. Expected: PASS (if another test enumerates Appearance's cards, add `"office"` there too).

- [ ] **Step 3: Draw the rows** — in `frontend/app/view/agents/settingspages/appearance.tsx`:

1. Add imports:
   ```ts
   import { sanitizeHours, type WorkHours } from "../officebehavior";
   import { officeAnimation, officeAnimationAtom, officeHoursAtom } from "../officestore";
   ```
   and add `Select` to the `../settingsui` import.
2. After the `<SettingCard id="jarvis" label="Jarvis">…</SettingCard>` block add:
   ```tsx
               <SettingCard id="office" label="Office">
                   <OfficeAnimationRow />
                   <OfficeHoursRow />
               </SettingCard>
   ```
3. After `function PetQuotesRow() { … }` add:
   ```tsx
   function OfficeAnimationRow() {
       const [raw, setOn] = useAtom(officeAnimationAtom);
       const on = officeAnimation(raw);
       return (
           <SettingRow id="appearance.officeanimation">
               <Toggle on={on} onToggle={() => setOn(!on)} label="Office animation" />
           </SettingRow>
       );
   }

   const HOURS = Array.from({ length: 24 }, (_, h) => h);
   const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

   // two hour pickers; each offers only hours that keep the start before the end
   function OfficeHoursRow() {
       const [raw, setHours] = useAtom(officeHoursAtom);
       const hours = sanitizeHours(raw);
       const items = (pick: (h: number) => WorkHours, current: number, ok: (h: number) => boolean): ContextMenuItem[] =>
           HOURS.filter(ok).map((h) => ({
               label: hourLabel(h),
               type: "radio",
               checked: h === current,
               click: () => setHours(pick(h)),
           }));
       return (
           <SettingRow id="appearance.officehours">
               <div className="flex items-center gap-2">
                   <Select
                       value={String(hours.start)}
                       label={hourLabel(hours.start)}
                       ariaLabel="Work starts"
                       items={items((h) => ({ ...hours, start: h }), hours.start, (h) => h < hours.end)}
                   />
                   <span className="text-muted">to</span>
                   <Select
                       value={String(hours.end)}
                       label={hourLabel(hours.end)}
                       ariaLabel="Work ends"
                       items={items((h) => ({ ...hours, end: h }), hours.end, (h) => h > hours.start)}
                   />
               </div>
           </SettingRow>
       );
   }
   ```
   (`ContextMenuItem` is a global type, as `settingspages/general.tsx` uses it.)
4. Add ", the Cockpit office's animation and work hours" to the file's header comment list.

- [ ] **Step 4: Changed and revert** — in `frontend/app/view/agents/settingssurface.tsx`:

1. Add imports:
   ```ts
   import { DEFAULT_HOURS, sanitizeHours } from "./officebehavior";
   import { DEFAULT_OFFICE_ANIMATION, officeAnimation, officeAnimationAtom, officeHoursAtom } from "./officestore";
   ```
2. After `const [quotes, setQuotes] = useAtom(petQuotesOnAtom);` add:
   ```ts
       const [officeAnim, setOfficeAnim] = useAtom(officeAnimationAtom);
       const [officeHrs, setOfficeHrs] = useAtom(officeHoursAtom);
       const hrs = sanitizeHours(officeHrs);
   ```
3. After the `"appearance.petquotes": { … },` entry add:
   ```ts
           "appearance.officeanimation": {
               changed: officeAnimation(officeAnim) !== DEFAULT_OFFICE_ANIMATION,
               revert: () => setOfficeAnim(DEFAULT_OFFICE_ANIMATION),
           },
           "appearance.officehours": {
               changed: hrs.start !== DEFAULT_HOURS.start || hrs.end !== DEFAULT_HOURS.end,
               revert: () => setOfficeHrs(DEFAULT_HOURS),
           },
   ```

- [ ] **Step 5: The Office line** — in `frontend/app/view/agents/consumerspanel.tsx`:

1. Add imports (merge with existing `jotai` / `react` imports where they exist: `useAtom`, `useAtomValue`,
   `useEffect`, `useState`):
   ```ts
   import { officeClocks, officeCountsAtom, officeDomNodes, officeMeter } from "@/app/view/office/officeclock";
   import { spriteCacheStats } from "@/app/view/office/spritecache";
   import { officeAnimation, officeAnimationAtom } from "./officestore";
   ```
2. Right after `function Stat(…) { … }` add:
   ```tsx
   // The office's own cost while the Cockpit shows Office (cockpit office spec, "Its cost in the RAM panel"): its JS
   // time, the people it draws, its sprite images and its DOM nodes, read once a second while the panel is open. No
   // heap figure: WKWebView has no performance.memory, and Interface above already holds the whole webview.
   const OFFICE_JS_TIP =
       "The office's own JavaScript per second, as a share of one core. It leaves out the browser's layout and paint: for the whole webview, watch Interface where the panel reads its CPU, or arcterm's WebKit process in Activity Monitor with the animation on, then off.";

   function officeCost() {
       const s = spriteCacheStats("plan");
       const c = officeClocks();
       return {
           js: officeMeter.share(Date.now()),
           entries: s.entries,
           kb: Math.round(s.bytes / 1024),
           nodes: officeDomNodes(),
           running: c.frame || c.walk,
       };
   }

   function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
       return (
           <div title={title} className="flex min-w-0 flex-col">
               <span className="text-[10.5px] text-ink-faint">{label}</span>
               <span className="text-[12px] tabular-nums text-secondary">{value}</span>
           </div>
       );
   }

   function OfficeLine() {
       const counts = useAtomValue(officeCountsAtom);
       const [raw, setAnim] = useAtom(officeAnimationAtom);
       const on = officeAnimation(raw);
       const [cost, setCost] = useState(officeCost);
       const mounted = counts != null;
       useEffect(() => {
           if (!mounted) {
               return;
           }
           setCost(officeCost());
           const id = window.setInterval(() => setCost(officeCost()), 1000);
           return () => window.clearInterval(id);
       }, [mounted]);
       if (counts == null) {
           return null;
       }
       const state = !on
           ? "animation off · everyone holds still"
           : cost.running
             ? `animating · ${counts.walking} walking · ${counts.animated} at work`
             : "still · nothing moves";
       return (
           <div data-consumers-office className="flex flex-col gap-1.5 border-t border-border pt-2">
               <div className="flex items-center gap-2">
                   <span className="text-[10.5px] text-ink-faint">Office</span>
                   <span className={cn("size-1.5 rounded-full", on && cost.running ? "bg-working" : "bg-edge-strong")} />
                   <span className="min-w-0 flex-1 truncate text-[11.5px] text-secondary">{state}</span>
                   <button type="button" data-consumers-office-toggle onClick={() => setAnim(!on)} className={TEXT_ACTION}>
                       {on ? "Turn animation off" : "Turn animation on"}
                   </button>
               </div>
               <div className="grid grid-cols-4 gap-2">
                   <Figure label="Office JS" value={`${cost.js} %`} title={OFFICE_JS_TIP} />
                   <Figure label="People" value={String(counts.people)} />
                   <Figure label="Images" value={`${cost.entries} · ${cost.kb} KB`} />
                   <Figure label="DOM nodes" value={cost.nodes.toLocaleString()} />
               </div>
           </div>
       );
   }
   ```
3. In the full panel's arcterm block, change
   ```tsx
                                   {(view?.own ?? []).map((o) => (
                                       <Stat key={o.label} data-consumers-own={o.label} label={o.label} bytes={o.bytes} />
                                   ))}
                               </div>
   ```
   to the same followed by `<OfficeLine />` on its own line before the block's closing `</div>`.
4. In `CompactOwn`, wrap what it returns in a fragment and add `<div className="px-3 pb-1.5"><OfficeLine /></div>`
   after the existing line.

- [ ] **Step 6: The RamPanel step** — in `scripts/cdp/cockpitofficescenarios.mjs`, in `cockpitOffice.assert`, right
before the final `return steps;`, add:

```js
            // 11. RamPanel: the office's cost, and its button
            await h.ev(`document.querySelector("[data-worker-capacity]")?.click()`);
            await sleep(1500);
            const line = await h.ev(`document.querySelector("[data-consumers-office]")?.textContent ?? ""`);
            await h.shot("cdp-shots/cockpit-office-ram.png");
            await h.ev(`document.querySelector("[data-consumers-office-toggle]")?.click()`);
            await sleep(700);
            const offLine = await h.ev(`document.querySelector("[data-consumers-office]")?.textContent ?? ""`);
            const stopped = await probe(h);
            await h.ev(`document.querySelector("[data-consumers-office-toggle]")?.click()`);
            await h.ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
            rec(
                "11. the RAM panel shows the office's JS, people, images and nodes, and its button stops every clock",
                ["Office JS", "People", "Images", "DOM nodes"].every((w) => line.includes(w)) &&
                    offLine.includes("animation off") &&
                    stopped?.clock?.frame === false,
                JSON.stringify({ line, offLine, clock: stopped?.clock })
            );
```

- [ ] **Step 7: Typecheck, test, try it**

Run: `node --max-old-space-size=4096 --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
Expected: exit 0.

Run: `npx vitest run frontend/app/view/agents`
Expected: PASS.

Run: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs cockpit-office`
Expected: every step PASS, step 11 included; compare `cdp-shots/cockpit-office-ram.png` with the `RamPanel` board.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/view/agents/consumerspanel.tsx frontend/app/view/agents/settingspages/appearance.tsx frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingsmodel.test.ts frontend/app/view/agents/settingssurface.tsx scripts/cdp/cockpitofficescenarios.mjs
git commit -m "feat(cockpit): the office's cost in the RAM panel, and Settings → Appearance → Office"
```

---

### Task 7: The bench, the guide, What's new, RAM watch

**Depends on:** Task 6
**Files:** `scripts/cdp/officescenarios.mjs`, `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cdp/scenarios.mjs`, `docs/guide/cockpit.md`, `CHANGELOG.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: `metrics`, `sleep`, `HOLD_MS`, `busyPct`, `round1`, `mb` (exported from `officescenarios.mjs` in step 1);
  `BENCH_RUNS`, `FIXTURE`, `VIEW_KEY`, `probe`, `dev`, `waitForOffice` (Task 5).
- Produces: the `cockpit-office-bench` scenario, listed in `scenarios.mjs`.

- [ ] **Step 1: Share the bench helpers** — in `scripts/cdp/officescenarios.mjs`, put `export` before
`async function metrics(h)`, `const sleep =`, `const HOLD_MS =`, `const busyPct =`, `const round1 =` and `const mb =`
(nothing else changes).

- [ ] **Step 2: The bench scenario** — in `scripts/cdp/cockpitofficescenarios.mjs`:

1. Add the import: `import { busyPct, HOLD_MS, mb, metrics, round1 } from "./officescenarios.mjs";`
2. Inside `makeCockpitOfficeScenarios`, before `return { cockpitOffice };`, add:

```js
    // the spec's Benchmark: Cards then Office on the office-bench roster plus three fixture runs (~75 people)
    const cockpitOfficeBench = {
        name: "cockpit-office-bench",
        surface: "cockpit",
        async arrange(h) {
            const ctx = { prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null };
            mkdirSync(new URL(".", FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify(ROSTERS["office-bench"](Date.now()), null, 2));
            ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("cards"))`);
            await h.ev("location.reload()");
            await sleep(500);
            await h.goto("cockpit");
            ctx.missing = await h.ev(`(async () => {
                for (let i = 0; i < 120 && !(document.querySelector("[data-cockpit-view-toggle]") && window.__cockpitOffice); i++) await new Promise((r) => setTimeout(r, 250));
                return document.querySelector("[data-cockpit-view-toggle]") && window.__cockpitOffice ? null : "after 30 s the Cockpit has no view toggle or dev hooks";
            })()`);
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the Cockpit loads", false, ctx.missing);
                return steps;
            }
            const r = {};
            const cards = await metrics(h);
            await sleep(HOLD_MS);
            const cardsHold = await metrics(h);
            r.baseBusyPct = round1(busyPct(cards, cardsHold));

            await dev(h, { runs: BENCH_RUNS });
            r.openMs = Math.round(
                await h.ev(`(async () => {
                    const t0 = performance.now();
                    [...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === "Office")?.click();
                    for (let i = 0; i < 600 && !document.querySelector("[data-office-desk]"); i++) await new Promise((r) => requestAnimationFrame(r));
                    return performance.now() - t0;
                })()`)
            );
            await sleep(2000);
            const open = await metrics(h);
            r.heapOpenMB = mb(open.heap - cardsHold.heap);
            r.nodesAdded = open.nodes - cardsHold.nodes;

            await dev(h, { patrol: true, walkers: 3 });
            await sleep(1000);
            const walk0 = await metrics(h);
            await sleep(HOLD_MS);
            const walk1 = await metrics(h);
            r.busyRawPct = round1(busyPct(walk0, walk1));
            r.busyPct = round1(r.busyRawPct - r.baseBusyPct);

            await dev(h, { patrol: false, walkers: 0, quiet: true });
            await sleep(1500);
            const quiet0 = await metrics(h);
            await sleep(HOLD_MS);
            const quiet1 = await metrics(h);
            r.busyQuietPct = round1(busyPct(quiet0, quiet1) - r.baseBusyPct);
            r.clockQuiet = (await probe(h))?.clock;

            await h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
            await dev(h, { quiet: false, patrol: true, walkers: 3 });
            await sleep(1000);
            const red0 = await metrics(h);
            await sleep(HOLD_MS);
            const red1 = await metrics(h);
            r.busyReducedPct = round1(busyPct(red0, red1) - r.baseBusyPct);
            await h.cdp("Emulation.setEmulatedMedia", { features: [] });
            await dev(h, { patrol: false, walkers: 0 });

            const p = await probe(h);
            r.people = p?.people;
            r.cache = p?.cache?.entries;

            await h.ev(`[...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === "Cards")?.click()`);
            await sleep(2000);
            const closed = await metrics(h);
            r.heapAfterMB = mb(closed.heap - cardsHold.heap);

            rec("0. the bench drew about 75 people", r.people >= 70, `${r.people} people`);
            rec("1. JS heap, Office minus Cards <= 5 MB", r.heapOpenMB <= 5, `${r.heapOpenMB} MB`);
            rec("2. DOM nodes added <= 2,000", r.nodesAdded <= 2000, `${r.nodesAdded}`);
            rec("3. main thread busy walking, over the Cards baseline <= 2 %", r.busyPct <= 2, `${r.busyPct} % (${r.busyRawPct} % raw, baseline ${r.baseBusyPct} %)`);
            rec("4. busy under reduced motion <= 0.5 %", r.busyReducedPct <= 0.5, `${r.busyReducedPct} %`);
            rec("5. busy in a quiet office <= 0.3 %, no clock running", r.busyQuietPct <= 0.3 && r.clockQuiet?.frame === false && r.clockQuiet?.walk === false, `${r.busyQuietPct} % ${JSON.stringify(r.clockQuiet)}`);
            rec("6. sprite cache <= 600 entries", r.cache <= 600, `${r.cache}`);
            rec("7. heap after switching back to Cards <= 1 MB over Cards", r.heapAfterMB <= 1, `${r.heapAfterMB} MB`);
            rec("8. toggle click to the office drawn <= 150 ms", r.openMs <= 150, `${r.openMs} ms`);
            console.log(`[cockpit-office-bench] ${JSON.stringify(r)}`);
            return steps;
        },
        async teardown(h, ctx) {
            await h.ev("window.__cockpitOffice?.(null)");
            await h.cdp("Emulation.setEmulatedMedia", { features: [] });
            await h.ev(
                ctx.prevView == null
                    ? `localStorage.removeItem(${JSON.stringify(VIEW_KEY)})`
                    : `localStorage.setItem(${JSON.stringify(VIEW_KEY)}, ${JSON.stringify(ctx.prevView)})`
            );
            if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
            else rmSync(FIXTURE, { force: true });
            await h.ev("location.reload()");
            await sleep(1500);
        },
    };
```

3. Change `return { cockpitOffice };` to `return { cockpitOffice, cockpitOfficeBench };`.

In `scripts/cdp/scenarios.mjs`, change `const { cockpitOffice } = makeCockpitOfficeScenarios(` to
`const { cockpitOffice, cockpitOfficeBench } = makeCockpitOfficeScenarios(`, and add `    cockpitOfficeBench,` after
`    cockpitOffice,` in the list.

- [ ] **Step 3: Run the bench**

Run: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs cockpit-office-bench`
Expected: the eight budget rows print with their numbers. Keep the `[cockpit-office-bench] {…}` line from the output.
If a row fails, find what costs (the Run office's RAM watch entry in `docs/open-issues.md` lists what moved its
numbers: a GPU canvas, a new callback per render redrawing every desk, a tick re-rendering whole desks) and fix that;
never raise a budget.

- [ ] **Step 4: RAM watch** — in `docs/open-issues.md`, under `### (arcterm) RAM watch`, after the Run office bullet,
add one bullet with the numbers from step 3:

```md
- **Cockpit office** (<today's date>, `cockpit-office-bench`, <people> people, dev app in headless Chrome on the Mac):
  heap +<heapOpenMB> MB, +<nodesAdded> DOM nodes, busy <busyPct> % over Cards while the boss and three walkers walk
  (<busyRawPct> % raw, baseline <baseBusyPct> %), <busyReducedPct> % under reduced motion, <busyQuietPct> % in a
  quiet office, <cache> sprites, +<heapAfterMB> MB after back to Cards, <openMs> ms to draw. Budgets: 5 MB, 2,000,
  2 %, 0.5 %, 0.3 %, 600, 1 MB, 150 ms: <all held | which missed, and by how much>. Busy is to be read again on a
  production build with the RAM panel's Office line (React's dev build adds a performance.measure per render).
```

- [ ] **Step 5: The guide** — in `docs/guide/cockpit.md`, right before the `## Làm thế nào…` heading, add:

```md
### Văn phòng (Office)

Nút **Cards | Office** cạnh **Live only** (hoặc phím `o`) đổi lưới thẻ thành một văn phòng nhìn từ trên cao. Văn
phòng vẽ đúng các agent và run của lưới, theo cùng tab, project và **Live only**; chỉ khác cách vẽ. Agent idle quá
Finished window (mục **Idle** dưới lưới) ngồi ở phòng chờ, nên trong Office mục Idle không hiện nữa.

- **Mỗi project là một dải**: bên trái là phòng của các agent (mỗi agent một bàn, quay mặt ra phía bạn), bên phải
  mỗi run một phòng họp, lead ngồi đầu bàn, worker ngồi quanh, màn hình trên tường là DAG của run. **Sảnh** ở giữa có
  phòng chờ (TV, sofa, máy cà phê): agent idle quá Finished window ra máy cà phê, sau 10 phút thì lên sofa. Agent
  không có project ngồi ở phòng **Home** cạnh cửa vào.
- **Chỉ thứ cần bạn mới nổi**: dưới bàn là tên agent; chữ trạng thái chỉ hiện **Needs you** (vàng, kèm dấu `!`) và
  **done**. Phòng không ai làm thì tắt đèn. Rê chuột lên bàn để xem trạng thái đầy đủ.
- **Bạn là sếp**: `←` `↑` `↓` `→` để đi (tường chặn, cửa đi qua được), `j` / `k` tới bàn kế, `n` hiện lối đi chấm
  chấm tới câu hỏi kế tiếp trong một giây rồi đi tới đó. Đứng ở bàn nào thì thẻ của agent đó, đúng thẻ của lưới, mở
  cạnh bàn: `1`–`9` trả lời, `r` nhắn, `t` mở terminal, `b` đẩy xuống nền. Bấm vào bàn hay phòng họp cũng được.
  `Esc` ẩn thẻ cho tới khi sếp đi tiếp.
- **Giờ làm và năng lượng**: ngoài giờ làm (mặc định 9–18, và cả cuối tuần) văn phòng tối lại, ai idle đã về nhà, ai
  còn làm có đèn bàn. Quota 5 giờ từ 70 % thì có người ngáp, từ 90 % thì có cà phê trên bàn; quota reset thì mọi
  người vươn vai.
- **Settings → Appearance → Office** tắt animation và đổi giờ làm. Văn phòng tốn bao nhiêu thì xem ở **panel
  Consumers** (bấm chip RAM): dòng **Office** cho biết JS của văn phòng, số người, ảnh sprite và DOM node, kèm nút tắt
  animation.
```

- [ ] **Step 6: What's new** — in `CHANGELOG.md`, under the top section (`## Unreleased`; if the top section has a
date, open a new `## Unreleased` above it), as the first line under `### Added`:

```md
- **The Cockpit as an office**: press `o`, or Office beside Live only, to see your agents as a floor plan: a room per
  project, a glass meeting room per run, idle agents in the lounge, the lights off where no one works. Walk the boss
  with the arrow keys; `n` shows the way to the next Needs you; the card of the desk you stand at opens beside it. Its
  cost shows in the RAM panel, and Settings → Appearance → Office turns the animation off. <!-- big -->
```

Count the `<!-- big -->` lines in that section first: at most 5 are allowed (`whatsnew.test.ts`); if five are there
already, leave this line without it.

Run: `npx vitest run frontend/app/cockpit -t whatsnew` (or the file `whatsnew.test.ts` wherever it lives)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/cdp/officescenarios.mjs scripts/cdp/cockpitofficescenarios.mjs scripts/cdp/scenarios.mjs docs/guide/cockpit.md CHANGELOG.md docs/open-issues.md
git commit -m "feat(cockpit): office bench within its budgets, the guide, What's new and RAM watch"
```
