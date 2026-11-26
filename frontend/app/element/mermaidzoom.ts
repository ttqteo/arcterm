// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The zoom and scroll of a diagram opened full size (mermaidviewer.tsx), and the pixel size it is copied at
// (mermaidimage.ts). Pure, so the viewer stays a thin shell over it.
//
// The viewer is a native scroll box: a trackpad swipe or a mouse wheel scrolls it on WebKit's scrolling thread, smooth
// however busy the page's main thread is. Inside it a canvas as big as the zoomed diagram (and never smaller than the box, so a small
// diagram sits centred) holds the diagram, scaled by a transform. A zoom resizes the canvas and moves the scroll so the
// point under the cursor stays put.

export type Size = { w: number; h: number };

// the zoom and the box's scroll offsets, in CSS px
export type ScrollView = { scale: number; left: number; top: number };

// the canvas's size, and where the diagram sits in it
export type Layout = { w: number; h: number; x: number; y: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
// one press of + or -
export const STEP = 1.25;
// the room around the diagram, at fit and at the canvas's edges
const PAD = 24;

function clampScale(s: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

// the whole diagram in view, never enlarged past its natural size: a small diagram opens as drawn
export function fitScale(content: Size, box: Size): number {
    if (content.w <= 0 || content.h <= 0 || box.w <= 0 || box.h <= 0) {
        return 1;
    }
    const room = { w: Math.max(1, box.w - 2 * PAD), h: Math.max(1, box.h - 2 * PAD) };
    return clampScale(Math.min(1, room.w / content.w, room.h / content.h));
}

export function layoutAt(content: Size, box: Size, scale: number): Layout {
    const cw = content.w * scale;
    const ch = content.h * scale;
    const w = Math.max(box.w, cw + 2 * PAD);
    const h = Math.max(box.h, ch + 2 * PAD);
    return { w, h, x: (w - cw) / 2, y: (h - ch) / 2 };
}

function clampScroll(content: Size, box: Size, v: ScrollView): ScrollView {
    const l = layoutAt(content, box, v.scale);
    return { scale: v.scale, left: clamp(v.left, 0, l.w - box.w), top: clamp(v.top, 0, l.h - box.h) };
}

// fit, centred
export function fitScroll(content: Size, box: Size): ScrollView {
    const scale = fitScale(content, box);
    const l = layoutAt(content, box, scale);
    return { scale, left: (l.w - box.w) / 2, top: (l.h - box.h) / 2 };
}

// zoom to `scale` keeping the point (px, py) of the box still, so the wheel zooms toward the cursor; where the canvas
// cannot scroll that far (a diagram smaller than the box stays centred) the scroll stops at its edge
export function zoomScroll(
    content: Size,
    box: Size,
    cur: ScrollView,
    scale: number,
    px: number,
    py: number
): ScrollView {
    const next = clampScale(scale);
    const from = layoutAt(content, box, cur.scale);
    const to = layoutAt(content, box, next);
    // the diagram point under (px, py)
    const ux = (cur.left + px - from.x) / cur.scale;
    const uy = (cur.top + py - from.y) / cur.scale;
    return clampScroll(content, box, { scale: next, left: ux * next + to.x - px, top: uy * next + to.y - py });
}

// the same diagram point at the centre of a box that changed size
export function resizeScroll(content: Size, from: Size, to: Size, cur: ScrollView): ScrollView {
    const a = layoutAt(content, from, cur.scale);
    const b = layoutAt(content, to, cur.scale);
    const ux = cur.left + from.w / 2 - a.x;
    const uy = cur.top + from.h / 2 - a.y;
    return clampScroll(content, to, { scale: cur.scale, left: ux + b.x - to.w / 2, top: uy + b.y - to.h / 2 });
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

export type WheelEventInput = WheelInput & { metaKey: boolean };

export type WheelAction = { kind: "scroll" } | { kind: "zoom"; factor: number; instant: boolean };

// what a wheel event does in the viewer, the way a design tool or a browser reads it: a plain wheel (a trackpad swipe,
// a mouse wheel, shift + wheel sideways) is left to the box's own scroll, which runs off the main thread; a pinch (ctrl
// wheel in Chromium, or a ctrl + mouse wheel) zooms at once; a cmd + wheel zooms toward the cursor and eases
export function wheelAction(e: WheelEventInput): WheelAction {
    if (e.ctrlKey) {
        return { kind: "zoom", factor: wheelZoomFactor(e), instant: true };
    }
    if (e.metaKey) {
        return { kind: "zoom", factor: wheelZoomFactor(e), instant: false };
    }
    return { kind: "scroll" };
}

// the shown zoom eases toward the target one: a wheel notch's 16% jump or a + press glides over ~100 ms instead of
// landing in one frame. `dt` is the time since the last frame, in ms; it returns the target itself once close.
const EASE_MS = 45;

export function easeScale(cur: number, target: number, dt: number): number {
    const next = cur + (target - cur) * (1 - Math.exp(-Math.max(0, dt) / EASE_MS));
    return Math.abs(next - target) < 0.001 * target ? target : next;
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
