// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Float mode: the one window shrinks to the focused agent's terminal and can be pinned above other apps. It stays
// one window, so the terminal only refits (no second webview, no second owner for the PTY). This is the window
// arithmetic and the stored shapes; floatstore.ts makes the Tauri calls.
//
// Rects are physical pixels, as Tauri reports a window's frame and a monitor's work area; the sizes below are
// logical and scale by the monitor's factor.

import type { FoldOrigin } from "./windowsize";

export interface WinRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

// what leaving float mode gives back
export interface FloatRestore {
    rect: WinRect;
    maximized: boolean;
    terminalFullscreen: boolean;
}

// mirrors minWidth/minHeight in tauri.conf.json, which float mode lifts while it is on
export const MAIN_MIN_SIZE = { width: 1280, height: 680 };
export const FLOAT_MIN_SIZE = { width: 480, height: 300 };
export const FLOAT_DEFAULT_SIZE = { width: 720, height: 460 };
const FLOAT_MARGIN = 24;

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

// Where a float lands in a work area: where the last one was, pulled back on screen, or at the default size in the
// bottom-right corner, out of the way of what you float it over.
export function floatRect(last: WinRect | null, work: WinRect, scale: number): WinRect {
    const width = clamp(last?.width ?? FLOAT_DEFAULT_SIZE.width * scale, FLOAT_MIN_SIZE.width * scale, work.width);
    const height = clamp(last?.height ?? FLOAT_DEFAULT_SIZE.height * scale, FLOAT_MIN_SIZE.height * scale, work.height);
    const margin = FLOAT_MARGIN * scale;
    const x = last?.x ?? work.x + work.width - width - margin;
    const y = last?.y ?? work.y + work.height - height - margin;
    return {
        x: clamp(x, work.x, work.x + work.width - width),
        y: clamp(y, work.y, work.y + work.height - height),
        width,
        height,
    };
}

// a monitor's work area (no menu bar, dock or taskbar) and its scale factor
export interface Screen {
    area: WinRect;
    scale: number;
}

// The screen a float opens on: the one the last float's centre was on, so a float kept on a second monitor goes back
// there; the window's own screen for a first float, or once that monitor is unplugged.
export function screenFor(last: WinRect | null, screens: Screen[], current: Screen): Screen {
    if (last == null) {
        return current;
    }
    const cx = last.x + last.width / 2;
    const cy = last.y + last.height / 2;
    return (
        screens.find(({ area: a }) => cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) ?? current
    );
}

function isNum(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

export function parseRect(raw: unknown): WinRect | null {
    const r = raw as Partial<WinRect> | null;
    if (r == null || typeof r !== "object" || !isNum(r.x) || !isNum(r.y) || !isNum(r.width) || !isNum(r.height)) {
        return null;
    }
    if (r.width <= 0 || r.height <= 0) {
        return null;
    }
    return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function parseRestore(raw: unknown): FloatRestore | null {
    const r = raw as Partial<FloatRestore> | null;
    if (r == null || typeof r !== "object") {
        return null;
    }
    const rect = parseRect(r.rect);
    if (rect == null || typeof r.maximized !== "boolean" || typeof r.terminalFullscreen !== "boolean") {
        return null;
    }
    return { rect, maximized: r.maximized, terminalFullscreen: r.terminalFullscreen };
}

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

export function miniSides(sprout: WinRect, work: WinRect): MiniSides {
    const cx = sprout.x + sprout.width / 2;
    const cy = sprout.y + sprout.height / 2;
    return {
        h: cx >= work.x + work.width / 2 ? "left" : "right",
        v: cy >= work.y + work.height / 2 ? "up" : "down",
    };
}

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

// The window around Sprout's box at a logical size, Sprout in the corner away from where things open, cut to the room
// the work area has on those sides rather than moving Sprout
export function miniWindowRect(
    sprout: WinRect,
    size: { width: number; height: number },
    sides: MiniSides,
    work: WinRect,
    scale: number
): WinRect {
    const roomX = sides.h === "left" ? sprout.x + sprout.width - work.x : work.x + work.width - sprout.x;
    const roomY = sides.v === "up" ? sprout.y + sprout.height - work.y : work.y + work.height - sprout.y;
    const width = Math.min(Math.round(size.width * scale), roomX);
    const height = Math.min(Math.round(size.height * scale), roomY);
    return {
        x: sides.h === "left" ? sprout.x + sprout.width - width : sprout.x,
        y: sides.v === "up" ? sprout.y + sprout.height - height : sprout.y,
        width,
        height,
    };
}

// Sprout's box from the window around it, the inverse of miniWindowRect: a drag moves the window, and this is where
// it put Sprout
export function sproutFromWindow(win: WinRect, sides: MiniSides, scale: number): WinRect {
    const size = MINI_SPROUT_BOX * scale;
    return {
        x: sides.h === "left" ? win.x + win.width - size : win.x,
        y: sides.v === "up" ? win.y + win.height - size : win.y,
        width: size,
        height: size,
    };
}

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

// The folded float works in one space. Tauri hands out "physical" pixels, but on macOS tao makes them from points with
// whichever scale is at hand (the window's own for its frame, each monitor's for its area), so two monitors of
// different scales do not share one space there; in points they do. Windows' physical pixels already share one.
export function toSpace(rect: WinRect, scale: number, mac: boolean): WinRect {
    if (!mac) {
        return rect;
    }
    return { x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale };
}

// what a logical size is multiplied by in that space: points are logical already
export function spaceScale(scale: number, mac: boolean): number {
    return mac ? 1 : scale;
}
