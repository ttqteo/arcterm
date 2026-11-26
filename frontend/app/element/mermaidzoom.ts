// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The zoom and pan of a diagram opened full size (mermaidviewer.tsx), and the pixel size it is copied at
// (mermaidimage.ts). Pure, so the viewer stays a thin shell over it.

export type Size = { w: number; h: number };

// the diagram's top-left corner in the viewport, in CSS px, and its scale
export type ZoomView = { scale: number; x: number; y: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
// one press of + or -
export const STEP = 1.25;
// the room fit leaves around the diagram
const FIT_PAD = 24;

function clampScale(s: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

// the whole diagram in view and centred, never enlarged past its natural size: a small diagram opens as drawn
export function fitView(content: Size, box: Size): ZoomView {
    if (content.w <= 0 || content.h <= 0 || box.w <= 0 || box.h <= 0) {
        return { scale: 1, x: 0, y: 0 };
    }
    const room = { w: Math.max(1, box.w - 2 * FIT_PAD), h: Math.max(1, box.h - 2 * FIT_PAD) };
    const scale = clampScale(Math.min(1, room.w / content.w, room.h / content.h));
    return { scale, x: (box.w - content.w * scale) / 2, y: (box.h - content.h * scale) / 2 };
}

// zoom by `factor` keeping the point (px, py) of the viewport still, so the wheel zooms toward the cursor
export function zoomAt(v: ZoomView, factor: number, px: number, py: number): ZoomView {
    const scale = clampScale(v.scale * factor);
    const k = scale / v.scale;
    return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

export function panBy(v: ZoomView, dx: number, dy: number): ZoomView {
    return { ...v, x: v.x + dx, y: v.y + dy };
}

// one wheel notch (deltaY ±100) zooms by about 16%; a trackpad's small deltas zoom smoothly
export function wheelFactor(deltaY: number): number {
    return Math.exp(-deltaY * 0.0015);
}

// a pinch reaches Chromium as a wheel with ctrlKey and deltas of a few px, so it zooms faster per px than a notch;
// one event is capped so a ctrl + mouse notch (±100) does not jump. A wheel counting lines (deltaMode 1) is a mouse
// notch of about 33 px a line.
const PINCH_RATE = 0.01;
const PINCH_CAP = 25;
const LINE_PX = 33;

export type WheelInput = { deltaY: number; deltaMode: number; ctrlKey: boolean };

export function wheelZoomFactor(e: WheelInput): number {
    if (e.ctrlKey) {
        return Math.exp(-Math.max(-PINCH_CAP, Math.min(PINCH_CAP, e.deltaY)) * PINCH_RATE);
    }
    return wheelFactor(e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY);
}

export type WheelEventInput = WheelInput & {
    deltaX: number;
    metaKey: boolean;
    wheelDeltaX?: number;
    wheelDeltaY?: number;
};

export type WheelAction = { kind: "pan"; dx: number; dy: number } | { kind: "zoom"; factor: number; instant: boolean };

// a trackpad (or Magic Mouse) swipe scrolls in px, and WebKit and Chromium on a Mac give its legacy wheelDelta as -3
// times the delta; a mouse notch gives ±120 a notch, or counts lines. A wheel without the legacy fields is a swipe when
// it moves sideways.
function isSwipe(e: WheelEventInput): boolean {
    if (e.deltaMode !== 0) {
        return false;
    }
    const wy = e.wheelDeltaY ?? 0;
    const wx = e.wheelDeltaX ?? 0;
    if (wy !== 0 || wx !== 0) {
        return Math.abs(wy + 3 * e.deltaY) < 1 && Math.abs(wx + 3 * e.deltaX) < 1;
    }
    return e.deltaX !== 0;
}

// what a wheel event does in the viewer, the way a design tool reads it: a two-finger swipe pans and follows the
// fingers at once, a pinch (ctrl wheel in Chromium) zooms at once, a mouse notch or a cmd + wheel zooms toward the
// cursor and eases
export function wheelAction(e: WheelEventInput): WheelAction {
    if (e.ctrlKey) {
        return { kind: "zoom", factor: wheelZoomFactor(e), instant: true };
    }
    if (!e.metaKey && isSwipe(e)) {
        return { kind: "pan", dx: -e.deltaX, dy: -e.deltaY };
    }
    return { kind: "zoom", factor: wheelZoomFactor(e), instant: false };
}

// the shown view eases toward the target one: a wheel notch's 16% jump or a fit glides over ~100 ms instead of
// landing in one frame. Scale and offset move by the same fraction, which keeps the point zoomAt held still. `dt` is
// the time since the last frame, in ms; it returns the target itself once the rest is below a pixel.
const EASE_MS = 45;

export function easeToward(cur: ZoomView, target: ZoomView, dt: number): ZoomView {
    const t = 1 - Math.exp(-Math.max(0, dt) / EASE_MS);
    const next = {
        scale: cur.scale + (target.scale - cur.scale) * t,
        x: cur.x + (target.x - cur.x) * t,
        y: cur.y + (target.y - cur.y) * t,
    };
    const close =
        Math.abs(next.x - target.x) < 0.5 &&
        Math.abs(next.y - target.y) < 0.5 &&
        Math.abs(next.scale - target.scale) < 0.001;
    return close ? target : next;
}

// the copy is drawn at twice its CSS size for a sharp paste, smaller when that would pass the canvas's safe edge
export const COPY_DENSITY = 2;
export const MAX_COPY_EDGE = 8192;

export function copyPixelScale(content: Size): number {
    const edge = Math.max(content.w, content.h);
    if (edge <= 0) {
        return COPY_DENSITY;
    }
    return Math.min(COPY_DENSITY, MAX_COPY_EDGE / edge);
}
