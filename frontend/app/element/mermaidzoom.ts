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
