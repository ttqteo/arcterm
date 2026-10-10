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
