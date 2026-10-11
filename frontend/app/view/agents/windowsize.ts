// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window's three sizes (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md): Full (the cockpit), Float (one
// agent's terminal) and Sprout (folded: Sprout alone, over every app). Which size a move lands in, the size a restore
// returns to, what minimize does, and the point a fold shrinks into and a restore grows from. Pure: floatstore.ts makes
// the window calls.

import { type WinRect } from "./floatwindow";

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

/** What a click on the Dock icon does to the window (macOS reopen, floatstore.ts): folded, it comes back, since Sprout
 *  can be out of sight on another Space; Full and Float are left to macOS. */
export function onReopen(s: SizeState): "restore" | null {
    return s.size === "sprout" ? "restore" : null;
}

/** What a landing does to the window (openref.ts openTarget): folded, the window comes back to show it. A landing on the
 *  surface already shown changes no surface, so onSurfaceChange alone would leave it behind the fold. */
export function afterOpen(s: SizeState): "restore" | null {
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

// the fold's motion: the content scales to this and fades over this long (MOTION.easeFluid)
export const FOLD_MS = 300;
export const FOLD_SCALE = 0.04;
// the share of FOLD_MS the content stays solid on a fold, so the eye sees it shrink into Sprout before it fades
export const FOLD_FADE_FROM = 0.6;

export interface FoldFade {
    opacity: number[];
    // each keyframe's place in the fold, 0 to 1
    times: number[];
}

/** The content's fade on a fold (to Sprout) or a restore (to the window): a restore plays the fold backwards. */
export function foldFade(to: "sprout" | "window"): FoldFade {
    return to === "sprout"
        ? { opacity: [1, 1, 0], times: [0, FOLD_FADE_FROM, 1] }
        : { opacity: [0, 1, 1], times: [0, 1 - FOLD_FADE_FROM, 1] };
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

/** The point the content scales into on a fold and grows out of on a restore: Sprout's middle as the window sees it, in
 *  CSS px, pulled inside the window when Sprout is outside it (the screen's corner past a small window, or dragged to
 *  another monitor), so the content never flies to or from off screen. frame is the window content's top-left in the
 *  fold's space, scale what a CSS px is in it (floatwindow.ts spaceScale). */
export function sproutCenter(sprout: WinRect, frame: Pt, scale: number, viewport: Viewport): Pt {
    return {
        x: clamp((sprout.x + sprout.width / 2 - frame.x) / scale, 0, viewport.width),
        y: clamp((sprout.y + sprout.height / 2 - frame.y) / scale, 0, viewport.height),
    };
}
