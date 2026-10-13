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
// Shift+F and the Float button. open-agent: a click on an agent in the folded list. return: back to arcterm from another
// app (Alt+Tab, the taskbar) on Windows, which lands in Full, maximized, whatever size it folded from.
export type Move = "fold" | "restore" | "toggle-float" | "open-agent" | "return";

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
        case "return":
            return s.size === "sprout" ? { size: "full", origin: null } : s;
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

// what minimize does in a size: folded, it gives the window back, so ⌘M is the way out of Sprout as well as in
export function minimizeAction(choice: MinimizeChoice, size: WindowSize): "fold" | "dock" | "restore" {
    if (size === "sprout") {
        return "restore";
    }
    return choice === "dock" ? "dock" : "fold";
}

// window:autosprout: off unless set, since a cockpit on a second screen should stay in sight while you work elsewhere
export function autoSproutOn(raw: unknown): boolean {
    return raw === true;
}

// how long the window stays out of focus before it folds, so an Alt+Tab that comes straight back, or a window that
// pops up for a moment while you watch something, leaves it be
export const AUTO_FOLD_DELAY_MS = 3000;

export type Foreground = "ours" | "covered" | "beside";

export interface LeaveCheck {
    on: boolean;
    size: WindowSize;
    // where the OS's foreground is (the host's app_foreground, foreground.rs): still arcterm's (a file dialog, another
    // arcterm window), another app whose window hides arcterm, or another app beside it, where arcterm still shows
    foreground: Foreground;
    minimized: boolean;
    visible: boolean;
}

/** Whether a window still out of focus when AUTO_FOLD_DELAY_MS ends folds into Sprout: only when the app you left for
 *  hides it, as a picture-in-picture would. Only Full: Float is already the size for watching an agent from another app. */
export function autoFoldOnLeave(c: LeaveCheck): boolean {
    return c.on && c.size === "full" && c.foreground === "covered" && !c.minimized && c.visible;
}

// how long a focus waits to see whether a press on Sprout comes with it
export const AUTO_RESTORE_SETTLE_MS = 250;
// a focus this close to a press on Sprout is the press's (a drag, a click on an agent), not a return to the app
export const AUTO_RESTORE_PRESS_MS = 300;

export interface ReturnCheck {
    size: WindowSize;
    // the last press on the window minus the focus's time; null with no press yet
    pressGapMs: number | null;
    // the chat opened with the return (a toast's click), rather than being open when you left
    chatOpened: boolean;
}

/** Whether a focus coming back to a folded window grows it back, as a picture-in-picture returns to its tab: any fold,
 *  a button's or the one leaving made, but not a focus that came with a press on Sprout or with its chat opening. */
export function autoRestoreOnReturn(c: ReturnCheck): boolean {
    if (c.size !== "sprout" || c.chatOpened) {
        return false;
    }
    return c.pressGapMs == null || Math.abs(c.pressGapMs) > AUTO_RESTORE_PRESS_MS;
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
// the content starts to shrink this far into the pet's departure (petteleport.ts), while its beam still stands
export const FOLD_DEPART_LEAD_MS = 260;

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
