// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Float mode: the one window shrinks to the focused agent's terminal and can be pinned above other apps. It stays
// one window, so the terminal only refits (no second webview, no second owner for the PTY). This is the window
// arithmetic and the stored shapes; floatstore.ts makes the Tauri calls.
//
// Rects are physical pixels, as Tauri reports a window's frame and a monitor's work area; the sizes below are
// logical and scale by the monitor's factor.

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
