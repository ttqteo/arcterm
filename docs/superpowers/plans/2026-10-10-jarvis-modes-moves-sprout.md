# Jarvis modes, phases 1–2 (Moves + Sprout everywhere) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click folds the window into Sprout from Full or Float, right where Sprout stood, and Restore returns to the
size it came from; Sprout walks a ledge in Float, a dot switcher picks the floated agent, the folded Sprout lists every
agent, and in Float and folded Sprout's bubbles replace the toasts.

**Architecture:** A new pure size model (`windowsize.ts`) says which size a move lands in, what minimize does, and where
a fold starts and an unfold grows from. `floatstore.ts` keeps making the window calls, all through the existing serial
queue: `foldToSprout()` (from Full or Float) measures the walking sprite (`[data-pet-sprite]`), scales the content
(`[data-window-content]`) into it with `motion`'s `animate`, hides the shell, then shrinks the window to a 64 px box
around a 48 px Sprout on the same pixels; `restoreFromSprout(model, agentId?)` gives the origin frame back with the
shell still hidden, then grows the content out of Sprout. Float gains a 52 px ledge (`float-ledge.tsx`) that holds the
walking Sprout, and `routeNotify` sends Float's and the fold's notices to Sprout.

**Tech Stack:** React 19, jotai, motion/react 12, Tailwind 4, Tauri 2 (`@tauri-apps/api/window`), Rust + objc2-app-kit
0.3.2 (macOS), Go (wconfig), vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-jarvis-modes-design.md` (sections 1 and 2, phases 1 and 2). Mockup:
`.superpowers/design/jarvis-modes/project/Main.dc.html` (interactive), `Fold.dc.html`, `Float.dc.html`,
`Mini-Hover.dc.html`.

## Global Constraints

- One Sprout, **48 px (3 px a cell, `PET_CELL_PX`)** in every size. The folded window's Sprout box is **64 px**: the
  sprite sits **8 px** inside it (room for the 4 px bob and the count chip).
- Fold animation: the content scales and fades into Sprout's spot in **300 ms** on `MOTION.easeFluid`
  (`[0.22, 1, 0.36, 1]`), opacity and scale only, through `motion/react` (DESIGN.md: motion/react only). Restore grows the
  window first, then scales the content out of Sprout. `prefers-reduced-motion: reduce` skips both.
- `window:minimize`: `"sprout"` (default; unset or anything but `"dock"` reads as `"sprout"`) folds into Sprout,
  `"dock"` sends the window to the Dock or taskbar. Settings → General → **Window** → **Minimize**. On macOS the yellow
  button and `⌘M` are redirected whenever the setting is `"sprout"`, in every size. The Sprout buttons fold either way.
- Moves: Full → Sprout and Float → Sprout in one click (the **Sprout** button, minimize, the yellow light, `⌘M`); Full ↔
  Float with `Shift+F` and the Float button as today; Sprout → back by double-click or **Restore**, to the size it was
  folded from, at the same frame. No new key.
- The fold starts where Sprout stands in the window (the footer in Full, the ledge in Float); no "last dropped" spot is
  kept: the `arc.float.mini.v2` localStorage key is dropped.
- Float's ledge is **52 px** and holds the whole sprite; terminal avoidance (`avoidSpans`) does not apply on it.
- The folded hover list shows up to **4** agents, then `+N`, then **Restore**. A click on an agent restores to Float on
  that agent.
- Nothing in the folded window draws a drop shadow, a ground shadow or a tooltip (`title`).
- Kept from the first fold: one window; the shell stays mounted under `display:none` while folded, and the window has its
  frame back before the shell shows, so the terminal never refits; the transparent window; the cursor poll; every fold
  window call through `miniOps` (`serialqueue.ts`); points on macOS (`floatwindow.ts toSpace`).
- Colors only from `@theme` tokens (`frontend/tailwindsetup.css`); never raw hex/rgba in components.
- Generated files are never hand-edited: change `pkg/wconfig/settingsconfig.go`, then `task generate`.
- Commits carry no Co-Authored-By or other attribution trailer.
- On this 8 GB Mac, prefix `task check:ts` and builds with `NODE_OPTIONS=--max-old-space-size=4096`; cargo lives in
  `/opt/homebrew/opt/rustup/bin` (prefix `PATH=/opt/homebrew/opt/rustup/bin:$PATH`).

## Review Focus

1. **`Shift+F` (or the Float button) while folded from Full** must do nothing: a float there would shrink a window whose
   shell is hidden. Pinned in Task 1 (`move(sprout, "toggle-float")` keeps the fold) and Task 2 (`enterFloat` guards on it).
2. **A route that switches the surface while folded** (Open on a waiting item in the chat, `wsh ui` showing a surface)
   must bring the window back (folded from Full) or end the float (folded from Float), not change a hidden shell.
   Pinned in Task 1 (`onSurfaceChange`) and wired in Task 2.
3. **A fold with no walking Sprout to measure, or with Sprout near a screen edge or on a second monitor**: falls back to
   the content's bottom-right corner, is pulled on screen, lands on that monitor. Pinned in Task 1 (`foldSpot` tests).
4. **Restore after Sprout was dragged to another monitor**: the window returns to its own frame and the content grows
   from a point inside the window, never from off screen. Pinned in Task 1 (`unfoldCenter` clamp).
5. **Folded with another app in front, the floated agent asks**: Sprout must still say it. Neither "viewing" in
   `routeNotify` nor the ask gate may treat the hidden terminal as in view. Pinned in Task 8.

## Before you start

- [ ] **Set up the worktree** (the main checkout holds other agents' uncommitted work; build and work in the clean one).

```bash
git -C ~/Workspaces/dev/arcterm add docs/superpowers/plans/2026-10-10-jarvis-modes-moves-sprout.md
git -C ~/Workspaces/dev/arcterm commit -m "docs: plan for jarvis modes phases 1-2 (moves, Sprout everywhere)" -- docs/superpowers/plans/2026-10-10-jarvis-modes-moves-sprout.md
cd ~/Workspaces/dev/arcterm/.worktrees/float-mini-sprout
git status --short            # expect nothing
git merge --ff-only main
git switch -c jarvis-modes
```

All paths below are relative to that worktree.

- [ ] **Know the overlap.** Another agent has uncommitted work in the main checkout (a pet character option, Sprout or
  Minion: `petcharacter.ts`, `petsprite.ts`, and edits to `sprout-mini.tsx`, `float-bar.tsx`, `app-bar.tsx`,
  `petview.tsx`, `petfloat*.ts`, `petfloatmark.tsx`, `petstore.ts`, `settingsmodel*.ts`, `scenarios.mjs`). This plan is
  written against committed `main`. If that work lands first, Task 11 merges `main` in and threads it through: every
  `spriteFor(...)` call gains `petCharacter(useAtomValue(petCharacterAtom))` as its fourth argument, the button labels
  say `PET_CHARACTER_NAME[character]` where they say "Sprout", and the deleted `petfloat.ts` / `petfloatmark.tsx` stay
  deleted.

## File structure

| File | Role |
|---|---|
| `frontend/app/view/agents/windowsize.ts` *new* (+ test) | Pure: sizes, moves, minimize, fold spot and centres |
| `frontend/app/view/agents/floatwindow.ts` (+ test) | Folded box 64 px with an 8 px inset, rest size, `MiniRestore` with its origin |
| `frontend/app/view/agents/floatstore.ts` | `foldToSprout`, `restoreFromSprout`, the fold animation, `minimizeRequested`, reload recovery |
| `frontend/app/view/agents/macwindow.ts`, `src-tauri/src/macwindow.rs`, `src-tauri/Cargo.toml` | The redirect follows the setting; `⌘M`'s menu item redirected too; event `window-minimize` |
| `frontend/app/cockpit/cockpit-root.tsx` | `data-window-content`, the float ledge, `PetView` in every size |
| `frontend/app/cockpit/app-bar.tsx` | The **Sprout** button, `useFoldTitle`, minimize through `minimizeRequested` |
| `frontend/app/cockpit/float-bar.tsx` | **Sprout** button, agent switcher, the still mark removed |
| `frontend/app/cockpit/float-ledge.tsx` *new* | The 52 px ledge |
| `frontend/app/view/jarvis/petledge.ts` (+ test) | A ledge that holds the sprite |
| `frontend/app/view/jarvis/petview.tsx` | `data-pet-sprite`, no bubble or peek while folded, the count chip in Float, `useWaitingCount`, bubble helpers |
| `frontend/app/view/jarvis/petbubble.tsx` | `placement` and `flat` for the folded bubble |
| `frontend/app/view/agents/sproutroster.ts` *new* (+ test) | Pure: the switcher's dots and the folded list |
| `frontend/app/cockpit/sprout-mini.tsx` | 48 px, the agent list, the pet's bubble, no ground shadow |
| `frontend/app/view/agents/miniclickthrough.ts` | Hover holds over the list |
| `frontend/app/view/agents/notifyevents.ts` (+ test), `notifysync.tsx` | Route by size; a finished turn as Sprout's bubble |
| `frontend/app/view/jarvis/petjoin.ts` (+ test), `petsources.tsx` | Ask gate speaks while folded |
| `pkg/wconfig/settingsconfig.go`, `pkg/wconfig/defaultconfig/settings.json` | `window:minimize` |
| `frontend/app/view/agents/settingsmodel.ts` (+ test), `settingspages/general.tsx` | The Window card |
| Deleted: `frontend/app/view/jarvis/petfloatmark.tsx`, `petfloat.ts`, `petfloat.test.ts` | Float's still mark |
| `scripts/cdp/scenarios.mjs` | `jarvis-modes`; `float-mini`'s rest size |
| Docs: `docs/guide/agent.md`, `docs/guide/cockpit.md`, `docs/guide/settings.md`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md` | |

---

## Phase 1: Moves

### Task 1: The size model

**Files:**
- Create: `frontend/app/view/agents/windowsize.ts`
- Create: `frontend/app/view/agents/windowsize.test.ts`
- Modify: `frontend/app/view/agents/floatwindow.ts` (the "Float folded into Sprout" block, lines ~105–199)
- Modify: `frontend/app/view/agents/floatwindow.test.ts` (`miniSproutRect`, `miniWindowRect`, `sproutFromWindow`,
  `parseMiniRestore` blocks)

**Interfaces:**
- Produces (windowsize.ts): `type WindowSize = "full" | "float" | "sprout"`, `type FoldOrigin = "full" | "float"`,
  `interface SizeState { size: WindowSize; origin: FoldOrigin | null }`, `type Move = "fold" | "restore" |
  "toggle-float" | "open-agent"`, `windowSize(floating, folded): WindowSize`, `sizeState(floating, folded, origin):
  SizeState`, `move(s, m): SizeState`, `onSurfaceChange(s, surface: string): "exit-float" | "restore" | null`,
  `type MinimizeChoice = "sprout" | "dock"`, `minimizeChoice(raw: unknown): MinimizeChoice`, `minimizeAction(choice,
  size): "fold" | "dock" | null`, `interface Pt { x; y }`, `interface Viewport { width; height }`,
  `FOLD_FALLBACK_MARGIN = 24`, `FOLD_MS = 300`, `FOLD_SCALE = 0.04`, `foldCenter(sprite: Pt | null, viewport): Pt`,
  `foldSpot(inner: Pt, scale, sprite: Pt | null, viewport): WinRect`, `unfoldCenter(sprout: WinRect, frame: Pt, scale,
  viewport): Pt`.
- Produces (floatwindow.ts): `MINI_SPROUT_BOX = 64`, `MINI_SPRITE_INSET = 8`, `MINI_REST_SIZE = { width: 320, height:
  232 }`, `interface MiniRestore { origin: FoldOrigin; rect: WinRect; maximized: boolean; fullscreen: boolean; pinned:
  boolean }`, `parseMiniRestore(raw): MiniRestore | null`, `miniSproutRect(spot, work, scale)` (parameter renamed).

- [ ] **Step 1: Write the failing tests for the size model**

Create `frontend/app/view/agents/windowsize.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PET_PX } from "@/app/view/jarvis/petsprite";
import { describe, expect, it } from "vitest";
import { MINI_SPRITE_INSET, MINI_SPROUT_BOX, miniSproutRect, screenFor } from "./floatwindow";
import {
    FOLD_FALLBACK_MARGIN,
    foldCenter,
    foldSpot,
    minimizeAction,
    minimizeChoice,
    move,
    onSurfaceChange,
    sizeState,
    unfoldCenter,
    windowSize,
    type SizeState,
} from "./windowsize";

const full: SizeState = { size: "full", origin: null };
const float: SizeState = { size: "float", origin: null };
const foldedFromFull: SizeState = { size: "sprout", origin: "full" };
const foldedFromFloat: SizeState = { size: "sprout", origin: "float" };

describe("move", () => {
    it("folds Full into Sprout, keeping where it came from", () => expect(move(full, "fold")).toEqual(foldedFromFull));
    it("folds Float into Sprout, keeping where it came from", () =>
        expect(move(float, "fold")).toEqual(foldedFromFloat));
    it("restores to the size it was folded from", () => {
        expect(move(foldedFromFull, "restore")).toEqual(full);
        expect(move(foldedFromFloat, "restore")).toEqual(float);
    });
    it("toggles Full and Float", () => {
        expect(move(full, "toggle-float")).toEqual(float);
        expect(move(float, "toggle-float")).toEqual(full);
    });
    it("floats on an agent picked in the folded list, from either origin", () => {
        expect(move(foldedFromFull, "open-agent")).toEqual(float);
        expect(move(foldedFromFloat, "open-agent")).toEqual(float);
    });
    // folded, the shell is hidden: Shift+F there would shrink a window with nothing in it
    it("keeps the fold, and its origin, through Shift+F and a second fold", () => {
        expect(move(foldedFromFull, "toggle-float")).toEqual(foldedFromFull);
        expect(move(foldedFromFloat, "toggle-float")).toEqual(foldedFromFloat);
        expect(move(foldedFromFloat, "fold")).toEqual(foldedFromFloat);
    });
    it("leaves Full and Float alone on a restore or an agent pick", () => {
        for (const s of [full, float]) {
            expect(move(s, "restore")).toEqual(s);
            expect(move(s, "open-agent")).toEqual(s);
        }
    });
});

describe("sizeState and windowSize", () => {
    it("reads the size from the atoms", () => {
        expect(sizeState(false, false, null)).toEqual(full);
        expect(sizeState(true, false, null)).toEqual(float);
        expect(sizeState(false, true, "full")).toEqual(foldedFromFull);
        expect(sizeState(true, true, "float")).toEqual(foldedFromFloat);
    });
    it("reads a fold whose origin was lost from the float mode it still has", () => {
        expect(sizeState(true, true, null)).toEqual(foldedFromFloat);
        expect(sizeState(false, true, null)).toEqual(foldedFromFull);
    });
    it("names the size", () => {
        expect(windowSize(false, false)).toBe("full");
        expect(windowSize(true, false)).toBe("float");
        expect(windowSize(true, true)).toBe("sprout");
        expect(windowSize(false, true)).toBe("sprout");
    });
});

describe("onSurfaceChange", () => {
    it("ends a float that left the Agent surface", () => {
        expect(onSurfaceChange(float, "cockpit")).toBe("exit-float");
        expect(onSurfaceChange(float, "agent")).toBeNull();
    });
    // Open on a waiting item in the folded chat, or `wsh ui` showing a surface: the window comes back to show it
    it("gives the window back when a route switches the surface while folded from Full", () =>
        expect(onSurfaceChange(foldedFromFull, "jarvis")).toBe("restore"));
    it("ends the float under a fold from Float when the surface leaves Agent", () => {
        expect(onSurfaceChange(foldedFromFloat, "cockpit")).toBe("exit-float");
        expect(onSurfaceChange(foldedFromFloat, "agent")).toBeNull();
    });
    it("leaves Full alone", () => expect(onSurfaceChange(full, "usage")).toBeNull());
});

describe("minimize", () => {
    it("folds into Sprout unless window:minimize says dock", () => {
        expect(minimizeChoice(undefined)).toBe("sprout");
        expect(minimizeChoice("sprout")).toBe("sprout");
        expect(minimizeChoice("Dock")).toBe("sprout");
        expect(minimizeChoice(42)).toBe("sprout");
        expect(minimizeChoice("dock")).toBe("dock");
    });
    it("folds from Full and Float, docks when asked, and does nothing folded", () => {
        expect(minimizeAction("sprout", "full")).toBe("fold");
        expect(minimizeAction("sprout", "float")).toBe("fold");
        expect(minimizeAction("dock", "full")).toBe("dock");
        expect(minimizeAction("dock", "float")).toBe("dock");
        expect(minimizeAction("sprout", "sprout")).toBeNull();
        expect(minimizeAction("dock", "sprout")).toBeNull();
    });
});

const viewport = { width: 1440, height: 875 };

describe("foldSpot", () => {
    // Windows: physical pixels at 1.5x, the window's content at (100, 40)
    it("puts the folded sprite on the pixels the walking one stood on, from Full", () => {
        const spot = foldSpot({ x: 100, y: 40 }, 1.5, { x: 860, y: 818 }, viewport);
        expect(spot).toEqual({
            x: 100 + (860 - MINI_SPRITE_INSET) * 1.5,
            y: 40 + (818 - MINI_SPRITE_INSET) * 1.5,
            width: MINI_SPROUT_BOX * 1.5,
            height: MINI_SPROUT_BOX * 1.5,
        });
        expect(spot.x + MINI_SPRITE_INSET * 1.5).toBe(100 + 860 * 1.5);
    });
    // macOS: points, so the scale is 1 whatever the monitor's
    it("works in points from Float's ledge", () => {
        expect(foldSpot({ x: 700, y: 380 }, 1, { x: 600, y: 410 }, { width: 720, height: 460 })).toEqual({
            x: 700 + 600 - 8,
            y: 380 + 410 - 8,
            width: 64,
            height: 64,
        });
    });
    it("falls back to the content's bottom-right corner when no Sprout is drawn", () => {
        const spot = foldSpot({ x: 0, y: 0 }, 1, null, viewport);
        expect(spot.x + MINI_SPRITE_INSET).toBe(viewport.width - PET_PX - FOLD_FALLBACK_MARGIN);
        expect(spot.y + MINI_SPRITE_INSET).toBe(viewport.height - PET_PX - FOLD_FALLBACK_MARGIN);
    });
    it("lands on the monitor the window is on, a second one included", () => {
        const laptop = { area: { x: 0, y: 25, width: 1440, height: 875 }, scale: 1 };
        const side = { area: { x: 1440, y: 0, width: 1920, height: 1080 }, scale: 1 };
        const spot = foldSpot({ x: 1600, y: 100 }, 1, { x: 900, y: 700 }, { width: 1200, height: 800 });
        expect(screenFor(spot, [laptop, side], laptop)).toBe(side);
    });
    it("is pulled on screen when the walking Sprout stood past the screen's edge", () => {
        const work = { x: 0, y: 25, width: 1440, height: 875 };
        const r = miniSproutRect(foldSpot({ x: 1000, y: 500 }, 1, { x: 900, y: 600 }, viewport), work, 1);
        expect(r.x + r.width).toBeLessThanOrEqual(work.x + work.width);
        expect(r.y + r.height).toBeLessThanOrEqual(work.y + work.height);
    });
});

describe("foldCenter", () => {
    it("is the middle of the walking sprite", () =>
        expect(foldCenter({ x: 860, y: 818 }, viewport)).toEqual({ x: 860 + PET_PX / 2, y: 818 + PET_PX / 2 }));
    it("is the middle of the fallback corner when none is drawn", () =>
        expect(foldCenter(null, viewport)).toEqual({
            x: viewport.width - FOLD_FALLBACK_MARGIN - PET_PX / 2,
            y: viewport.height - FOLD_FALLBACK_MARGIN - PET_PX / 2,
        }));
});

describe("unfoldCenter", () => {
    const frame = { x: 100, y: 50 };
    it("grows the content out of Sprout's middle as the restored window sees it", () =>
        expect(unfoldCenter({ x: 900, y: 800, width: 64, height: 64 }, frame, 1, viewport)).toEqual({
            x: 900 + 32 - 100,
            y: 800 + 32 - 50,
        }));
    it("turns Windows' physical pixels into CSS pixels", () =>
        expect(unfoldCenter({ x: 1000, y: 600, width: 96, height: 96 }, { x: 0, y: 0 }, 1.5, viewport)).toEqual({
            x: 1048 / 1.5,
            y: 648 / 1.5,
        }));
    // dragged to another monitor while folded: the content still grows from inside the window
    it("pulls a Sprout dragged away from the window inside it", () =>
        expect(unfoldCenter({ x: 4000, y: -300, width: 64, height: 64 }, frame, 1, viewport)).toEqual({
            x: viewport.width,
            y: 0,
        }));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run frontend/app/view/agents/windowsize.test.ts`
Expected: FAIL, `Failed to resolve import "./windowsize"` (and `MINI_SPRITE_INSET` missing).

- [ ] **Step 3: Change the folded box in `floatwindow.ts`**

Replace the block from `// Float folded into Sprout (floatstore.ts enterMini).` down to the end of `interface MiniRestore`
with:

```ts
// The window folded into Sprout (floatstore.ts foldToSprout). The window becomes a see-through box around Sprout and
// grows for the chat, always around Sprout's own place on screen, so Sprout never moves when the chat opens or closes.
// Sizes are logical here and in the fold's space in the rects (toSpace).
export const MINI_SPROUT_BOX = 64; // the 48px sprite (petsprite.ts PET_PX) with room for its bob and the count chip
// the sprite sits this far inside the box, so a fold puts it on the pixels the walking one stood on (windowsize.ts)
export const MINI_SPRITE_INSET = 8;
export const MINI_REST_SIZE = { width: 320, height: 232 }; // room beside Sprout for the agent list and the bubble
export const MINI_CHAT_SIZE = { width: 380, height: 620 };
const MINI_MARGIN = 24;

// which way from Sprout the list, the bubble and the chat open: toward the middle of the screen
export interface MiniSides {
    h: "left" | "right";
    v: "up" | "down";
}

// what giving the window back needs: the size it was folded from and that size's frame
export interface MiniRestore {
    origin: FoldOrigin;
    // the frame, in the fold's space
    rect: WinRect;
    maximized: boolean;
    // macOS native fullscreen, left for the fold
    fullscreen: boolean;
    // Float's always on top
    pinned: boolean;
}
```

Add at the top of the file, under the header comment:

```ts
import type { FoldOrigin } from "./windowsize";
```

Replace `miniSproutRect` (its comment and body) with:

```ts
// Sprout's box on screen: the fold's spot (windowsize.ts foldSpot) or where a drag left it, pulled back on screen; the
// work area's bottom-right corner when there is none
export function miniSproutRect(spot: WinRect | null, work: WinRect, scale: number): WinRect {
    const size = MINI_SPROUT_BOX * scale;
    const margin = MINI_MARGIN * scale;
    const x = spot?.x ?? work.x + work.width - size - margin;
    const y = spot?.y ?? work.y + work.height - size - margin;
    return {
        x: clamp(x, work.x, work.x + work.width - size),
        y: clamp(y, work.y, work.y + work.height - size),
        width: size,
        height: size,
    };
}
```

Replace `parseMiniRestore` with:

```ts
export function parseMiniRestore(raw: unknown): MiniRestore | null {
    const r = raw as Partial<MiniRestore> | null;
    if (r == null || typeof r !== "object") {
        return null;
    }
    const rect = parseRect(r.rect);
    if (rect == null || typeof r.pinned !== "boolean") {
        return null;
    }
    return {
        // a fold from before Full could fold has no origin, and only ever folded a float
        origin: r.origin === "full" ? "full" : "float",
        rect,
        maximized: r.maximized === true,
        fullscreen: r.fullscreen === true,
        pinned: r.pinned,
    };
}
```

- [ ] **Step 4: Write `windowsize.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window's three sizes (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md): Full (the cockpit), Float (one
// agent's terminal) and Sprout (folded: Sprout alone, over every app). Which size a move lands in, the size a restore
// returns to, what minimize does, and where a fold starts and a restore grows from. Pure: floatstore.ts makes the
// window calls.

import { PET_PX } from "@/app/view/jarvis/petsprite";
import { MINI_SPRITE_INSET, MINI_SPROUT_BOX, type WinRect } from "./floatwindow";

export type WindowSize = "full" | "float" | "sprout";
// the size a fold was made from, which a restore returns to
export type FoldOrigin = Exclude<WindowSize, "sprout">;

export interface SizeState {
    size: WindowSize;
    // set while folded, null otherwise
    origin: FoldOrigin | null;
}

// fold: a Sprout button, minimize, the yellow light, ⌘M. restore: a double-click on Sprout, or Restore. toggle-float:
// Shift+F and the Float button. open-agent: a click on an agent in the folded list.
export type Move = "fold" | "restore" | "toggle-float" | "open-agent";

export function windowSize(floating: boolean, folded: boolean): WindowSize {
    return folded ? "sprout" : floating ? "float" : "full";
}

// origin: the fold's (floatstore.ts foldOriginAtom); a reload loses it, and the float mode that survives says it
export function sizeState(floating: boolean, folded: boolean, origin: FoldOrigin | null): SizeState {
    const size = windowSize(floating, folded);
    return { size, origin: size === "sprout" ? (origin ?? (floating ? "float" : "full")) : null };
}

export function move(s: SizeState, m: Move): SizeState {
    switch (m) {
        case "fold":
            return s.size === "sprout" ? s : { size: "sprout", origin: s.size };
        case "restore":
            return s.size === "sprout" ? { size: s.origin ?? "full", origin: null } : s;
        case "toggle-float":
            // folded, the shell is hidden: a float would shrink a window with nothing in it
            return s.size === "sprout" ? s : { size: s.size === "full" ? "float" : "full", origin: null };
        case "open-agent":
            return s.size === "sprout" ? { size: "float", origin: null } : s;
    }
}

/** What a surface switch does to the window. Float holds only the Agent surface, so leaving it ends the float (folded
 *  from Float too, which unfolds first). Folded from Full, a route that switched the surface (Open on a waiting item,
 *  `wsh ui`) wants the window back to show it. */
export function onSurfaceChange(s: SizeState, surface: string): "exit-float" | "restore" | null {
    const floated = s.size === "float" || (s.size === "sprout" && s.origin === "float");
    if (floated) {
        return surface === "agent" ? null : "exit-float";
    }
    return s.size === "sprout" ? "restore" : null;
}

export type MinimizeChoice = "sprout" | "dock";

// window:minimize: anything but "dock", unset included, folds into Sprout
export function minimizeChoice(raw: unknown): MinimizeChoice {
    return raw === "dock" ? "dock" : "sprout";
}

// what minimize does in a size: folded, nothing, since it is as small as it gets
export function minimizeAction(choice: MinimizeChoice, size: WindowSize): "fold" | "dock" | null {
    if (size === "sprout") {
        return null;
    }
    return choice === "dock" ? "dock" : "fold";
}

export interface Pt {
    x: number;
    y: number;
}

export interface Viewport {
    width: number;
    height: number;
}

// where the walking Sprout is taken to stand when none is drawn to measure: the content's bottom-right corner, this far in
export const FOLD_FALLBACK_MARGIN = 24;
// the fold's motion: the content scales to this and fades over this long (MOTION.easeFluid)
export const FOLD_MS = 300;
export const FOLD_SCALE = 0.04;

// the walking sprite's top-left in CSS px, or the fallback corner's
function spriteAt(sprite: Pt | null, viewport: Viewport): Pt {
    return (
        sprite ?? {
            x: viewport.width - PET_PX - FOLD_FALLBACK_MARGIN,
            y: viewport.height - PET_PX - FOLD_FALLBACK_MARGIN,
        }
    );
}

/** The point the content scales into on a fold: the walking sprite's middle, in CSS px. */
export function foldCenter(sprite: Pt | null, viewport: Viewport): Pt {
    const at = spriteAt(sprite, viewport);
    return { x: at.x + PET_PX / 2, y: at.y + PET_PX / 2 };
}

/** Sprout's box on screen for a fold, in the fold's space (floatwindow.ts toSpace): the folded sprite sits
 *  MINI_SPRITE_INSET inside it, so it lands on the pixels the walking one stood on. inner is the window content's
 *  top-left in that space, scale what a CSS px is in it (floatwindow.ts spaceScale). */
export function foldSpot(inner: Pt, scale: number, sprite: Pt | null, viewport: Viewport): WinRect {
    const at = spriteAt(sprite, viewport);
    const size = MINI_SPROUT_BOX * scale;
    return {
        x: inner.x + (at.x - MINI_SPRITE_INSET) * scale,
        y: inner.y + (at.y - MINI_SPRITE_INSET) * scale,
        width: size,
        height: size,
    };
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

/** The point the content grows out of on a restore: Sprout's middle as the restored window sees it, in CSS px, pulled
 *  inside the window when Sprout was dragged away from it (another monitor), so the content never flies in from off
 *  screen. frame is the restored window's top-left in the fold's space; its content starts there. */
export function unfoldCenter(sprout: WinRect, frame: Pt, scale: number, viewport: Viewport): Pt {
    return {
        x: clamp((sprout.x + sprout.width / 2 - frame.x) / scale, 0, viewport.width),
        y: clamp((sprout.y + sprout.height / 2 - frame.y) / scale, 0, viewport.height),
    };
}
```

- [ ] **Step 5: Update `floatwindow.test.ts` for the 64 px box and the new restore**

Replace the `describe("miniSproutRect", …)`, `describe("miniWindowRect", …)`, `describe("sproutFromWindow", …)` and
`describe("parseMiniRestore", …)` blocks with (the box is now 128 physical px at 2x, the rest window 640x464):

```ts
describe("miniSproutRect", () => {
    it("puts a Sprout with no spot in the bottom-right corner of the work area, 24px in", () => {
        expect(miniSproutRect(null, laptop, 2)).toEqual({
            x: laptop.x + laptop.width - 128 - 48,
            y: laptop.y + laptop.height - 128 - 48,
            width: 128,
            height: 128,
        });
    });
    it("keeps a spot that is on screen", () => {
        expect(miniSproutRect({ x: 100, y: 300, width: 128, height: 128 }, laptop, 2)).toEqual({
            x: 100,
            y: 300,
            width: 128,
            height: 128,
        });
    });
    it("pulls a Sprout past the screen's edge back onto it", () => {
        expect(miniSproutRect({ x: -500, y: 5000, width: 128, height: 128 }, laptop, 2)).toEqual({
            x: 0,
            y: laptop.y + laptop.height - 128,
            width: 128,
            height: 128,
        });
    });
    it("takes its size from this screen's scale, not the spot's", () => {
        expect(miniSproutRect({ x: 3000, y: 100, width: 128, height: 128 }, side, 1)).toMatchObject({
            width: 64,
            height: 64,
        });
    });
    it("a Sprout left on a monitor that is gone floats on the window's own", () => {
        const gone = { x: 9000, y: 200, width: 64, height: 64 };
        const screen = screenFor(gone, [{ area: laptop, scale: 2 }], { area: laptop, scale: 2 });
        const r = miniSproutRect(gone, screen.area, screen.scale);
        expect(r.x + r.width).toBeLessThanOrEqual(laptop.x + laptop.width);
        expect(r.y).toBeGreaterThanOrEqual(laptop.y);
    });
});

describe("miniWindowRect", () => {
    const corner = { x: 2600, y: 1600, width: 128, height: 128 };
    it("rests in a box with Sprout in its bottom-right corner when things open left and up", () => {
        expect(miniWindowRect(corner, MINI_REST_SIZE, { h: "left", v: "up" }, laptop, 2)).toEqual({
            x: 2600 + 128 - 640,
            y: 1600 + 128 - 464,
            width: 640,
            height: 464,
        });
    });
    it("opens right and down from a Sprout in the top-left corner", () => {
        const topLeft = { x: 40, y: 90, width: 128, height: 128 };
        expect(miniWindowRect(topLeft, MINI_CHAT_SIZE, { h: "right", v: "down" }, laptop, 2)).toEqual({
            x: 40,
            y: 90,
            width: 760,
            height: 1240,
        });
    });
    it("shortens the chat to the room there is rather than moving Sprout", () => {
        const small = { x: 0, y: 0, width: 1280, height: 700 };
        const low = { x: 1176, y: 480, width: 64, height: 64 };
        expect(miniWindowRect(low, MINI_CHAT_SIZE, { h: "left", v: "up" }, small, 1)).toEqual({
            x: 1176 + 64 - 380,
            y: 0,
            width: 380,
            height: 544,
        });
    });
});

describe("sproutFromWindow", () => {
    it("finds Sprout again from the window around it, whichever way it opens", () => {
        const corner = { x: 2600, y: 1600, width: 128, height: 128 };
        const all: MiniSides[] = [
            { h: "left", v: "up" },
            { h: "right", v: "down" },
            { h: "left", v: "down" },
            { h: "right", v: "up" },
        ];
        for (const sides of all) {
            const win = miniWindowRect(corner, MINI_CHAT_SIZE, sides, laptop, 2);
            expect(sproutFromWindow(win, sides, 2)).toEqual(corner);
        }
    });
});

describe("parseMiniRestore", () => {
    it("reads back what was stored", () => {
        const stored = {
            origin: "full",
            rect: { x: 10, y: 20, width: 720, height: 460 },
            maximized: true,
            fullscreen: false,
            pinned: false,
        };
        expect(parseMiniRestore(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    });
    // a session stored by the first fold, which only folded floats
    it("reads a restore from before Full could fold as a float's", () => {
        expect(parseMiniRestore({ rect: { x: 10, y: 20, width: 720, height: 460 }, pinned: true })).toEqual({
            origin: "float",
            rect: { x: 10, y: 20, width: 720, height: 460 },
            maximized: false,
            fullscreen: false,
            pinned: true,
        });
    });
    it("rejects a value without its pin or with a broken rect", () => {
        expect(parseMiniRestore({ rect: { x: 10, y: 20, width: 720, height: 460 } })).toBeNull();
        expect(parseMiniRestore({ rect: { x: 10 }, pinned: false })).toBeNull();
        expect(parseMiniRestore("junk")).toBeNull();
    });
});
```

- [ ] **Step 6: Run both test files**

Run: `npx vitest run frontend/app/view/agents/windowsize.test.ts frontend/app/view/agents/floatwindow.test.ts`
Expected: PASS. (`floatstore.ts` still builds a `MiniRestore` without `origin`; Task 2 fixes that, and Task 2's
typecheck is the one that must be clean.)

- [ ] **Step 7: Commit**

```bash
git add frontend/app/view/agents/windowsize.ts frontend/app/view/agents/windowsize.test.ts frontend/app/view/agents/floatwindow.ts frontend/app/view/agents/floatwindow.test.ts
git commit -m "feat(float): the window's three sizes as a pure model, and a 48px folded Sprout's box"
```

---

### Task 2: Fold from Full or Float where Sprout stands, and restore to the origin

**Files:**
- Modify: `frontend/app/view/agents/floatstore.ts` (whole file)
- Modify: `frontend/app/cockpit/cockpit-root.tsx:203-226` (the wrapper div)
- Modify: `frontend/app/view/jarvis/petview.tsx` (`PetView` return, `PetSprite`'s `motion.div`)
- Modify: `frontend/app/cockpit/sprout-mini.tsx` (restore, sizes)
- Modify: `frontend/app/cockpit/float-bar.tsx`, `frontend/app/cockpit/app-bar.tsx` (the renamed `enterMini`)

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces (floatstore.ts): `foldOriginAtom: PrimitiveAtom<FoldOrigin | null>`, `foldToSprout(): Promise<void>`,
  `restoreFromSprout(model: AgentsViewModel, agentId?: string): Promise<void>`. Removed: `enterMini`, `exitMini`
  (now private). Kept: `floatModeAtom`, `floatPinnedAtom`, `floatMiniAtom`, `miniSidesAtom`, `miniResizingAtom`,
  `enterFloat`, `exitFloat`, `toggleFloat`, `setFloatPinned`, `resizeMini`, `setupFloatMode`.
- Produces (DOM): `[data-window-content]` on the shell wrapper; `[data-pet-sprite]` on the walking sprite.

There is no render test harness (AGENTS.md); the pure rules are Task 1's tests, and this task is checked by the
typecheck, the vitest suite, and by hand in Task 11.

- [ ] **Step 1: Rewrite `floatstore.ts`**

Replace the whole file with:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window's sizes and their Tauri window calls: the arithmetic is floatwindow.ts, the rules windowsize.ts. Entering
// Float keeps the window's frame to give back, turns the terminal fullscreen, lifts the minimum size and shrinks the
// window to the last float's place; leaving gives the frame back. The window is never left pinned on top outside Float
// and the fold. Folding (foldToSprout), from Full or Float, scales the content into the walking Sprout and shrinks the
// same window, see-through, around the spot it stood on; a restore gives back the size and frame it was folded from.

import { MOTION } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { closePeek } from "@/app/view/jarvis/peekstore";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { isMacOS } from "@/util/platformutil";
import { listen } from "@tauri-apps/api/event";
import {
    availableMonitors,
    currentMonitor,
    getCurrentWindow,
    LogicalPosition,
    LogicalSize,
    PhysicalPosition,
    PhysicalSize,
    type Monitor,
    type Window,
} from "@tauri-apps/api/window";
import { atom, type PrimitiveAtom } from "jotai";
import { animate } from "motion/react";
import type { AgentsViewModel } from "./agents";
import {
    FLOAT_MIN_SIZE,
    floatRect,
    MAIN_MIN_SIZE,
    MINI_CHAT_SIZE,
    MINI_REST_SIZE,
    miniSides,
    miniSproutRect,
    miniWindowRect,
    parseMiniRestore,
    parseRect,
    parseRestore,
    screenFor,
    spaceScale,
    sproutFromWindow,
    toSpace,
    type FloatRestore,
    type MiniRestore,
    type MiniSides,
    type Screen,
    type WinRect,
} from "./floatwindow";
import { FLOAT_MINIMIZE_EVENT, redirectMinimize, setTrafficLightsHidden } from "./macwindow";
import { startClickThrough, stopClickThrough } from "./miniclickthrough";
import { terminalFullscreenAtom } from "./railstore";
import { serialQueue } from "./serialqueue";
import {
    FOLD_MS,
    FOLD_SCALE,
    foldCenter,
    foldSpot,
    move,
    onSurfaceChange,
    sizeState,
    unfoldCenter,
    type FoldOrigin,
    type Pt,
    type SizeState,
} from "./windowsize";

export const floatModeAtom = atom(false) as PrimitiveAtom<boolean>;
// always on top; on at every entry: a float is for watching an agent while you work in another app, so it starts above
// them, and its pin turns that off
export const floatPinnedAtom = atom(false) as PrimitiveAtom<boolean>;

// where the last float was, for the next one
const RECT_KEY = "arc.float.rect";
// The frame to give back. Session storage, so a reload mid-float (which loses the atoms) can still give it back,
// while a relaunch, which opens the window from tauri.conf.json anyway, starts clean.
const RESTORE_KEY = "arc.float.restore";

// The window folded into Sprout (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md): the same window, shrunk to
// a see-through box around Sprout, on top of every app. The shell stays mounted under display:none, so the terminal
// never refits; the window gets its frame back before the shell shows again.
export const floatMiniAtom = atom(false) as PrimitiveAtom<boolean>;
// the size the fold was made from, which a restore returns to; null while not folded
export const foldOriginAtom = atom<FoldOrigin | null>(null) as PrimitiveAtom<FoldOrigin | null>;
// which way from Sprout the list, the bubble and the chat open (floatwindow.ts miniSides)
export const miniSidesAtom = atom<MiniSides>({ h: "left", v: "up" }) as PrimitiveAtom<MiniSides>;
// true while the window changes size around Sprout, so a half-applied size never shows
export const miniResizingAtom = atom(false) as PrimitiveAtom<boolean>;

// the origin, frame and pin to give back; session, so a reload mid-fold can still give them back
const MINI_RESTORE_KEY = "arc.float.miniRestore";

function readJson(storage: () => Storage, key: string): unknown {
    try {
        const raw = storage().getItem(key);
        return raw == null ? null : JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeJson(storage: () => Storage, key: string, value: unknown): void {
    try {
        if (value == null) {
            storage().removeItem(key);
        } else {
            storage().setItem(key, JSON.stringify(value));
        }
    } catch {
        // a float that forgets its place still floats
    }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

function currentSize(): SizeState {
    return sizeState(globalStore.get(floatModeAtom), globalStore.get(floatMiniAtom), globalStore.get(foldOriginAtom));
}

async function frameOf(win: Window): Promise<WinRect> {
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
}

function screenOf(m: Monitor): Screen {
    const { position, size } = m.workArea;
    return { area: { x: position.x, y: position.y, width: size.width, height: size.height }, scale: m.scaleFactor };
}

// macOS animates out of native fullscreen, and a resize sent during the animation is dropped
async function leaveNativeFullscreen(win: Window): Promise<void> {
    if (!(await win.isFullscreen())) {
        return;
    }
    await win.setFullscreen(false);
    for (let i = 0; i < 30 && (await win.isFullscreen()); i++) {
        await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
}

async function giveFrameBack(win: Window, restore: FloatRestore | null): Promise<void> {
    await win.setAlwaysOnTop(false);
    // a reload mid-fold left the window see-through, frameless and deaf to the cursor; a float left the yellow button
    // pointed at Sprout
    await win.setIgnoreCursorEvents(false).catch(() => {});
    await win.setShadow(true).catch(() => {});
    await setTrafficLightsHidden(false).catch(() => {});
    await redirectMinimize(false).catch(() => {});
    writeJson(session, MINI_RESTORE_KEY, null);
    if (restore != null) {
        await win.setSize(new PhysicalSize(restore.rect.width, restore.rect.height));
        await win.setPosition(new PhysicalPosition(restore.rect.x, restore.rect.y));
    }
    // after the resize, so the window never grows to the minimum at the float's corner first
    await win.setMinSize(new LogicalSize(MAIN_MIN_SIZE.width, MAIN_MIN_SIZE.height));
    // the window opens maximized (tauri.conf.json), so that is the frame when there is none to give back
    if (restore == null || restore.maximized) {
        await win.maximize();
    }
}

let busy = false;

// The window part of entering Float, from the Full frame, which it keeps to give back. Inside busy.
async function floatTheWindow(model: AgentsViewModel): Promise<void> {
    try {
        const win = getCurrentWindow();
        await leaveNativeFullscreen(win);
        const maximized = await win.isMaximized();
        const restore: FloatRestore = {
            rect: await frameOf(win),
            maximized,
            terminalFullscreen: globalStore.get(terminalFullscreenAtom),
        };
        writeJson(session, RESTORE_KEY, restore);
        const last = parseRect(readJson(local, RECT_KEY));
        const [current, monitors] = await Promise.all([currentMonitor(), availableMonitors()]);
        if (current == null) {
            throw new Error("no monitor for the window");
        }
        const screen = screenFor(last, monitors.map(screenOf), screenOf(current));
        const rect = floatRect(last, screen.area, screen.scale);
        if (maximized) {
            await win.unmaximize();
        }
        await win.setMinSize(new LogicalSize(FLOAT_MIN_SIZE.width, FLOAT_MIN_SIZE.height));
        await win.setSize(new PhysicalSize(rect.width, rect.height));
        await win.setPosition(new PhysicalPosition(rect.x, rect.y));
        await win.setAlwaysOnTop(true);
        globalStore.set(model.surfaceAtom, "agent");
        globalStore.set(terminalFullscreenAtom, true);
        globalStore.set(floatPinnedAtom, true);
        globalStore.set(floatModeAtom, true);
        // the yellow button folds the float into Sprout rather than sending it to the Dock (macOS only)
        await redirectMinimize(true).catch((e) => console.error("redirecting the minimize button failed", e));
    } catch (e) {
        console.error("entering float mode failed", e);
        // a half-shrunk window with the full layout is worse than no float
        await giveFrameBack(getCurrentWindow(), parseRestore(readJson(session, RESTORE_KEY))).catch(() => {});
        writeJson(session, RESTORE_KEY, null);
    }
}

export async function enterFloat(model: AgentsViewModel): Promise<void> {
    // already floating, or folded: folded, the shell is hidden and a float would shrink a window with nothing in it
    if (busy || move(currentSize(), "toggle-float").size !== "float") {
        return;
    }
    busy = true;
    try {
        await floatTheWindow(model);
    } finally {
        busy = false;
    }
}

// restoreFullscreen: give the terminal back the fullscreen it had before; false when leaving fullscreen is what
// ended the float, which is a choice to keep
export async function exitFloat(restoreFullscreen: boolean): Promise<void> {
    // folded, or folding: give the float window back first (queued behind a fold in flight), then leave float as from
    // the float; a fold that could not be undone stays, rather than giving the full frame to a hidden shell
    await exitMini();
    if (globalStore.get(floatMiniAtom) || busy || !globalStore.get(floatModeAtom)) {
        return;
    }
    busy = true;
    try {
        const win = getCurrentWindow();
        const restore = parseRestore(readJson(session, RESTORE_KEY));
        writeJson(local, RECT_KEY, await frameOf(win).catch(() => null));
        globalStore.set(floatPinnedAtom, false);
        globalStore.set(floatModeAtom, false);
        if (restoreFullscreen && restore != null) {
            globalStore.set(terminalFullscreenAtom, restore.terminalFullscreen);
        }
        await giveFrameBack(win, restore);
        writeJson(session, RESTORE_KEY, null);
    } catch (e) {
        console.error("leaving float mode failed", e);
    } finally {
        busy = false;
    }
}

export function toggleFloat(model: AgentsViewModel): Promise<void> {
    return globalStore.get(floatModeAtom) ? exitFloat(true) : enterFloat(model);
}

export async function setFloatPinned(pinned: boolean): Promise<void> {
    if (!globalStore.get(floatModeAtom)) {
        return;
    }
    try {
        await getCurrentWindow().setAlwaysOnTop(pinned);
        globalStore.set(floatPinnedAtom, pinned);
    } catch (e) {
        console.error("always on top failed", e);
    }
}

// Sprout's box while folded, in the fold's space (floatwindow.ts toSpace: points on macOS, physical pixels on Windows)
let sprout: WinRect | null = null;
// Every window call of the fold goes through this, one at a time: a restore and the chat's resize, or a fold and a leave,
// interleaving left the window at the wrong size and the terminal refit to it.
const miniOps = serialQueue();
const MAC = isMacOS();

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function spaceFrame(win: Window): Promise<WinRect> {
    const [frame, scale] = await Promise.all([frameOf(win), win.scaleFactor()]);
    return toSpace(frame, scale, MAC);
}

// the window content's top-left, in the fold's space
async function spaceInner(win: Window): Promise<Pt> {
    const [pos, scale] = await Promise.all([win.innerPosition(), win.scaleFactor()]);
    const r = toSpace({ x: pos.x, y: pos.y, width: 0, height: 0 }, scale, MAC);
    return { x: r.x, y: r.y };
}

function spaceScreen(m: Monitor): Screen {
    const { position, size } = m.workArea;
    const area = { x: position.x, y: position.y, width: size.width, height: size.height };
    return { area: toSpace(area, m.scaleFactor, MAC), scale: spaceScale(m.scaleFactor, MAC) };
}

// macOS takes points back as logical, which every monitor shares; tao would read physical with the window's current
// scale, which is the wrong one once the window is on another monitor. The position first, so the size is read on the
// monitor the window lands on.
async function setSpaceFrame(win: Window, rect: WinRect): Promise<void> {
    if (MAC) {
        await win.setPosition(new LogicalPosition(rect.x, rect.y));
        await win.setSize(new LogicalSize(rect.width, rect.height));
    } else {
        await win.setSize(new PhysicalSize(rect.width, rect.height));
        await win.setPosition(new PhysicalPosition(rect.x, rect.y));
    }
}

// the screen a rect is on, or the window's own when it is on none (an unplugged monitor)
async function screenOfRect(rect: WinRect | null): Promise<Screen> {
    const [current, monitors] = await Promise.all([currentMonitor(), availableMonitors()]);
    if (current == null) {
        throw new Error("no monitor for the window");
    }
    return screenFor(rect, monitors.map(spaceScreen), spaceScreen(current));
}

// Size the folded window around Sprout: the resting box, or room for the chat. Inside the queue.
async function placeMini(win: Window, chat: boolean): Promise<void> {
    if (sprout == null) {
        return;
    }
    globalStore.set(miniResizingAtom, true);
    try {
        const screen = await screenOfRect(sprout);
        const sides = globalStore.get(miniSidesAtom);
        const rect = miniWindowRect(sprout, chat ? MINI_CHAT_SIZE : MINI_REST_SIZE, sides, screen.area, screen.scale);
        await setSpaceFrame(win, rect);
        await nextFrame();
    } finally {
        globalStore.set(miniResizingAtom, false);
    }
}

// Where the window has Sprout now: a drag moves the window, and the last settle may not have run yet.
async function sproutNow(win: Window): Promise<WinRect> {
    const [frame, scale] = await Promise.all([spaceFrame(win), win.scaleFactor()]);
    return sproutFromWindow(frame, globalStore.get(miniSidesAtom), spaceScale(scale, MAC));
}

export function resizeMini(chat: boolean): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        const win = getCurrentWindow();
        sprout = await sproutNow(win);
        await placeMini(win, chat);
    });
}

// The content a fold scales (cockpit-root.tsx): everything the window draws but the folded Sprout.
function content(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-window-content]");
}

function reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The walking Sprout's top-left in CSS px (petview.tsx marks it data-pet-sprite), or null when none is drawn.
function walkingSprite(): Pt | null {
    const r = document.querySelector("[data-pet-sprite]")?.getBoundingClientRect();
    return r == null || r.width === 0 ? null : { x: r.left, y: r.top };
}

// Scale the content into Sprout's spot and fade it (a fold), or grow it out of the spot (a restore): opacity and scale
// on the motion tokens' easing. Reduced motion skips it.
async function scaleContent(at: Pt, to: "sprout" | "window"): Promise<void> {
    const el = content();
    if (el == null || reducedMotion()) {
        return;
    }
    el.style.transformOrigin = `${at.x}px ${at.y}px`;
    const keyframes =
        to === "sprout" ? { scale: [1, FOLD_SCALE], opacity: [1, 0] } : { scale: [FOLD_SCALE, 1], opacity: [0, 1] };
    await animate(el, keyframes, { duration: FOLD_MS / 1000, ease: MOTION.easeFluid }).finished;
}

// Before the shell shows again: drawn as small and clear as the fold left it, so its first frame is not full size.
function holdContentFolded(at: Pt): void {
    const el = content();
    if (el == null || reducedMotion()) {
        return;
    }
    el.style.transformOrigin = `${at.x}px ${at.y}px`;
    el.style.transform = `scale(${FOLD_SCALE})`;
    el.style.opacity = "0";
}

// No transform left behind: a transformed content is the containing block of every fixed element under it.
function clearContentMotion(): void {
    const el = content();
    if (el == null) {
        return;
    }
    el.style.removeProperty("transform");
    el.style.removeProperty("opacity");
    el.style.removeProperty("transform-origin");
}

/** Fold the window into Sprout, from Full or Float: the content scales into the walking Sprout, then the window shrinks,
 *  see-through, around the spot it stood on. */
export function foldToSprout(): Promise<void> {
    return miniOps(async () => {
        const now = currentSize();
        if (busy || now.size === "sprout") {
            return;
        }
        const origin = now.size;
        const win = getCurrentWindow();
        try {
            const fullscreen = await win.isFullscreen();
            await leaveNativeFullscreen(win);
            await nextFrame();
            const sprite = walkingSprite();
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const [frame, maximized, inner, scale] = await Promise.all([
                spaceFrame(win),
                win.isMaximized(),
                spaceInner(win),
                win.scaleFactor(),
            ]);
            const restore: MiniRestore = {
                origin,
                rect: frame,
                maximized,
                fullscreen,
                pinned: globalStore.get(floatPinnedAtom),
            };
            writeJson(session, MINI_RESTORE_KEY, restore);
            closePeek();
            globalStore.set(foldOriginAtom, origin);
            // the page goes see-through as the content leaves it; the content paints its own background
            document.documentElement.dataset.floatMini = "";
            await setTrafficLightsHidden(true);
            await win.setShadow(false);
            await scaleContent(foldCenter(sprite, viewport), "sprout");
            // hide the shell before the window shrinks: a terminal that saw the small window would refit its PTY to it
            globalStore.set(floatMiniAtom, true);
            await nextFrame();
            await nextFrame();
            clearContentMotion();
            if (maximized) {
                await win.unmaximize();
            }
            const spot = foldSpot(inner, spaceScale(scale, MAC), sprite, viewport);
            const screen = await screenOfRect(spot);
            sprout = miniSproutRect(spot, screen.area, screen.scale);
            globalStore.set(miniSidesAtom, miniSides(sprout, screen.area));
            await win.setMinSize(null);
            await placeMini(win, false);
            await win.setAlwaysOnTop(true);
            startClickThrough();
        } catch (e) {
            console.error("folding the window into Sprout failed", e);
            const back = await leaveMini(win).catch(() => ({ at: null, fullscreen: false }));
            await showContent(win, back).catch(() => {});
        }
    });
}

interface Unfold {
    // where the content grows out of, in the restored window's CSS px; null for no growth
    at: Pt | null;
    // the window was in macOS native fullscreen when it folded
    fullscreen: boolean;
}

// Give back the frame, size limits and pin of the size the fold was made from, the shell still hidden so the terminal
// fits to the size it had. Inside the queue.
async function leaveMini(win: Window): Promise<Unfold> {
    const was = sprout;
    sprout = null;
    stopClickThrough();
    // Sprout must not show in a corner of the grown window
    globalStore.set(miniResizingAtom, true);
    const restore = parseMiniRestore(readJson(session, MINI_RESTORE_KEY));
    const origin = restore?.origin ?? globalStore.get(foldOriginAtom) ?? "float";
    await win.setIgnoreCursorEvents(false);
    if (restore != null) {
        await setSpaceFrame(win, restore.rect);
    }
    const min = origin === "full" ? MAIN_MIN_SIZE : FLOAT_MIN_SIZE;
    await win.setMinSize(new LogicalSize(min.width, min.height));
    await win.setAlwaysOnTop(origin === "float" && (restore?.pinned ?? false));
    if (origin === "full" && restore?.maximized) {
        await win.maximize();
    }
    writeJson(session, MINI_RESTORE_KEY, null);
    await nextFrame();
    if (was == null || restore == null) {
        return { at: null, fullscreen: false };
    }
    // the restored frame is the content's box (a borderless window, or macOS's overlaid title bar), and it is read from
    // the restore rather than the window, whose own size may not have reached the page yet
    const scale = spaceScale(await win.scaleFactor(), MAC);
    const frame = restore.rect;
    const viewport = { width: frame.width / scale, height: frame.height / scale };
    return {
        at: unfoldCenter(was, { x: frame.x, y: frame.y }, scale, viewport),
        fullscreen: origin === "full" && restore.fullscreen,
    };
}

// Show the shell again, grown out of Sprout's spot when there is one, then give the window its own chrome back.
async function showContent(win: Window, unfold: Unfold): Promise<void> {
    if (unfold.at != null) {
        holdContentFolded(unfold.at);
    }
    globalStore.set(floatMiniAtom, false);
    globalStore.set(foldOriginAtom, null);
    globalStore.set(miniResizingAtom, false);
    await nextFrame();
    if (unfold.at != null) {
        await scaleContent(unfold.at, "window");
    }
    clearContentMotion();
    delete document.documentElement.dataset.floatMini;
    await win.setShadow(true);
    await setTrafficLightsHidden(false);
    if (unfold.fullscreen) {
        await win.setFullscreen(true);
    }
}

/** Restore from Sprout: back to the size it was folded from, at its frame, the content growing out of Sprout. With an
 *  agent (a click in the folded list), to Float on that agent, whichever size it was folded from. */
export function restoreFromSprout(model: AgentsViewModel, agentId?: string): Promise<void> {
    return miniOps(async () => {
        const now = currentSize();
        if (now.size !== "sprout") {
            return;
        }
        const win = getCurrentWindow();
        try {
            // the chat's closing asks for a resize, which queues behind this and finds the fold gone
            closePeek();
            if (agentId != null) {
                model.openTerminal(agentId);
            }
            const to = move(now, agentId != null ? "open-agent" : "restore").size;
            const unfold = await leaveMini(win);
            if (to === "float" && now.origin === "full") {
                // Full's frame is back with the shell still hidden: float from it, so the terminal only sees the float
                busy = true;
                try {
                    await floatTheWindow(model);
                } finally {
                    busy = false;
                }
                await showContent(win, { at: null, fullscreen: false });
                return;
            }
            await showContent(win, unfold);
        } catch (e) {
            console.error("restoring the window from Sprout failed", e);
        }
    });
}

// Out of the fold with no growth, for a leave that goes on to another size (exitFloat).
function exitMini(): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        const win = getCurrentWindow();
        try {
            closePeek();
            const unfold = await leaveMini(win);
            await showContent(win, { at: null, fullscreen: unfold.fullscreen });
        } catch (e) {
            console.error("giving the window back failed", e);
        }
    });
}

// A drag moves the window: pull Sprout back on screen when it was dropped past an edge, and turn the window around
// when Sprout crossed the middle.
function settleMove(): Promise<void> {
    return miniOps(async () => {
        if (!globalStore.get(floatMiniAtom) || sprout == null) {
            return;
        }
        const win = getCurrentWindow();
        const moved = await sproutNow(win);
        const screen = await screenOfRect(moved);
        sprout = miniSproutRect(moved, screen.area, screen.scale);
        const sides = globalStore.get(miniSidesAtom);
        const next = miniSides(sprout, screen.area);
        const pulled = sprout.x !== moved.x || sprout.y !== moved.y;
        if (pulled || next.h !== sides.h || next.v !== sides.v) {
            globalStore.set(miniSidesAtom, next);
            await placeMini(win, globalStore.get(petPeekOpenAtom));
        }
    });
}

// What a reload mid-fold left: a see-through window, deaf to the cursor, with no shadow or traffic lights, pinned on
// top. It gets the frame of the size it was folded from (a float's then goes on to Full, see setupFloatMode).
async function recoverFold(win: Window, restore: MiniRestore): Promise<void> {
    writeJson(session, MINI_RESTORE_KEY, null);
    await win.setIgnoreCursorEvents(false);
    await win.setShadow(true);
    await setTrafficLightsHidden(false);
    await win.setAlwaysOnTop(false);
    await setSpaceFrame(win, restore.rect);
    const min = restore.origin === "full" ? MAIN_MIN_SIZE : FLOAT_MIN_SIZE;
    await win.setMinSize(new LogicalSize(min.width, min.height));
    if (restore.origin === "full" && restore.maximized) {
        await win.maximize();
    }
}

// Mounted once by the shell. A reload mid-fold or mid-float lost the atoms but not the shrunk, maybe see-through and
// pinned window: give the frames back, the fold's first, then the float's. The small float window has room for the
// focused terminal alone, so leaving the Agent surface or the terminal's fullscreen (f, Esc, the header button) ends the
// float; folded from Full, a surface switch brings the window back (windowsize.ts onSurfaceChange).
export function setupFloatMode(model: AgentsViewModel): () => void {
    const win = getCurrentWindow();
    if (!globalStore.get(floatModeAtom) && !globalStore.get(floatMiniAtom)) {
        const strandedFold = parseMiniRestore(readJson(session, MINI_RESTORE_KEY));
        const stranded = parseRestore(readJson(session, RESTORE_KEY));
        writeJson(session, RESTORE_KEY, null);
        void (async () => {
            if (strandedFold != null) {
                await recoverFold(win, strandedFold);
            }
            if (stranded != null) {
                await giveFrameBack(win, stranded);
            }
        })().catch((e) => console.error("restoring the window failed", e));
    }
    const unsubSurface = globalStore.sub(model.surfaceAtom, () => {
        const act = onSurfaceChange(currentSize(), globalStore.get(model.surfaceAtom));
        if (act === "exit-float") {
            void exitFloat(true);
        } else if (act === "restore") {
            void restoreFromSprout(model);
        }
    });
    const unsubFullscreen = globalStore.sub(terminalFullscreenAtom, () => {
        if (globalStore.get(floatModeAtom) && !globalStore.get(terminalFullscreenAtom)) {
            void exitFloat(false);
        }
    });
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const unlistenMoved = win.onMoved(() => {
        if (!globalStore.get(floatMiniAtom)) {
            return;
        }
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => void settleMove().catch((e) => console.error("placing Sprout failed", e)), 300);
    });
    // the yellow button, redirected while floating (floatTheWindow)
    const unlistenMinimize = listen(FLOAT_MINIMIZE_EVENT, () => void foldToSprout());
    return () => {
        unsubSurface();
        unsubFullscreen();
        clearTimeout(moveTimer);
        void unlistenMoved.then((f) => f());
        void unlistenMinimize.then((f) => f());
    };
}
```

`model.openTerminal(id)` (agents.tsx) focuses the agent, puts the Agent surface up and shows its terminal: the one
route that chooses an agent. `motion/react` 12's `animate(element, keyframes, options)` animates a DOM element and
returns controls whose `.finished` resolves when it ends.

- [ ] **Step 2: Give the shell wrapper its data attribute and its own background**

In `frontend/app/cockpit/cockpit-root.tsx`, replace:

```tsx
            {/* folded into Sprout: everything else stays mounted under display:none, so the terminal never refits to
                the small window (floatstore.ts enterMini) */}
            <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", folded && "hidden")}>
```

with:

```tsx
            {/* folded into Sprout: everything else stays mounted under display:none, so the terminal never refits to
                the small window (floatstore.ts foldToSprout). The fold scales this into Sprout; it paints its own
                background, since the page goes see-through around it as it leaves. */}
            <div
                data-window-content
                className={cn("flex min-h-0 flex-1 flex-col overflow-hidden bg-background", folded && "hidden")}
            >
```

- [ ] **Step 3: Mark the walking sprite, and keep its bubble and peek away while folded**

In `frontend/app/view/jarvis/petview.tsx`:

Add the import:

```ts
import { floatMiniAtom } from "@/app/view/agents/floatstore";
```

In `PetView`, after `const surface = useAtomValue(model.surfaceAtom);` add:

```ts
    // folded, the shell is hidden but this stays mounted (its voice keeps running); the bubble and the peek portal to
    // the body, past the hidden shell, so the folded Sprout draws its own (cockpit/sprout-mini.tsx)
    const folded = useAtomValue(floatMiniAtom);
```

Wrap the `<PetBubble … />` element as `{folded ? null : (<PetBubble … />)}` and the `<PetPeek … />` element as
`{folded ? null : <PetPeek model={model} anchor={anchor} corner={corner} signals={signals} />}` (keep the comment above
the peek).

In `PetSprite`'s `<motion.div`, add the attribute right after `ref={setAnchor}`:

```tsx
            // where a fold starts (floatstore.ts foldToSprout reads its box)
            data-pet-sprite
```

- [ ] **Step 4: Point the folded Sprout and the bars at the new calls, at 48 px**

In `frontend/app/cockpit/sprout-mini.tsx`:

- import `restoreFromSprout` instead of `exitMini` from `@/app/view/agents/floatstore`;
- replace the header comment's first sentence "The float folded into Sprout (floatstore.ts enterMini)" with "The window
  folded into Sprout (floatstore.ts foldToSprout)", and "gives the float window back" with "restores the size it was
  folded from";
- replace `// 4px a cell: the 16-cell sprite is 64px` / `const CELL_PX = 4;` with:

```ts
// 3px a cell: the same 48px Sprout as on the footer and the float's ledge (petsprite.ts PET_CELL_PX)
const CELL_PX = 3;
```

- replace `boxCorner`'s comment `// Sprout's 80px box:` with `// Sprout's 64px box:`;
- replace `besideSprout`'s body with:

```ts
    return cn(sides.h === "left" ? "right-[72px]" : "left-[72px]", sides.v === "up" ? "bottom-2" : "top-2");
```

- in the JSX, the Sprout box `"absolute h-20 w-20"` becomes `"absolute h-16 w-16"`;
- the count chip's classes `min-w-[18px] … px-[5px] … text-[11px] … leading-[18px]` become
  `min-w-4 … px-1 … text-[10px] … leading-4` (keep `pointer-events-none absolute left-1 top-3 rounded-full bg-warning
  text-center font-bold text-on-warning tabular-nums`);
- replace `restore`:

```ts
    const restore = () => {
        clearTimeout(clickTimer.current);
        fireAndForget(() => restoreFromSprout(model));
    };
```

In `frontend/app/cockpit/float-bar.tsx`, import `foldToSprout` instead of `enterMini` and change
`onClick={() => fireAndForget(enterMini)}` to `onClick={() => fireAndForget(foldToSprout)}`.

In `frontend/app/cockpit/app-bar.tsx`, import `foldToSprout` instead of `enterMini`, change the minimize button's
`fireAndForget(enterMini)` to `fireAndForget(foldToSprout)`, and its comment's `floatstore.ts enterMini` to
`floatstore.ts foldToSprout`.

- [ ] **Step 5: Typecheck and run the tests**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (allow 5 minutes)
Expected: exit 0. Then `grep -rn "enterMini\|exitMini\|arc.float.mini.v2" frontend/` → only the private `exitMini`
in `floatstore.ts`.

Run: `npx vitest run frontend/app/view/agents/ frontend/app/view/jarvis/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/view/agents/floatstore.ts frontend/app/cockpit/cockpit-root.tsx frontend/app/view/jarvis/petview.tsx frontend/app/cockpit/sprout-mini.tsx frontend/app/cockpit/float-bar.tsx frontend/app/cockpit/app-bar.tsx
git commit -m "feat(float): fold into Sprout from Full or Float where Sprout stands, and restore to the size it came from"
```

---

### Task 3: The Sprout button in both bars

**Files:**
- Modify: `frontend/app/cockpit/app-bar.tsx` (the right-hand group, after **+ New**)
- Modify: `frontend/app/cockpit/float-bar.tsx` (the minimize button)
- Modify: `CHANGELOG.md` (the "Minimizing a float window folds it into Sprout…" line under `## Unreleased` / `### Added`)

**Interfaces:**
- Consumes: `foldToSprout()` (Task 2).
- Produces (DOM): `[data-app-sprout]` on the app bar's button; the float bar's keeps `[data-float-minimize]`.

- [ ] **Step 1: Add the button to the app bar**

In `frontend/app/cockpit/app-bar.tsx`, add imports:

```ts
import { spriteFor } from "@/app/view/jarvis/petsprite";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
```

Above `export function CockpitAppBar`, add:

```ts
// the creature sitting, on the button that folds the window into it
const FOLD_SPRITE = spriteFor("sit", []);
```

Between the **+ New** `</button>` and `{mac ? null : <WindowControls />}`, add:

```tsx
                {/* one click from the cockpit to Sprout alone, over every app (floatstore.ts foldToSprout) */}
                <button
                    type="button"
                    data-app-sprout
                    aria-label="Fold into Sprout"
                    title="Fold into Sprout"
                    onClick={() => fireAndForget(foldToSprout)}
                    className="flex h-[26px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised pl-1.5 pr-2 text-[11.5px] font-semibold text-secondary hover:bg-surface-hover hover:text-primary"
                >
                    <SproutSvg sprite={FOLD_SPRITE} cellPx={1} />
                    Sprout
                </button>
```

- [ ] **Step 2: Rename the float bar's button**

In `frontend/app/cockpit/float-bar.tsx`, the minimize button becomes:

```tsx
            <button
                type="button"
                data-float-minimize
                aria-label="Fold into Sprout"
                title="Fold into Sprout"
                onClick={() => fireAndForget(foldToSprout)}
                className={cn(ICON_BTN, "gap-[5px] pr-2 text-[11px] font-semibold")}
            >
                <SproutSvg sprite={MINIMIZE_SPRITE} cellPx={1} />
                Sprout
            </button>
```

- [ ] **Step 3: Say it in the changelog**

In `CHANGELOG.md`, replace the bullet that starts `- Minimizing a float window folds it into Sprout` (three lines)
with:

```markdown
- The **Sprout** button on the app bar and on the float bar, and minimize (the yellow button on macOS), fold the
  window into Sprout right where Sprout stood, from the cockpit or a float: Sprout floats over your other apps; click it
  to answer what waits on you or ask Jarvis, drag it anywhere, and double-click it or press **Restore** to get back the
  window you folded, at the same size and place.
```

- [ ] **Step 4: Typecheck, lint, format**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
Run: `npx eslint frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/float-bar.tsx` → no errors.
Run: `npx prettier --check frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/float-bar.tsx` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/float-bar.tsx CHANGELOG.md
git commit -m "feat(cockpit): a Sprout button on the app bar folds the cockpit into Sprout in one click"
```

---

### Task 4: Minimize goes to Sprout in every size, and the `window:minimize` setting

**Files:**
- Modify: `pkg/wconfig/settingsconfig.go` (after the `Notify*` fields), `pkg/wconfig/defaultconfig/settings.json`
- Generated by `task generate`: `frontend/types/gotypes.d.ts`, `pkg/wconfig/metaconsts.go`, the schema
- Modify: `src-tauri/src/macwindow.rs`, `src-tauri/Cargo.toml:43`
- Modify: `frontend/app/view/agents/macwindow.ts`, `frontend/app/view/agents/floatstore.ts`
- Modify: `frontend/app/cockpit/app-bar.tsx` (`WindowControls`, `useFoldTitle`), `frontend/app/cockpit/float-bar.tsx`
- Modify: `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`,
  `frontend/app/view/agents/settingspages/general.tsx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `minimizeChoice`, `minimizeAction`, `windowSize` (Task 1); `foldToSprout` (Task 2).
- Produces: settings key `window:minimize` (`"sprout"` | `"dock"`); `MINIMIZE_EVENT = "window-minimize"`
  (macwindow.ts, replacing `FLOAT_MINIMIZE_EVENT`); `minimizeRequested(): void` (floatstore.ts);
  `useFoldTitle(): string` (app-bar.tsx); settings row id `window.minimize` in card `general/window`.

- [ ] **Step 1: Write the failing settings test**

In `frontend/app/view/agents/settingsmodel.test.ts`, in `it("puts each row in the card the spec names", …)`, after the
`cards["general/notifications"]` expectation add:

```ts
        expect(cards["general/window"]).toEqual(["window.minimize"]);
```

and in `it("keeps every row exactly once", …)` change `35 + RUNTIME_FLAGS.claude.length` to
`36 + RUNTIME_FLAGS.claude.length`.

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts`
Expected: FAIL on `general/window` (undefined) and the count.

- [ ] **Step 2: Add the setting in Go and regenerate**

In `pkg/wconfig/settingsconfig.go`, after `NotifyReply *bool …` and its blank line, add:

```go
	WindowClear    bool   `json:"window:*,omitempty"`
	WindowMinimize string `json:"window:minimize,omitempty"` // what minimize does: "sprout" (default) folds the window into Sprout, "dock" sends it to the Dock or taskbar
```

In `pkg/wconfig/defaultconfig/settings.json`, after `"notify:reply": true,` add `"window:minimize": "sprout",`.

Run: `task generate`
Expected: `git status --short` shows `frontend/types/gotypes.d.ts` (gains `"window:minimize"?: string;`),
`pkg/wconfig/metaconsts.go`, and the generated schema; nothing hand-edited.

Run: `go build ./pkg/wconfig/... && go test ./pkg/wconfig/...`
Expected: PASS.

- [ ] **Step 3: Add the Settings row**

In `frontend/app/view/agents/settingsmodel.ts`, in the `general` section's `cards`, after the `notifications` card
(before `vault`), add:

```ts
                {
                    id: "window",
                    label: "Window",
                    rows: [
                        {
                            id: "window.minimize",
                            title: "Minimize",
                            desc: "What minimize does, the yellow button and ⌘M on macOS included: fold the window into Sprout, which floats over every app, or send it to the Dock or taskbar. The Sprout button folds either way.",
                            key: "window:minimize",
                            scope: "synced",
                            config: true,
                        },
                    ],
                },
```

In `frontend/app/view/agents/settingspages/general.tsx`:

Add imports:

```ts
import { isMacOS } from "@/util/platformutil";
import { minimizeChoice } from "../windowsize";
```

In `GeneralPage`, between the Notifications card and `<VaultCard />`, add:

```tsx
            <SettingCard id="window" label="Window">
                <WindowRows />
            </SettingCard>
```

and add the component after `NotificationRows`:

```tsx
function WindowRows() {
    const choice = minimizeChoice(useAtomValue(getSettingsKeyAtom("window:minimize")));
    const dock = isMacOS() ? "Dock" : "Taskbar";
    const items: ContextMenuItem[] = [
        {
            label: "Sprout",
            type: "radio",
            checked: choice === "sprout",
            sublabel: "Fold the window into Sprout, over every app",
            click: () => writeConfig({ "window:minimize": "sprout" }),
        },
        {
            label: dock,
            type: "radio",
            checked: choice === "dock",
            sublabel: `Send the window to the ${dock.toLowerCase()}`,
            click: () => writeConfig({ "window:minimize": "dock" }),
        },
    ];
    return (
        <SettingRow id="window.minimize">
            <Select
                value={choice}
                label={choice === "dock" ? dock : "Sprout"}
                items={items}
                ariaLabel="Minimize"
            />
        </SettingRow>
    );
}
```

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts`
Expected: PASS.

- [ ] **Step 4: Redirect ⌘M as well as the yellow button (Rust)**

In `src-tauri/Cargo.toml`, add `"NSApplication", "NSMenu", "NSMenuItem"` to the `objc2-app-kit` features list.

In `src-tauri/src/macwindow.rs`:

- the file's header comment becomes:

```rust
// The window's macOS chrome (floatstore.ts): hide the traffic lights while the window is folded into Sprout, and send
// the yellow button and ⌘M to Sprout instead of the Dock while window:minimize says so. Tauri can do neither, so this
// talks to AppKit. Commands that are not async run on the main thread, which AppKit requires; the marker check turns a
// mistake there into an error instead of undefined behaviour. Both are no-ops on other platforms.
```

- `use objc2_app_kit::{NSWindow, NSWindowButton};` becomes
  `use objc2_app_kit::{NSApplication, NSMenuItem, NSWindow, NSWindowButton};`
- the class name `"ArcFloatMinimizeTarget"` becomes `"ArcMinimizeTarget"`, and `app.emit("float-minimize", ())`
  becomes `app.emit("window-minimize", ())`;
- replace the `Redirect` struct and its comment with:

```rust
    // A button or a menu item holds its target weakly, so the redirect keeps it alive here, with the target and action
    // each gets back when the redirect ends.
    struct Redirect {
        _target: Retained<MinimizeTarget>,
        original_target: Option<Retained<AnyObject>>,
        original_action: Option<Sel>,
        // the app menu's Minimize item (⌘M), when the menu has one
        menu_item: Option<(Retained<NSMenuItem>, Option<Retained<AnyObject>>, Option<Sel>)>,
    }
```

- add after `ns_window`:

```rust
    // ⌘M is the app menu's Minimize item, which sends performMiniaturize: to the window: it is pointed at the same
    // target, so it folds whether or not AppKit routes it through the button.
    fn minimize_menu_item(mtm: MainThreadMarker) -> Option<Retained<NSMenuItem>> {
        let menu = NSApplication::sharedApplication(mtm).mainMenu()?;
        for i in 0..menu.numberOfItems() {
            let Some(sub) = menu.itemAtIndex(i).and_then(|item| item.submenu()) else {
                continue;
            };
            for j in 0..sub.numberOfItems() {
                if let Some(item) = sub.itemAtIndex(j) {
                    if item.action() == Some(sel!(performMiniaturize:)) {
                        return Some(item);
                    }
                }
            }
        }
        None
    }
```

- in `redirect_minimize`, the `if on && slot.is_none()` branch becomes:

```rust
            if on && slot.is_none() {
                let target = MinimizeTarget::new(mtm);
                let original_target = button.target();
                let original_action = button.action();
                let as_object: &AnyObject = &target;
                // SAFETY: the target is kept alive in REDIRECT for as long as the button and the item point at it
                unsafe {
                    button.setTarget(Some(as_object));
                    button.setAction(Some(sel!(minimizeToSprout:)));
                }
                let menu_item = minimize_menu_item(mtm).map(|item| {
                    let (target_was, action_was) = (item.target(), item.action());
                    // SAFETY: as above
                    unsafe {
                        item.setTarget(Some(as_object));
                        item.setAction(Some(sel!(minimizeToSprout:)));
                    }
                    (item, target_was, action_was)
                });
                *slot = Some(Redirect { _target: target, original_target, original_action, menu_item });
            } else if !on {
                if let Some(r) = slot.take() {
                    // SAFETY: these are the button's and the item's own targets and actions from before the redirect
                    unsafe {
                        button.setTarget(r.original_target.as_deref());
                        button.setAction(r.original_action);
                        if let Some((item, target, action)) = r.menu_item {
                            item.setTarget(target.as_deref());
                            item.setAction(action);
                        }
                    }
                }
            }
```

Run: `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles. (If an `objc2-app-kit` 0.3.2 method name differs, the source is in
`~/.cargo/registry/src/index.crates.io-*/objc2-app-kit-0.3.2/src/generated/NSMenu.rs` / `NSMenuItem.rs` /
`NSApplication.rs`; `mainMenu`, `numberOfItems`, `itemAtIndex`, `submenu`, `action`, `setAction`, `target`,
`setTarget` were checked there.)

- [ ] **Step 5: Route minimize through the setting (frontend)**

In `frontend/app/view/agents/macwindow.ts`, replace the header comment and the event constant with:

```ts
// The window's macOS chrome, from src-tauri/src/macwindow.rs: hide the traffic lights while folded into Sprout, and send
// the yellow button and ⌘M to Sprout while window:minimize says so (they emit MINIMIZE_EVENT). No-ops elsewhere.

import { isMacOS } from "@/util/platformutil";
import { invoke } from "@tauri-apps/api/core";

export const MINIMIZE_EVENT = "window-minimize";
```

In `frontend/app/view/agents/floatstore.ts`:

- imports: `FLOAT_MINIMIZE_EVENT` becomes `MINIMIZE_EVENT`; add `import { getSettingsKeyAtom } from "@/app/store/global";`
  and `import { fireAndForget } from "@/util/util";`; add `minimizeAction, minimizeChoice, windowSize` to the
  `./windowsize` import;
- in `giveFrameBack`, delete the line `await redirectMinimize(false).catch(() => {});` and change the comment above it to
  `// a reload mid-fold left the window see-through, frameless and deaf to the cursor`;
- in `floatTheWindow`, delete the two lines at the end of the `try` that redirect the minimize button (the comment and
  `await redirectMinimize(true)…`);
- add after `restoreFromSprout`:

```ts
/** Minimize, from the window's own button, the yellow button or ⌘M: fold into Sprout, or to the Dock or taskbar when
 *  window:minimize says so; folded, nothing. */
export function minimizeRequested(): void {
    const size = windowSize(globalStore.get(floatModeAtom), globalStore.get(floatMiniAtom));
    const action = minimizeAction(minimizeChoice(globalStore.get(getSettingsKeyAtom("window:minimize"))), size);
    if (action === "dock") {
        fireAndForget(() => getCurrentWindow().minimize());
    } else if (action === "fold") {
        void foldToSprout();
    }
}
```

- in `setupFloatMode`, replace the two lines that listen for the yellow button with:

```ts
    // the yellow button and ⌘M fold while window:minimize says Sprout, in every size (macOS: macwindow.rs redirects them)
    const minimizeSetting = getSettingsKeyAtom("window:minimize");
    const syncRedirect = () =>
        void redirectMinimize(minimizeChoice(globalStore.get(minimizeSetting)) === "sprout").catch((e) =>
            console.error("redirecting minimize failed", e)
        );
    syncRedirect();
    const unsubMinimize = globalStore.sub(minimizeSetting, syncRedirect);
    const unlistenMinimize = listen(MINIMIZE_EVENT, minimizeRequested);
```

  and add `unsubMinimize();` to the returned cleanup.

In `frontend/app/cockpit/app-bar.tsx`:

- imports: add `getSettingsKeyAtom` to the `@/app/store/global` import; replace the `floatstore` import with
  `import { foldToSprout, minimizeRequested } from "@/app/view/agents/floatstore";`; add
  `import { minimizeChoice } from "@/app/view/agents/windowsize";`;
- add above `CockpitAppBar`:

```ts
// The Sprout buttons' tooltip: on a Mac, ⌘M folds too while window:minimize says Sprout
export function useFoldTitle(): string {
    const choice = minimizeChoice(useAtomValue(getSettingsKeyAtom("window:minimize")));
    return isMacOS() && choice === "sprout" ? "Fold into Sprout (⌘M)" : "Fold into Sprout";
}
```

- in `CockpitAppBar`, add `const foldTitle = useFoldTitle();` and give the Sprout button `title={foldTitle}`;
- in `WindowControls`, replace the `floating` line and its comment with:

```ts
    // minimize folds the window into Sprout unless window:minimize sends it to the taskbar (floatstore.ts)
    const toSprout = minimizeChoice(useAtomValue(getSettingsKeyAtom("window:minimize"))) === "sprout";
```

  and the minimize button's handler and label with `onClick={minimizeRequested}` and
  `aria-label={toSprout ? "Fold into Sprout" : "Minimize"}`.

In `frontend/app/cockpit/float-bar.tsx`, import `useFoldTitle` beside `WindowControls` from `./app-bar`, add
`const foldTitle = useFoldTitle();` in `FloatBar`, and give the Sprout button `title={foldTitle}`.

- [ ] **Step 6: Say it in the changelog**

In `CHANGELOG.md`, append to the bullet Task 3 wrote (same paragraph, after "…at the same size and place."):

```markdown
  On macOS `⌘M` folds too. **Settings → General → Window → Minimize** sends minimize to the Dock or taskbar instead.
```

- [ ] **Step 7: Check everything this task touched**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
Run: `npx vitest run frontend/app/view/agents/` → PASS.
Run: `grep -rn "FLOAT_MINIMIZE_EVENT\|float-minimize" frontend src-tauri/src` → nothing.
Run: `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml` → PASS.
Run: `npx eslint frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/float-bar.tsx frontend/app/view/agents/floatstore.ts frontend/app/view/agents/macwindow.ts frontend/app/view/agents/settingspages/general.tsx frontend/app/view/agents/settingsmodel.ts`
and the same paths with `npx prettier --check` → clean. `gofmt -l pkg/wconfig/settingsconfig.go` → nothing.

- [ ] **Step 8: Commit**

```bash
git add pkg/wconfig frontend/types/gotypes.d.ts schema src-tauri/src/macwindow.rs src-tauri/Cargo.toml src-tauri/Cargo.lock frontend/app/view/agents/macwindow.ts frontend/app/view/agents/floatstore.ts frontend/app/cockpit/app-bar.tsx frontend/app/cockpit/float-bar.tsx frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingsmodel.test.ts frontend/app/view/agents/settingspages/general.tsx CHANGELOG.md
git commit -m "feat(window): minimize and ⌘M fold into Sprout in every size; Settings → General → Window puts the Dock back"
```

(`git status --short` first: add only what `task generate` actually changed; `Cargo.lock` only if it changed.)

---

## Phase 2: Sprout everywhere

### Task 5: Sprout walks a ledge in Float

**Files:**
- Create: `frontend/app/cockpit/float-ledge.tsx`
- Modify: `frontend/app/view/jarvis/petledge.ts`, `frontend/app/view/jarvis/petledge.test.ts:29-38`
- Modify: `frontend/app/view/jarvis/petview.tsx` (`readLedge`, `run`, `PetView`, `PetSprite`, `usePetSignals` comment)
- Modify: `frontend/app/cockpit/cockpit-root.tsx` (footer and `PetView` lines), `frontend/app/cockpit/float-bar.tsx`
- Modify: `frontend/app/view/jarvis/petwalk.ts:109` (comment)
- Delete: `frontend/app/view/jarvis/petfloatmark.tsx`, `frontend/app/view/jarvis/petfloat.ts`,
  `frontend/app/view/jarvis/petfloat.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces (petledge.ts): `interface LedgeBox extends Box { holds?: boolean }`, `MeasuredLedge` gains `holds: boolean`,
  `LEDGE_HOLD_PAD_PX = 2`, `measureLedge(ledgeBoxes: readonly LedgeBox[], navRight, viewport)`.
- Produces (petview.tsx): `useWaitingCount(model: AgentsViewModel): number`.
- Produces (DOM): `[data-pet-ledge-holds]` on the float ledge.

- [ ] **Step 1: Write the failing ledge tests**

In `frontend/app/view/jarvis/petledge.test.ts`, the three existing `measureLedge(…)` expectations gain `holds: false`
(`{ top: 872, left: 78, right: 1592, holds: false }`, `{ top: 860, left: 90, right: 1240, holds: false }`,
`{ top: 900, left: 0, right: 1592, holds: false }`). Add `LEDGE_HOLD_PAD_PX` to the import from `./petledge` and add:

```ts
describe("a ledge that holds the sprite", () => {
    // Float's 52px ledge under the terminal (cockpit/float-ledge.tsx)
    const ledge = { left: 0, top: 408, right: 720, bottom: 460, holds: true };
    it("stands the sprite inside it, just above its bottom", () => {
        expect(measureLedge([ledge], null, { width: 720, height: 460 })).toEqual({
            top: 460 - LEDGE_HOLD_PAD_PX,
            left: 0,
            right: 712,
            holds: true,
        });
    });
    it("is an edge like any other without the mark", () => {
        expect(measureLedge([{ ...ledge, holds: false }], null, { width: 720, height: 460 }).top).toBe(408);
    });
});
```

Run: `npx vitest run frontend/app/view/jarvis/petledge.test.ts`
Expected: FAIL (`holds` missing, `LEDGE_HOLD_PAD_PX` not exported).

- [ ] **Step 2: Teach `petledge.ts` a ledge that holds the sprite**

After `export interface Box { … }`, add:

```ts
// A ledge element's box, and whether the ledge holds the whole sprite (Float's, cockpit/float-ledge.tsx): the sprite
// stands inside it rather than on its top edge, and nothing above it is in its way.
export interface LedgeBox extends Box {
    holds?: boolean;
}
```

`MeasuredLedge` gains a field:

```ts
    // the ledge holds the sprite, so there is nothing to avoid (avoidSpans does not apply)
    holds: boolean;
```

After `LEDGE_RIGHT_INSET_PX`, add:

```ts
// A ledge that holds the sprite stands it this far above its bottom.
export const LEDGE_HOLD_PAD_PX = 2;
```

`lowestLedge`'s signature becomes `export function lowestLedge<B extends Box>(boxes: readonly B[]): B | null` (body
unchanged, `let best: B | null = null;`). `measureLedge` becomes:

```ts
export function measureLedge(
    ledgeBoxes: readonly LedgeBox[],
    navRight: number | null,
    viewport: { width: number; height: number }
): MeasuredLedge {
    const lowest = lowestLedge(ledgeBoxes);
    const left = navRight ?? 0;
    const right = viewport.width - LEDGE_RIGHT_INSET_PX;
    if (lowest == null) {
        return { top: viewport.height, left, right, holds: false };
    }
    const holds = lowest.holds === true;
    return {
        top: holds ? lowest.bottom - LEDGE_HOLD_PAD_PX : lowest.top,
        left: Math.max(left, lowest.left),
        right: Math.min(right, lowest.right),
        holds,
    };
}
```

and its doc comment gains the sentence: "A ledge that holds the sprite (`holds`) stands it inside, LEDGE_HOLD_PAD_PX above
its bottom."

Run: `npx vitest run frontend/app/view/jarvis/petledge.test.ts` → PASS.

- [ ] **Step 3: Create the ledge**

`frontend/app/cockpit/float-ledge.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The floor Sprout walks in Float (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2): 52px under the
// terminal, tall enough to hold the whole 48px sprite, so Sprout never stands on the terminal's prompt
// (petledge.ts LedgeBox.holds). A press on it drags the window, like the float bar.
export function FloatLedge() {
    return (
        <div
            data-pet-ledge
            data-pet-ledge-holds
            data-tauri-drag-region
            className="h-[52px] shrink-0 border-t border-border bg-surface"
        />
    );
}
```

- [ ] **Step 4: Measure it, skip avoidance on it, and draw the count chip in Float**

In `frontend/app/view/jarvis/petview.tsx`:

- imports: add `floatModeAtom` beside `floatMiniAtom`; add `import { channelMessagesAtom } from
  "@/app/view/agents/channelsstore";`, `import { queueRows } from "./petpeekmodel";`, `useMemo` to the `react` import,
  and `type LedgeBox` to the `./petledge` import;
- `usePetSignals`'s comment becomes `// Every signal the creature reads. Shared with the folded Sprout
  (cockpit/sprout-mini.tsx).`; add after `usePetSignals`:

```ts
// How many things wait on you, the count on Sprout's chip in Float and folded (the nav badge's in Full)
export function useWaitingCount(model: AgentsViewModel): number {
    const items = useAtomValue(attentionAtom);
    const agents = useAtomValue(model.agentsAtom);
    const messages = useAtomValue(channelMessagesAtom);
    return useMemo(() => queueRows(items, agents, messages).length, [items, agents, messages]);
}
```

- `readLedge` becomes:

```ts
function readLedge(): MeasuredLedge {
    const boxes = Array.from(document.querySelectorAll("[data-pet-ledge]"), (e): LedgeBox => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, holds: e.hasAttribute("data-pet-ledge-holds") };
    });
    // the nav rail's <nav> is the app's only one
    const nav = document.querySelector("nav")?.getBoundingClientRect();
    return measureLedge(boxes, nav != null && nav.width > 0 ? nav.right : null, {
        width: window.innerWidth,
        height: window.innerHeight,
    });
}
```

- in `run`, `const avoid = readAvoid(ledge.top);` becomes:

```ts
        // a ledge that holds the sprite keeps it off the terminal already
        const avoid = ledge.holds ? [] : readAvoid(ledge.top);
```

- in `PetView`, after `const folded = …`, add:

```ts
    // in Float the nav badge is gone: the count of what waits rides beside Sprout
    const floating = useAtomValue(floatModeAtom);
    const waiting = useWaitingCount(model);
```

  and pass `chip={floating && waiting > 0 ? waiting : null}` to `<PetSprite`;
- `PetSprite` takes the prop (`chip: number | null;` in its props type, with the comment `// the count chip, Float
  only`) and, inside the `motion.div`, after the closing `</motion.svg>`, draws:

```tsx
            {chip != null ? (
                <span className="pointer-events-none absolute -left-1 top-1 min-w-4 rounded-full bg-warning px-1 text-center text-[10px] font-bold leading-4 text-on-warning tabular-nums">
                    {chip}
                </span>
            ) : null}
```

- [ ] **Step 5: Mount Sprout and its ledge in Float, and drop the still mark**

In `frontend/app/cockpit/cockpit-root.tsx`:

- add `import { FloatLedge } from "./float-ledge";`;
- the comment above `const floating` becomes `// in Float the window is the focused terminal: the float bar stands in for the
  app bar and a ledge for the footer, which Sprout walks`;
- `{floating ? null : <HintsFooter model={model} />}` becomes
  `{floating ? <FloatLedge /> : <HintsFooter model={model} />}`;
- `{floating ? null : <PetView model={model} />}` becomes `<PetView model={model} />` (keep the comment above it).

In `frontend/app/cockpit/float-bar.tsx`, delete the `PetFloatMark` import, and delete the two lines
`{/* the footer and its walking pet are gone in float mode; what waits on you shows here */}` and
`<PetFloatMark model={model} />`.

Delete the still mark: `git rm frontend/app/view/jarvis/petfloatmark.tsx frontend/app/view/jarvis/petfloat.ts
frontend/app/view/jarvis/petfloat.test.ts`.

In `frontend/app/view/jarvis/petwalk.ts`, the comment `// the mark a posture draws over the creature's head, shared
with the float bar's still Sprout (petfloat.ts)` becomes `// the mark a posture draws over the creature's head, shared
with the folded Sprout (petmini.ts)`.

Run: `grep -rn "petfloat\b\|petfloat\"\|PetFloatMark\|floatMarkSprite" frontend/app` → only the comment in
`petpeek.tsx` that names `petfloatmark.tsx` (leave it: phase 3 replaces the peek).

- [ ] **Step 6: Say it in the changelog**

In `CHANGELOG.md` under `## Unreleased` / `### Added`, after the Sprout bullet, add:

```markdown
- In a float, Sprout walks a ledge under the terminal, with a count of what waits on you; click it for the Jarvis chat.
```

- [ ] **Step 7: Check and commit**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
Run: `npx vitest run frontend/app/view/jarvis/` → PASS.
Run: `npx eslint` and `npx prettier --check` on `frontend/app/cockpit/float-ledge.tsx frontend/app/cockpit/cockpit-root.tsx
frontend/app/cockpit/float-bar.tsx frontend/app/view/jarvis/petview.tsx frontend/app/view/jarvis/petledge.ts
frontend/app/view/jarvis/petledge.test.ts` → clean.

```bash
git add -A frontend/app/cockpit/float-ledge.tsx frontend/app/cockpit/cockpit-root.tsx frontend/app/cockpit/float-bar.tsx frontend/app/view/jarvis CHANGELOG.md
git commit -m "feat(float): Sprout walks a 52px ledge under the float's terminal, with the waiting count beside it"
```

---

### Task 6: The float bar's agent switcher

**Files:**
- Create: `frontend/app/view/agents/sproutroster.ts`, `frontend/app/view/agents/sproutroster.test.ts`
- Modify: `frontend/app/cockpit/float-bar.tsx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: `interface RosterCut { shown: AgentVM[]; more: number }`, `SWITCHER_MAX = 6`, `FOLDED_LIST_MAX = 4`,
  `switcherAgents(agents, terminals, focusId: string | null, max = SWITCHER_MAX): RosterCut`,
  `foldedList(agents, terminals, focusId: string | null, max = FOLDED_LIST_MAX): RosterCut` (Task 7 uses it).
- Produces (DOM): `[data-float-switcher]`, `[data-float-switch="<id>"]`.

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/agents/sproutroster.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { foldedList, switcherAgents } from "./sproutroster";

const a = (id: string, state: AgentVM["state"], kind?: string): AgentVM =>
    ({ id, name: id, task: "", state, kind }) as AgentVM;
const ids = (list: AgentVM[]) => list.map((x) => x.id);

describe("switcherAgents", () => {
    it("lists every agent in roster order", () => {
        const agents = [a("x", "idle"), a("y", "asking"), a("z", "working")];
        expect(switcherAgents(agents, [], "x")).toEqual({ shown: agents, more: 0 });
    });
    it("leads with a floated terminal, which is not an agent", () => {
        expect(ids(switcherAgents([a("x", "idle")], [a("t", "idle", "terminal")], "t").shown)).toEqual(["t", "x"]);
    });
    it("cuts at six and counts the rest", () => {
        const agents = "abcdefgh".split("").map((id) => a(id, "idle"));
        const cut = switcherAgents(agents, [], "a");
        expect(ids(cut.shown)).toEqual(["a", "b", "c", "d", "e", "f"]);
        expect(cut.more).toBe(2);
    });
    it("keeps the agent in view among the dots past the cut", () => {
        const agents = "abcdefgh".split("").map((id) => a(id, "idle"));
        expect(ids(switcherAgents(agents, [], "h").shown)).toEqual(["a", "b", "c", "d", "e", "h"]);
    });
});

describe("foldedList", () => {
    it("puts what needs you first, then what works, each in roster order", () => {
        const agents = [a("i1", "idle"), a("w1", "working"), a("q1", "asking"), a("w2", "working"), a("q2", "asking")];
        expect(ids(foldedList(agents, [], null).shown)).toEqual(["q1", "q2", "w1", "w2"]);
    });
    it("shows four and counts the rest as +N", () => {
        const agents = [a("i1", "idle"), ...["a", "b", "c", "d"].map((id) => a(id, "working"))];
        const list = foldedList(agents, [], null);
        expect(ids(list.shown)).toEqual(["a", "b", "c", "d"]);
        expect(list.more).toBe(1);
    });
    it("lists a floated terminal too", () => {
        expect(ids(foldedList([a("x", "idle")], [a("t", "idle", "terminal")], "t").shown)).toEqual(["t", "x"]);
    });
    it("is empty with no agents", () => expect(foldedList([], [], null)).toEqual({ shown: [], more: 0 }));
});
```

Run: `npx vitest run frontend/app/view/agents/sproutroster.test.ts` → FAIL (module missing).

- [ ] **Step 2: Write `sproutroster.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agents Sprout's two lists show (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2): the float bar's
// switcher, one dot an agent, and the folded Sprout's hover list. Pure.

import type { AgentState, AgentVM } from "./agentsviewmodel";

export interface RosterCut {
    shown: AgentVM[];
    // how many there are past the cut ("+N")
    more: number;
}

export const SWITCHER_MAX = 6;
export const FOLDED_LIST_MAX = 4;

// the agents, led by the terminal in view when a terminal is what floats
function roster(agents: readonly AgentVM[], terminals: readonly AgentVM[], focusId: string | null): AgentVM[] {
    const term = focusId == null ? undefined : terminals.find((t) => t.id === focusId);
    return term != null && !agents.some((x) => x.id === term.id) ? [term, ...agents] : [...agents];
}

// cut at max, keeping keepId among those shown: past the cut, it takes the last place
function cut(list: AgentVM[], max: number, keepId: string | null): RosterCut {
    if (list.length <= max) {
        return { shown: list, more: 0 };
    }
    const shown = list.slice(0, max);
    const kept = keepId == null ? -1 : list.findIndex((x) => x.id === keepId);
    if (kept >= max) {
        shown[max - 1] = list[kept];
    }
    return { shown, more: list.length - max };
}

/** The float bar's switcher: roster order, which stays put as states change, so a dot stays where it was; the agent in
 *  view is always among the dots. */
export function switcherAgents(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    max = SWITCHER_MAX
): RosterCut {
    return cut(roster(agents, terminals, focusId), max, focusId);
}

const URGENCY: Record<AgentState, number> = { asking: 0, working: 1, idle: 2 };

/** The folded Sprout's list: what needs you first, then what works, then the rest, each in roster order, cut at four so
 *  nothing that waits on you hides behind "+N". */
export function foldedList(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    max = FOLDED_LIST_MAX
): RosterCut {
    const ranked = roster(agents, terminals, focusId)
        .map((agent, i) => ({ agent, i }))
        .sort((p, q) => URGENCY[p.agent.state] - URGENCY[q.agent.state] || p.i - q.i)
        .map((r) => r.agent);
    return cut(ranked, max, null);
}
```

Run: `npx vitest run frontend/app/view/agents/sproutroster.test.ts` → PASS.

- [ ] **Step 3: Draw the dots on the float bar**

In `frontend/app/cockpit/float-bar.tsx`:

- imports: add `import { switcherAgents } from "@/app/view/agents/sproutroster";` and `useMemo` from `react`;
- after the `const agent = …` line, add:

```ts
    const roster = useMemo(() => switcherAgents(agents, terminals, focusId ?? null), [agents, terminals, focusId]);
    // a dot shows that agent's terminal: Float shows the focused one
    const show = (id: string) => model.openTerminal(id);
```

- after the left `<div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">…</div>` group's
  closing `</div>`, insert (before the Sprout button):

```tsx
            {roster.shown.length > 1 ? (
                <span data-float-switcher className="flex flex-none items-center gap-0.5">
                    {roster.shown.map((a) => {
                        const state = a.state === "asking" ? askingLabel(a) : STATE_LABEL[a.state];
                        return (
                            <button
                                key={a.id}
                                type="button"
                                data-float-switch={a.id}
                                aria-label={`${a.name}, ${state}`}
                                aria-pressed={a.id === focusId}
                                title={`${a.name} · ${state}`}
                                onClick={() => show(a.id)}
                                className={cn(
                                    "flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    a.id === focusId && "bg-surface-hover ring-1 ring-edge-mid"
                                )}
                            >
                                <StatusDot state={a.state} />
                            </button>
                        );
                    })}
                    {roster.more > 0 ? (
                        <span className="pl-1 text-[11px] text-muted tabular-nums">+{roster.more}</span>
                    ) : null}
                </span>
            ) : null}
```

(`focusIdAtom` is `string | undefined`, hence the `?? null`.)

- [ ] **Step 4: Say it in the changelog**

Extend the float bullet Task 5 added to:

```markdown
- In a float, Sprout walks a ledge under the terminal, with a count of what waits on you; click it for the Jarvis chat.
  Dots on the float bar, one an agent, switch the float to another agent's terminal.
```

- [ ] **Step 5: Check and commit**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
Run: `npx eslint` and `npx prettier --check` on `frontend/app/cockpit/float-bar.tsx
frontend/app/view/agents/sproutroster.ts frontend/app/view/agents/sproutroster.test.ts` → clean.

```bash
git add frontend/app/view/agents/sproutroster.ts frontend/app/view/agents/sproutroster.test.ts frontend/app/cockpit/float-bar.tsx CHANGELOG.md
git commit -m "feat(float): dots on the float bar switch the float to another agent's terminal"
```

---

### Task 7: The folded Sprout lists every agent and speaks in bubbles

**Files:**
- Modify: `frontend/app/cockpit/sprout-mini.tsx` (whole file)
- Modify: `frontend/app/view/jarvis/petbubble.tsx` (`PetBubble` props, placement, origin, shadow)
- Modify: `frontend/app/view/jarvis/petview.tsx` (bubble helpers)
- Modify: `frontend/app/view/agents/miniclickthrough.ts` (hover selector, header comment)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `foldedList` (Task 6), `useWaitingCount` (Task 5), `restoreFromSprout`, `foldOriginAtom` (Task 2).
- Produces: `PetBubble` gains `placement?: Placement` and `flat?: boolean`, and carries `data-mini-hit="bubble"`;
  petview.tsx exports `openPetBubble(): void` and `dismissPetBubble(): void`; DOM `[data-mini-hit="agents"]`,
  `[data-mini-agent="<id>"]`.

- [ ] **Step 1: Let the bubble open any way and lie flat**

In `frontend/app/view/jarvis/petbubble.tsx`:

- delete the `ORIGIN` record and add instead:

```ts
// the corner a bubble grows from: its edge on the anchor's side, at the aligned end
function originOf(p: Placement): string {
    const [side, align] = p.split("-");
    return `${side === "top" ? "bottom" : "top"} ${align === "start" ? "left" : "right"}`;
}
```

- `PetBubble`'s props gain, after `corner: PetCorner;`:

```ts
    // folded (cockpit/sprout-mini.tsx): which way from Sprout it opens, and no drop shadow over the app behind
    placement?: Placement;
    flat?: boolean;
```

  (destructure them as `placement, flat`);
- before `useFloating`, add `const where = placement ?? PLACEMENT[corner];` and use `placement: where` in it;
- the floating `div` becomes `<div ref={refs.setFloating} data-mini-hit="bubble" style={floatingStyles}
  className="z-[61]">` with the comment `{/* data-mini-hit: folded, the click-through poll lets the cursor reach it
  (miniclickthrough.ts) */}` above it;
- `PopoverReveal`'s `origin={ORIGIN[corner]}` becomes `origin={originOf(where)}`, and its `className` becomes:

```tsx
                className={cn(
                    "w-[268px] rounded-[12px] border bg-surface-raised has-[button:hover]:border-edge-strong",
                    flat ? "border-edge-strong" : "border-border shadow-popover-md"
                )}
```

- [ ] **Step 2: Share the bubble's click and dismiss**

In `frontend/app/view/jarvis/petview.tsx`, add after `useWaitingCount`:

```ts
// A click on the bubble: a quote is not news, so clicking it only puts it away; anything else opens the chat.
export function openPetBubble(): void {
    if (globalStore.get(petBubbleAtom)?.kind === "quote") {
        globalStore.set(petBubbleAtom, null);
        return;
    }
    openPetPeek();
}

// The bubble's time ran out or its × was pressed: what it said stays unread, a quote leaves nothing behind.
export function dismissPetBubble(): void {
    const said = globalStore.get(petBubbleAtom);
    globalStore.set(petBubbleAtom, null);
    if (said?.kind !== "quote") {
        globalStore.set(petUnreadAtom, true);
    }
}
```

In `PetView`, replace the `openPeek` `useCallback` body with `openPetBubble` (`const openPeek = useCallback(openPetBubble,
[]);`, keeping its comment) and the `<PetBubble onDismiss={() => {…}}` arrow with `onDismiss={dismissPetBubble}`.

- [ ] **Step 3: Hold the hover over the list**

In `frontend/app/view/agents/miniclickthrough.ts`, the header's "While the float is folded into Sprout" becomes "While
the window is folded into Sprout", and

```ts
            const onSprout = hitAny(p, boxes('[data-mini-hit="sprout"], [data-mini-hit="chip"]'));
```

becomes

```ts
            // the agent list stays while the cursor travels from Sprout to it
            const onSprout = hitAny(p, boxes('[data-mini-hit="sprout"], [data-mini-hit="agents"]'));
```

and `HOVER_LEAVE_MS`'s comment becomes `// the agent list stays this long after the cursor leaves Sprout, so the cursor can
travel to it`.

- [ ] **Step 4: Rewrite `sprout-mini.tsx`**

Replace the whole file with:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window folded into Sprout (floatstore.ts foldToSprout): the see-through window holds only this. Sprout, the same
// 48px as on the footer and the float's ledge, sits in the window's corner away from where things open (floatwindow.ts
// miniSides), bobs, wears what waits on you (petmini.ts), and is dragged by a press that moves. Hovered, it lists the
// agents (a click floats on one) and Restore; a click opens the Jarvis chat (the pet peek); a double-click restores the
// size it was folded from. What Sprout says (petBubbleAtom), and a reply that landed while the chat was folded, show in
// a bubble beside it.
// Every element the cursor may use carries data-mini-hit, or the click-through poll lets clicks fall through it. Nothing
// here carries a title or a drop shadow, and Sprout has no ground shadow: over a light app behind the see-through
// window, they read as dark smears. A border keeps each one apart from what is behind it.

import { globalStore } from "@/app/store/jotaiStore";
import { STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import {
    foldOriginAtom,
    miniResizingAtom,
    miniSidesAtom,
    resizeMini,
    restoreFromSprout,
} from "@/app/view/agents/floatstore";
import type { MiniSides } from "@/app/view/agents/floatwindow";
import { miniHoverAtom } from "@/app/view/agents/miniclickthrough";
import { foldedList } from "@/app/view/agents/sproutroster";
import { StatusDot } from "@/app/view/agents/statusdot";
import { closePeek, openPetPeek } from "@/app/view/jarvis/peekstore";
import { PetBubble } from "@/app/view/jarvis/petbubble";
import { postureFor } from "@/app/view/jarvis/petcondition";
import { miniLook, nextUnread } from "@/app/view/jarvis/petmini";
import { petOutfit, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { PetPeek } from "@/app/view/jarvis/petpeek";
import { PET_CELL_PX, spriteFor } from "@/app/view/jarvis/petsprite";
import { petBubbleAtom, petErrandAtom, petOutfitChoiceAtom, petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { dismissPetBubble, openPetBubble, usePetSignals, useWaitingCount } from "@/app/view/jarvis/petview";
import { SproutSvg } from "@/app/view/jarvis/sproutsvg";
import { cn, fireAndForget } from "@/util/util";
import type { Placement } from "@floating-ui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { PictureInPicture2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const BOB_MS = 700;
const DRAG_PX = 4;
// a second click inside this is a double-click, which restores rather than opens
const CLICK_MS = 220;
// Spike result 1 or 2 failed on a platform: draw Sprout on a tile there (make this `isWindows()` or `isMacOS()`)
const MINI_TILE = false;

// a reply that landed while the chat was folded (petmini.ts nextUnread)
const miniUnreadAtom = atom(false) as PrimitiveAtom<boolean>;

function useBobFrame(): 0 | 1 {
    const [frame, setFrame] = useState<0 | 1>(0);
    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), BOB_MS);
        return () => clearInterval(t);
    }, []);
    return frame;
}

// Sprout's 64px box: the window's corner away from where the list, the bubble and the chat open
function boxCorner(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-0" : "left-0", sides.v === "up" ? "bottom-0" : "top-0");
}

// the list and the reply bubble: beside Sprout toward the middle of the screen, level with its feet or its head
export function besideSprout(sides: MiniSides): string {
    return cn(sides.h === "left" ? "right-[72px]" : "left-[72px]", sides.v === "up" ? "bottom-2" : "top-2");
}

// the chat and what Sprout says: above or below it, toward the middle of the screen
function openPlacement(sides: MiniSides): Placement {
    return `${sides.v === "up" ? "top" : "bottom"}-${sides.h === "left" ? "end" : "start"}`;
}

const ROW =
    "flex cursor-pointer items-center gap-2 rounded-[7px] px-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function SproutMini({ model }: { model: AgentsViewModel }) {
    const signals = usePetSignals(model);
    const sides = useAtomValue(miniSidesAtom);
    const resizing = useAtomValue(miniResizingAtom);
    const hovered = useAtomValue(miniHoverAtom);
    const chatOpen = useAtomValue(petPeekOpenAtom);
    const errand = useAtomValue(petErrandAtom);
    const unread = useAtomValue(miniUnreadAtom);
    const bubble = useAtomValue(petBubbleAtom);
    const origin = useAtomValue(foldOriginAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const outfitChoice = useAtomValue(petOutfitChoiceAtom);
    const frame = useBobFrame();
    const waiting = useWaitingCount(model);
    const look = miniLook({ posture: postureFor(signals), waiting, errand, unread, chatOpen, frame });
    const sprite = spriteFor(look.pose, look.marks, petOutfit(petOutfitChoice(outfitChoice), new Date()));
    const list = useMemo(() => foldedList(agents, terminals, focusId ?? null), [agents, terminals, focusId]);
    // state, not a ref: the chat and the bubble position themselves once this lands
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const dragged = useRef(false);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // the reply's unread mark follows the errand and the chat; the chat's opening and closing size the window
    useEffect(() => {
        // a fold starts with nothing unread: a reply read before it is not news again
        globalStore.set(miniUnreadAtom, false);
        let prev = globalStore.get(petErrandAtom);
        const step = () => {
            const next = globalStore.get(petErrandAtom);
            globalStore.set(
                miniUnreadAtom,
                nextUnread(prev, next, globalStore.get(petPeekOpenAtom), globalStore.get(miniUnreadAtom))
            );
            prev = next;
        };
        const unErrand = globalStore.sub(petErrandAtom, step);
        const unOpen = globalStore.sub(petPeekOpenAtom, () => {
            step();
            void resizeMini(globalStore.get(petPeekOpenAtom)).catch((e) => console.error("sizing the chat failed", e));
        });
        return () => {
            unErrand();
            unOpen();
            clearTimeout(clickTimer.current);
        };
    }, []);

    const onPointerDown = (e: ReactPointerEvent) => {
        if (e.button !== 0) {
            return;
        }
        dragged.current = false;
        const start = { x: e.screenX, y: e.screenY };
        const move = (ev: PointerEvent) => {
            if (Math.hypot(ev.screenX - start.x, ev.screenY - start.y) < DRAG_PX) {
                return;
            }
            stop();
            dragged.current = true;
            fireAndForget(() => getCurrentWindow().startDragging());
        };
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    };
    const onClick = () => {
        if (dragged.current) {
            dragged.current = false;
            return;
        }
        clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(
            () => (globalStore.get(petPeekOpenAtom) ? closePeek() : openPetPeek()),
            CLICK_MS
        );
    };
    // to the size it was folded from, or to Float on an agent picked in the list
    const restore = (agentId?: string) => {
        clearTimeout(clickTimer.current);
        fireAndForget(() => restoreFromSprout(model, agentId));
    };
    const speaking = bubble != null && !chatOpen;
    const told = unread && !chatOpen && errand != null && !speaking;
    const fromFloat = origin !== "full";

    return (
        <div data-sprout-mini className={cn("fixed inset-0", resizing && "opacity-0")}>
            <div
                data-mini-hit="sprout"
                className={cn(
                    "absolute h-16 w-16",
                    boxCorner(sides),
                    MINI_TILE && "rounded-[18px] border border-edge-strong bg-surface"
                )}
            >
                <button
                    ref={setAnchor}
                    type="button"
                    aria-label={look.label}
                    aria-expanded={chatOpen}
                    onPointerDown={onPointerDown}
                    onClick={onClick}
                    onDoubleClick={() => restore()}
                    className={cn(
                        "absolute left-2 top-2 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        chatOpen && "bg-accentbg",
                        look.bob && "-translate-y-1"
                    )}
                >
                    <SproutSvg sprite={sprite} cellPx={PET_CELL_PX} />
                </button>
                {look.chip != null ? (
                    <span className="pointer-events-none absolute left-1 top-3 min-w-4 rounded-full bg-warning px-1 text-center text-[10px] font-bold leading-4 text-on-warning tabular-nums">
                        {look.chip}
                    </span>
                ) : null}
            </div>

            {told ? (
                <div
                    data-mini-hit="bubble"
                    role="button"
                    tabIndex={0}
                    aria-label="Open the reply"
                    onClick={openPetPeek}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openPetPeek();
                        }
                    }}
                    className={cn(
                        "absolute flex w-[240px] cursor-pointer flex-col gap-1 rounded-[12px] border border-edge-mid bg-surface-raised px-2.5 pb-[9px] pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        besideSprout(sides)
                    )}
                >
                    <div className="flex items-center gap-1.5 text-[9.5px] text-muted">
                        <span
                            className={cn(
                                "h-[5px] w-[5px] rounded-full",
                                errand.status === "error" ? "bg-error" : "bg-success"
                            )}
                        />
                        <span className="flex-1">
                            {errand.runtime} · {errand.status === "error" ? "failed" : "replied"}
                        </span>
                        <button
                            type="button"
                            aria-label="Dismiss the reply"
                            onClick={(e) => {
                                e.stopPropagation();
                                globalStore.set(miniUnreadAtom, false);
                            }}
                            className="flex cursor-pointer rounded-[5px] p-0.5 text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <X size={11} strokeWidth={2.2} aria-hidden />
                        </button>
                    </div>
                    <div className="line-clamp-3 text-[11.5px] leading-[1.5] text-secondary [overflow-wrap:anywhere]">
                        {errand.text}
                    </div>
                </div>
            ) : null}

            {hovered && !chatOpen && !told && !speaking ? (
                <div
                    data-mini-hit="agents"
                    className={cn(
                        "absolute flex w-[236px] flex-col rounded-[12px] border border-edge-mid bg-surface-raised p-1.5",
                        besideSprout(sides)
                    )}
                >
                    {list.shown.map((a) => (
                        <button
                            key={a.id}
                            type="button"
                            data-mini-agent={a.id}
                            aria-label={`Float on ${a.name}`}
                            onClick={() => restore(a.id)}
                            className={cn(ROW, "h-[30px] text-[12px] text-primary")}
                        >
                            <StatusDot state={a.state} />
                            <span className="min-w-0 flex-1 truncate">{a.name}</span>
                            {a.kind !== "terminal" ? (
                                <span className="text-[11px]" style={{ color: STATE_COLOR[a.state] }}>
                                    {a.state === "asking" ? askingLabel(a) : STATE_LABEL[a.state]}
                                </span>
                            ) : null}
                        </button>
                    ))}
                    {list.more > 0 ? (
                        <span className="flex h-[26px] items-center px-2 text-[11px] text-muted tabular-nums">
                            +{list.more} more
                        </span>
                    ) : null}
                    {list.shown.length > 0 ? <span aria-hidden className="mx-1 my-1 h-px bg-border" /> : null}
                    <button
                        type="button"
                        data-mini-restore
                        aria-label={fromFloat ? "Restore the float window" : "Restore the window"}
                        onClick={() => restore()}
                        className={cn(ROW, "h-7 gap-1.5 text-[11.5px] font-semibold text-secondary hover:text-primary")}
                    >
                        <PictureInPicture2 size={12} strokeWidth={2} aria-hidden />
                        {fromFloat ? "Restore float" : "Restore window"}
                        <span className="ml-auto text-[10.5px] font-medium text-muted">double-click</span>
                    </button>
                </div>
            ) : null}

            <PetBubble
                event={chatOpen ? null : bubble}
                anchor={anchor}
                corner="bottom-right"
                placement={openPlacement(sides)}
                flat
                onOpen={openPetBubble}
                onDismiss={dismissPetBubble}
            />

            <PetPeek
                model={model}
                anchor={anchor}
                corner="mini"
                placement={openPlacement(sides)}
                signals={signals}
                onRestore={() => restore()}
            />
        </div>
    );
}
```

(`useMemo` now only wraps the list; `queueRows`, `attentionAtom`, `channelMessagesAtom` are no longer imported here.)

- [ ] **Step 5: Say it in the changelog**

Extend the Sprout bullet (Task 3/4) by inserting, after "Sprout floats over your other apps;":
` hover it to see every agent and float on one;`

- [ ] **Step 6: Check and commit**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
Run: `npx vitest run frontend/app/view/jarvis/ frontend/app/view/agents/` → PASS.
Run: `npx eslint` and `npx prettier --check` on `frontend/app/cockpit/sprout-mini.tsx
frontend/app/view/jarvis/petbubble.tsx frontend/app/view/jarvis/petview.tsx frontend/app/view/agents/miniclickthrough.ts`
→ clean.

```bash
git add frontend/app/cockpit/sprout-mini.tsx frontend/app/view/jarvis/petbubble.tsx frontend/app/view/jarvis/petview.tsx frontend/app/view/agents/miniclickthrough.ts CHANGELOG.md
git commit -m "feat(float): the folded Sprout lists every agent, speaks in its own bubble, and casts no shadow"
```

---

### Task 8: Sprout's bubbles instead of toasts in Float and folded

**Files:**
- Modify: `frontend/app/view/agents/notifyevents.ts` (`RouteCtx`, `routeNotify`, `toastSaysAsk`, `petEventOfNeeds`),
  `frontend/app/view/agents/notifyevents.test.ts`
- Modify: `frontend/app/view/agents/notifysync.tsx`
- Modify: `frontend/app/view/jarvis/petjoin.ts` (`AskGateCtx`, `shouldSpeakAsk`), `frontend/app/view/jarvis/petjoin.test.ts`
- Modify: `frontend/app/view/jarvis/petsources.tsx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `WindowSize`, `windowSize` (Task 1); `floatMiniAtom` (floatstore).
- Produces: `RouteCtx.size: WindowSize` (replaces `floating`); `petEventOf(e: NotifyEvent, nowMs: number): PetEvent |
  null` (replaces `petEventOfNeeds`); `AskGateCtx.folded: boolean` (replaces `toastSays`). Removed: `toastSaysAsk`.

- [ ] **Step 1: Write the failing routing tests**

In `frontend/app/view/agents/notifyevents.test.ts`:

- the import list: drop `toastSaysAsk`, rename `petEventOfNeeds` to `petEventOf`;
- the `ctx` helper's `floating: false,` becomes `size: "full",`;
- in `describe("routeNotify")`, replace the two "while floating" tests (and their comment) with:

```ts
    // in Float, Sprout walks the ledge and says what a toast said, a finished turn included
    it("leaves a request in Float to Sprout", () => expect(routeNotify(ev("request"), ctx({ size: "float" }))).toBe("avatar"));
    it("leaves a wsh notify in Float to Sprout", () =>
        expect(routeNotify(ev("notify"), ctx({ size: "float" }))).toBe("avatar"));
    it("says a finished turn in Float as Sprout's bubble", () =>
        expect(routeNotify(ev("reply"), ctx({ size: "float" }))).toBe("avatar"));
    it("still sends a backgrounded Float's news to the OS", () =>
        expect(routeNotify(ev("request"), ctx({ size: "float", focused: false }))).toBe("os"));
    // folded, Sprout floats over every app: it says everything, whichever app is in front
    it("sends everything to the folded Sprout, focused or not", () => {
        for (const kind of ["request", "reply", "notify", "attention"] as const) {
            expect(routeNotify(ev(kind), ctx({ size: "sprout", focused: false }))).toBe("avatar");
            expect(routeNotify(ev(kind), ctx({ size: "sprout" }))).toBe("avatar");
        }
    });
    // the floated terminal is hidden while folded: its agent is not in view
    it("has nothing in view while folded", () =>
        expect(routeNotify(ev("request"), ctx({ size: "sprout", viewing: new Set(["a"]) }))).toBe("avatar"));
    it("honours notify:reply off while folded", () =>
        expect(
            routeNotify(ev("reply"), ctx({ size: "sprout", settings: { os: true, toast: true, reply: false } }))
        ).toBe("none"));
```

- delete the whole `describe("toastSaysAsk", …)` block;
- the `describe("petEventOfNeeds", …)` block becomes `describe("petEventOf", …)` with `petEventOfNeeds(` renamed to
  `petEventOf(`, its last test replaced by:

```ts
    // an agent's question and a wsh notify already reach the pet from their own events
    it("leaves an agent's request and a wsh notify to the pet's own sources", () => {
        expect(petEventOf(ev("request"), 1000)).toBeNull();
        expect(petEventOf(ev("notify"), 1000)).toBeNull();
    });

    it("says a finished turn, which opens its agent", () => {
        const done: NotifyEvent = { ...ev("reply", "t1"), title: "loom", body: "Fix the race" };
        expect(petEventOf(done, 1000)).toEqual({
            id: "reply:t1:1000",
            at: 1000,
            kind: "notify",
            text: "loom finished",
            detail: "Fix the race",
            sources: [{ ref: "agent:t1", title: "loom", sourceType: "" }],
        });
    });
```

In `frontend/app/view/jarvis/petjoin.test.ts`, `gateCtx`'s `toastSays: false,` becomes `folded: false,`, and the two
toast tests (from the comment above `it("stays quiet when the in-app toast says the question"` through the end of
`it("speaks when no toast says it…")`) become:

```ts
    // folded, the terminal is hidden: the floated agent's question is Sprout's to say, as any other's
    it("speaks for the agent in focus while folded", () => {
        expect(
            shouldSpeakAsk(
                "block:abc",
                gateCtx({ folded: true, surface: "agent", askTabId: "t1", focusTabId: "t1", focusedBlockId: "abc" })
            )
        ).toBe(true);
    });
```

Run: `npx vitest run frontend/app/view/agents/notifyevents.test.ts frontend/app/view/jarvis/petjoin.test.ts`
Expected: FAIL (type errors on `size`, `folded`; `petEventOf` missing).

- [ ] **Step 2: Route by size**

In `frontend/app/view/agents/notifyevents.ts`:

- add `import type { WindowSize } from "./windowsize";`;
- the header comment's "routeNotify sends each to an OS toast while arcterm is in the background, an in-app toast while
  it is focused, or nowhere for the agent you are looking at" becomes "routeNotify sends each to an OS toast while
  arcterm is in the background, an in-app toast or Sprout's bubble while it is focused, Sprout's bubble while folded, or
  nowhere for the agent you are looking at";
- `RouteCtx` becomes:

```ts
export interface RouteCtx {
    focused: boolean;
    // the window's size (windowsize.ts): in Float and folded, Sprout says what a toast said
    size: WindowSize;
    viewing: ReadonlySet<string>;
    settings: { os: boolean; toast: boolean; reply: boolean };
}
```

- `routeNotify` and its comment become:

```ts
/** Pure: where one event goes. While focused, a `wsh notify` and anything that needs you are the avatar's (Sprout's
 *  bubble, petsources.tsx), so the two never say the same thing in the same corner; in Float, where Sprout walks the
 *  ledge, a finished turn is too. Folded, Sprout floats over every app, so it says everything, whichever app is in
 *  front, and the hidden terminal is not in view. */
export function routeNotify(e: NotifyEvent, ctx: RouteCtx): NotifyRoute {
    if (e.kind === "reply" && !ctx.settings.reply) {
        return "none";
    }
    if (ctx.size === "sprout") {
        return "avatar";
    }
    if (!ctx.focused) {
        return ctx.settings.os ? "os" : "none";
    }
    if (e.target.kind === "agent" && ctx.viewing.has(e.target.agentId)) {
        return "none";
    }
    const pets = e.kind === "notify" || e.kind === "request" || e.kind === "attention";
    if (pets || ctx.size === "float") {
        return "avatar";
    }
    return ctx.settings.toast ? "toast" : "none";
}
```

- delete `toastSaysAsk` and its comment;
- replace `petEventOfNeeds` and its comment with:

```ts
/** Pure: what Sprout says in place of a toast. A decision, and (in Float and folded) a finished turn, which opens its
 *  agent. An agent's request is not one: it reaches the pet from its own agent:ask event, which also retracts it once
 *  answered; a `wsh notify` from its own notify event. */
export function petEventOf(e: NotifyEvent, nowMs: number): PetEvent | null {
    if (e.kind === "attention" && e.target.kind === "attention") {
        return { id: `needs:${e.target.key}`, at: nowMs, kind: "ask", text: e.title };
    }
    if (e.kind === "reply" && e.target.kind === "agent") {
        return {
            id: `reply:${e.target.agentId}:${nowMs}`,
            at: nowMs,
            kind: "notify",
            text: `${e.title} finished`,
            detail: e.body || undefined,
            sources: [{ ref: `agent:${e.target.agentId}`, title: e.title, sourceType: "" }],
        };
    }
    return null;
}
```

(The `"Finished"` label stays the toast's; Sprout's bubble reads "Notice · loom finished". A `finished` pet-event kind
would touch every `Record<PetEvent["kind"], …>`, which belongs with phase 3's chat.)

In `frontend/app/view/agents/notifysync.tsx`:

- import `floatMiniAtom` beside `floatModeAtom`, `windowSize` from `./windowsize`, and `petEventOf` instead of
  `petEventOfNeeds`;
- add `const folded = useAtomValue(floatMiniAtom);` after `const floating = …`;
- `ctx.current`'s `floating,` becomes `size: windowSize(floating, folded),`;
- in `enqueue`, the avatar branch becomes:

```ts
            } else if (route === "avatar") {
                // Sprout says a decision, and a finished turn, in place of its toast; its other avatar events come from
                // its own sources
                const said = petEventOf(event, Date.now());
```

- [ ] **Step 3: Let the ask gate speak while folded**

In `frontend/app/view/jarvis/petjoin.ts`:

- in the comment above `AskGateCtx`, replace "The pet's bubble is where a focused arcterm says the question
  (notifyevents.ts routeNotify sends no toast); only in float mode, where the pet is not drawn, does the Needs-you toast
  say it, and then the pet leaves it to the toast." with "The pet's bubble is where arcterm says the question
  (notifyevents.ts routeNotify sends no toast for it). Folded, the terminal is hidden, so nothing counts as looking at
  it.";
- `AskGateCtx`'s `toastSays` field and its comment become:

```ts
    // the window is folded into Sprout (floatstore.ts floatMiniAtom): nothing is in view
    folded: boolean;
```

- `shouldSpeakAsk`'s first check becomes:

```ts
    if (ctx.folded) {
        return true;
    }
```

In `frontend/app/view/jarvis/petsources.tsx`, the `toastSays: toastSaysAsk({…}),` entry and its comment become:

```ts
                    // folded, the floated terminal is hidden: its question is Sprout's to say
                    folded: globalStore.get(floatMiniAtom),
```

then fix the imports: `floatMiniAtom` instead of `floatModeAtom` from `@/app/view/agents/floatstore`; drop the
`toastSaysAsk` import; drop `getSettingsKeyAtom` and `atoms` from `@/app/store/global` only if nothing else in the file
uses them (`grep -n "getSettingsKeyAtom\|atoms\." frontend/app/view/jarvis/petsources.tsx`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run frontend/app/view/agents/notifyevents.test.ts frontend/app/view/jarvis/petjoin.test.ts`
Expected: PASS.

- [ ] **Step 5: Say it in the changelog**

Extend the float bullet (Tasks 5–6) with a third sentence:

```markdown
  In a float and folded into Sprout, what used to be a toast is Sprout's bubble; folded, it shows even while another
  app is in front.
```

- [ ] **Step 6: Check and commit**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.
Run: `grep -rn "toastSaysAsk\|petEventOfNeeds\|toastSays\|floating:" frontend/app` → nothing in these modules.
Run: `npx eslint` and `npx prettier --check` on the six files of this task → clean.

```bash
git add frontend/app/view/agents/notifyevents.ts frontend/app/view/agents/notifyevents.test.ts frontend/app/view/agents/notifysync.tsx frontend/app/view/jarvis/petjoin.ts frontend/app/view/jarvis/petjoin.test.ts frontend/app/view/jarvis/petsources.tsx CHANGELOG.md
git commit -m "feat(notify): in Float and folded into Sprout, Sprout's bubbles say what toasts said"
```

---

### Task 9: The `jarvis-modes` CDP scenario

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (after the `floatMini` scenario; the `SCENARIOS` list; `floatMini`'s step 2)

**Interfaces:**
- Consumes (DOM): `[data-app-sprout]`, `[data-float-minimize]`, `[data-sprout-mini]`, `[data-mini-hit="sprout"]
  button`, `[data-pet-sprite]`, `[data-pet-peek]`, `[data-float-bar]`, `[data-app-bar]`, `[data-agent-float]`,
  `[data-pet-ledge-holds]`.

WKWebView answers no CDP, so on this Mac the scenario is only syntax-checked; it runs on Windows (`task verify:ui --
jarvis-modes`). Do not run `prettier` on `scripts/*.mjs` (AGENTS.md).

- [ ] **Step 1: Fix `float-mini` for the new rest size**

In `floatMini.assert`, step 2's label `"2. Minimize folds the window into Sprout's 340x112 box, see-through around it"`
becomes `"2. Minimize folds the window into Sprout's 320x232 box, see-through around it"`, and
`rest.w <= 340 && rest.h <= 112` becomes `rest.w <= 320 && rest.h <= 232`; step 3's `window.innerHeight > 112` becomes
`window.innerHeight > 232`.

- [ ] **Step 2: Add the scenario**

After the `floatMini` object, add:

```js
// --- Jarvis across the window's three sizes ----------------------------------------------------------------------
// Full folds into Sprout in one click and Restore lands in Full; Float folds and Restore lands in Float; the chat opens
// from Sprout in all three; the terminal's PTY size never moves across a fold (the shell is hidden before the window
// shrinks). docs/superpowers/specs/2026-10-10-jarvis-modes-design.md. Windows only: WKWebView answers no CDP.
const JARVIS_MODES_PROJECT = "verify-jarvis-modes";

const jarvisModes = {
    name: "jarvis-modes",
    surface: "agent",
    async arrange(h) {
        const ctx = { terminals: [] };
        try {
            const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
            const wslist = await h.rpc("workspacelist", null);
            const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
            ctx.workspaceId = ws.workspacedata.oid;
            await openRailTerminal(h, ctx, JARVIS_MODES_PROJECT);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        if (ctx.arrangeError) {
            steps.push({ step: "0. arrange", ok: false, detail: ctx.arrangeError });
            return steps;
        }
        const term = ctx.terminals[0];
        const wait = (expr, ms) => floatMiniWait(h, expr, ms);
        const size = () => h.ev(`({ w: window.innerWidth, h: window.innerHeight })`);
        const shown = (sel) => `!!document.querySelector(${JSON.stringify(sel)})?.offsetParent`;
        const dblclickSprout = `document.querySelector('[data-mini-hit="sprout"] button')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`;
        const clickSprout = `document.querySelector('[data-mini-hit="sprout"] button')?.click()`;

        await h.goto("agent");
        await wait(`!!document.querySelector('[data-agent-row="${term.tabId}"]')`);
        await h.ev(`document.querySelector('[data-agent-row="${term.tabId}"]')?.click()`);
        await h.ev("new Promise((r) => setTimeout(r, 1200))");
        const fullBefore = await floatMiniTermSize(h, term.blockId);

        // 1. the walking Sprout opens the chat in Full
        await h.ev(`document.querySelector("[data-pet-sprite]")?.click()`);
        const fullChat = await wait(`!!document.querySelector("[data-pet-peek]")`);
        await h.shot("cdp-shots/jarvis-modes-full-chat.png");
        await h.ev(`document.querySelector("[data-pet-sprite]")?.click()`);
        await wait(`!document.querySelector("[data-pet-peek]")`);
        steps.push({ step: "1. a click on the walking Sprout opens the chat in Full", ok: fullChat, detail: "" });

        // 2. one click folds Full into Sprout
        await h.ev(`document.querySelector("[data-app-sprout]")?.click()`);
        const folded = await wait(`!!document.querySelector("[data-sprout-mini]")`);
        await h.ev("new Promise((r) => setTimeout(r, 900))");
        const rest = await size();
        const barHidden = await h.ev(`!${shown("[data-app-bar]")}`);
        await h.shot("cdp-shots/jarvis-modes-folded-full.png");
        steps.push({
            step: "2. the app bar's Sprout button folds Full into Sprout's 320x232 box",
            ok: folded && barHidden && rest.w <= 320 && rest.h <= 232,
            detail: JSON.stringify({ folded, barHidden, rest }),
        });

        // 3. the chat opens from the folded Sprout
        await h.ev(clickSprout);
        const foldedChat = await wait(`!!document.querySelector("[data-pet-peek]") && window.innerHeight > 232`);
        await h.shot("cdp-shots/jarvis-modes-folded-chat.png");
        await h.ev(clickSprout);
        await wait(`!document.querySelector("[data-pet-peek]") && window.innerHeight <= 232`);
        steps.push({ step: "3. a click on the folded Sprout opens the chat", ok: foldedChat, detail: "" });

        // 4. restore lands in Full, the PTY untouched
        await h.ev(dblclickSprout);
        const backFull = await wait(`!document.querySelector("[data-sprout-mini]") && ${shown("[data-app-bar]")}`);
        await h.ev("new Promise((r) => setTimeout(r, 1200))");
        const fullAfter = await floatMiniTermSize(h, term.blockId);
        await h.shot("cdp-shots/jarvis-modes-restored-full.png");
        steps.push({
            step: "4. a double-click restores Full, and the PTY size never moved",
            ok: backFull && JSON.stringify(fullAfter) === JSON.stringify(fullBefore),
            detail: JSON.stringify({ backFull, fullBefore, fullAfter }),
        });

        // 5. Float: Sprout walks the ledge and opens the chat
        await h.ev(`document.querySelector("[data-agent-float]")?.click()`);
        const floated = await wait(shown("[data-float-bar]"));
        await h.ev("new Promise((r) => setTimeout(r, 1500))");
        const onLedge = await h.ev(`(() => {
            const s = document.querySelector("[data-pet-sprite]")?.getBoundingClientRect();
            const l = document.querySelector("[data-pet-ledge-holds]")?.getBoundingClientRect();
            return !!s && !!l && s.top >= l.top - 1 && s.bottom <= l.bottom + 1;
        })()`);
        const floatBefore = await floatMiniTermSize(h, term.blockId);
        await h.ev(`document.querySelector("[data-pet-sprite]")?.click()`);
        const floatChat = await wait(`!!document.querySelector("[data-pet-peek]")`);
        await h.shot("cdp-shots/jarvis-modes-float-chat.png");
        await h.ev(`document.querySelector("[data-pet-sprite]")?.click()`);
        await wait(`!document.querySelector("[data-pet-peek]")`);
        steps.push({
            step: "5. in Float, Sprout stands inside the ledge and opens the chat",
            ok: floated && onLedge && floatChat,
            detail: JSON.stringify({ floated, onLedge, floatChat }),
        });

        // 6. Float folds and restores to Float, the PTY untouched
        await h.ev(`document.querySelector("[data-float-minimize]")?.click()`);
        const foldedFloat = await wait(`!!document.querySelector("[data-sprout-mini]")`);
        await h.ev("new Promise((r) => setTimeout(r, 900))");
        await h.ev(dblclickSprout);
        const backFloat = await wait(`!document.querySelector("[data-sprout-mini]") && ${shown("[data-float-bar]")}`);
        await h.ev("new Promise((r) => setTimeout(r, 1200))");
        const floatAfter = await floatMiniTermSize(h, term.blockId);
        await h.shot("cdp-shots/jarvis-modes-restored-float.png");
        steps.push({
            step: "6. Float folds into Sprout and restores to Float, and the PTY size never moved",
            ok: foldedFloat && backFloat && JSON.stringify(floatAfter) === JSON.stringify(floatBefore),
            detail: JSON.stringify({ foldedFloat, backFloat, floatBefore, floatAfter }),
        });
        return steps;
    },
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`jarvis-modes teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("restore from Sprout", () => h.ev(`document.querySelector("[data-mini-restore]")?.click()`));
        await step("leave float", () => h.ev(`document.querySelector("[data-float-exit]")?.click()`));
        await step("settle", () => h.ev("new Promise((r) => setTimeout(r, 1200))"));
        for (const t of ctx.terminals ?? []) {
            await step(`close the terminal tab ${t.tabId}`, () =>
                waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false])
            );
        }
    },
};
```

and add `jarvisModes,` to `SCENARIOS` right after `floatMini,` (`grep -n "floatMini," scripts/cdp/scenarios.mjs`).

- [ ] **Step 3: Syntax-check and commit**

Run: `node --check scripts/cdp/scenarios.mjs` → no output.
Run: `node -e "import('./scripts/cdp/scenarios.mjs').then((m) => console.log(m.SCENARIOS.some((s) => s.name === 'jarvis-modes')))"`
Expected: `true`.

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(cdp): jarvis-modes folds Full and Float into Sprout and back, the PTY untouched"
```

---

### Task 10: The docs

**Files:**
- Modify: `docs/guide/agent.md:118` (the Float row), `docs/guide/cockpit.md:335` and `:346-349`,
  `docs/guide/settings.md:76-79`, `docs/keyboard-shortcuts.md:33-44` (Global table)

- [ ] **Step 1: `docs/guide/agent.md`, the Float row**

Replace the row that starts `| Thu cửa sổ thành ô nổi (Float) |` with:

```markdown
| Thu cửa sổ thành ô nổi (Float) | Nút **Float** trên header hoặc `Shift+F`: cửa sổ thu lại chỉ còn terminal của agent đang chọn, một thanh tiêu đề ghi tên, trạng thái, model và context của agent (header của agent ẩn đi), và một gờ dưới đáy cho Sprout đi lại kèm số việc đang chờ; nó luôn nằm trên các app khác ngay khi bật (nút ghim trên thanh tắt điều đó). Dãy chấm trên thanh, mỗi chấm một agent, đổi sang terminal của agent khác. Thoát bằng nút trên thanh, `Shift+F`, hoặc thoát toàn màn hình; cửa sổ trở lại kích thước cũ, lần Float sau mở lại đúng chỗ lần trước. Nút **Sprout** trên thanh (hoặc nút minimize, nút vàng hay `⌘M` trên macOS) thu cửa sổ vào Sprout ngay chỗ nó đứng, xem [Con vật Jarvis](cockpit.md#con-vật-jarvis) |
```

- [ ] **Step 2: `docs/guide/cockpit.md`**

In the notifications list, replace the sentence of line 335 that starts "Ở chế độ Float, con vật bị ẩn nên những việc
trên hiện thành toast:" (through "**Message** 6 giây.") with:

```markdown
Ở chế độ Float và khi đã thu vào Sprout, con vật nói thay toast: mọi việc trên, kể cả **Finished**, hiện thành bong bóng của nó; khi đã thu vào Sprout, bong bóng hiện cả lúc bạn đang ở app khác, thay cho thông báo hệ thống.
```

In "## Con vật Jarvis", replace the bullet that starts "- Khi cửa sổ **Float** được thu nhỏ" (four lines) with:

```markdown
- Ở chế độ **Float**, con vật đi trên một gờ dưới đáy cửa sổ, không bao giờ đứng lên dấu nhắc của terminal, kèm chip
  số việc đang chờ; bấm vào nó mở cùng popup.
- **Thu vào Sprout:** nút **Sprout** trên app bar hoặc trên thanh Float, hay nút minimize (nút vàng và `⌘M` trên
  macOS), thu cả cửa sổ vào con vật ngay chỗ nó đang đứng. Nó bay trên mọi app, đeo dấu và số việc đang chờ, kéo đi đâu
  cũng được. Rê chuột lên nó để thấy mọi agent và trạng thái: bấm một agent để mở Float trên agent đó, **Restore**
  (hoặc bấm đúp con vật) để về đúng chế độ trước khi thu, đầy đủ hay Float, đúng khung cũ. Bấm vào nó để mở chat (hàng
  chờ và ô **Ask Jarvis**), `Esc` để thu lại; điều nó nói và câu trả lời đến lúc chat đang thu hiện thành bong bóng
  cạnh nó. Muốn nút minimize về Dock (taskbar trên Windows) như thường: **Settings → General → Window → Minimize**.
```

- [ ] **Step 3: `docs/guide/settings.md`**

In "### General", after the `**When an agent finishes**` row, add:

```markdown
| **Window** | **Minimize** (`window:minimize`) | Nút minimize (cả nút vàng và `⌘M` trên macOS) thu cửa sổ vào Sprout (`sprout`, mặc định) hay đưa xuống Dock hoặc taskbar (`dock`). Nút **Sprout** trên app bar luôn thu vào Sprout. |
```

- [ ] **Step 4: `docs/keyboard-shortcuts.md`**

In "## Global", after the `Ctrl`+`C` `Ctrl`+`C` row, add:

```markdown
| `Cmd`+`M` (macOS) | Fold the window into Sprout, from the cockpit or a float (Settings → General → Window → Minimize: Dock sends it to the Dock instead) |
```

- [ ] **Step 5: Commit**

```bash
git add docs/guide/agent.md docs/guide/cockpit.md docs/guide/settings.md docs/keyboard-shortcuts.md
git commit -m "docs: folding into Sprout from Full or Float, the float ledge and switcher, window:minimize"
```

---

### Task 11: Verify, build, check by hand, land

- [ ] **Step 1: The whole suite and the typecheck**

Run: `npx vitest run` (it queues as a heavy job) → all PASS.
Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (5 min timeout) → exit 0.
Run: `PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml` → PASS.
Run: `go test ./pkg/wconfig/...` → PASS.
Run: `git diff --name-only main -- '*.ts' '*.tsx' | xargs npx eslint` and the same list with `npx prettier --check` →
clean.

- [ ] **Step 2: The other agent's character work, if it landed**

Run: `git log --oneline main -- frontend/app/view/jarvis/petcharacter.ts`. If it shows a commit, run `git merge main`
on `jarvis-modes`. Resolve: `petfloat.ts`, `petfloat.test.ts`, `petfloatmark.tsx` stay deleted (`git rm`);
`settingsmodel.test.ts`'s count becomes `37 + …`; in `app-bar.tsx`, `float-bar.tsx`, `sprout-mini.tsx` and
`petview.tsx`, every `spriteFor(…)` gains `petCharacter(useAtomValue(petCharacterAtom))` as the fourth argument (in
`app-bar.tsx` and `float-bar.tsx`, `FOLD_SPRITE` / `MINIMIZE_SPRITE` become a record per character as `float-bar.tsx`
already does on `main`), and the visible "Sprout" in the two buttons' labels, `useFoldTitle` and `WindowControls`'s
aria-label becomes `PET_CHARACTER_NAME[character]`. Rerun Step 1.

- [ ] **Step 3: Build the app from the worktree**

Run: `PATH=/opt/homebrew/opt/rustup/bin:$PATH NODE_OPTIONS=--max-old-space-size=4096 task tauri:build BUMP=none`
Expected: `releases/arcterm_<version>_aarch64.dmg` and the `.app` built. Then ask the person to install with
`! cd .worktrees/float-mini-sprout && task install`, and read the first line of `$TMPDIR/arcterm-install.log`
(`installing … from …/.worktrees/float-mini-sprout`) before trusting any result.

- [ ] **Step 4: The Mac by hand (the person)**

1. Full, the app bar's **Sprout** button: the content scales into the footer Sprout's spot, and the folded Sprout
   appears on the same pixels. Double-click: Full comes back at the same frame (still maximized if it was), the content
   growing out of Sprout; the terminal does not reflow.
2. The yellow button and `⌘M` (arcterm in front) fold Full, and fold Float.
3. Settings → General → Window → Minimize → **Dock**: the yellow button and `⌘M` send the window to the Dock; the
   **Sprout** button still folds. Back to **Sprout**.
4. Float, its **Sprout** button: folds at the ledge Sprout; Restore gives Float back at the same frame and pin.
5. Folded, drag Sprout partly past a screen edge: it is pulled back on. Drag it to the external monitor (other
   resolution and scale): it stays where dropped, and the list and the chat open there. Restore: the window returns to
   its own frame on its own monitor.
6. Folded, hover Sprout: every agent with its state, `+N more` past four, **Restore window** / **Restore float**. Click
   an agent: Float on that agent, from a Full fold too.
7. With another app in front, one click on the folded Sprout opens the chat (not only focuses arcterm).
8. Float: Sprout walks the ledge and never stands on the terminal; the amber count shows when something waits; a click
   opens the chat above it. The dots switch the terminal.
9. Float, an agent finishes: Sprout's bubble, no toast. Folded with another app in front, an agent asks: Sprout's
   bubble beside it, no system banner.
10. System Settings → Accessibility → Display → Reduce motion on: fold and restore happen without the animation.
11. Full in native fullscreen, **Sprout**: it leaves fullscreen and folds; Restore returns to fullscreen.
12. Nothing in the folded window has a shadow (Sprout, the list, the bubble, the chat) over a light app.

- [ ] **Step 5: Review**

Dispatch one fresh reviewer on the most capable model over `git diff main...jarvis-modes`, with the spec and this plan,
and fix what it confirms.

- [ ] **Step 6: Land on main**

After the person's check passes: from the main checkout, confirm its dirty files do not overlap the branch
(`git -C ~/Workspaces/dev/arcterm status --short` against `git diff --name-only main...jarvis-modes`), then
`git -C ~/Workspaces/dev/arcterm merge --no-ff jarvis-modes`, push `main`, and delete the branch
(`git -C .worktrees/float-mini-sprout switch float-mini-sprout && git -C .worktrees/float-mini-sprout merge --ff-only
main && git branch -d jarvis-modes`). Delete this plan file in a follow-up `docs:` commit once it has shipped.

## Not in this plan

- Phase 3 (`JarvisChat`) and phase 4 (the global key, the right-click menu, `jarvis:hotkey`).
- From the last review, left for later: the chat draws one frame before the window grows (phase 3 replaces the chat);
  the cursor poll's 3–4 IPC calls a tick; the transparent window's flash at launch. Fixed here: the stale unread mark
  between folds (Task 7) and a Sprout dropped past an edge (Task 2 `settleMove`).
