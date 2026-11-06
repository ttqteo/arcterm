// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Zoom and pan for the image zoom view, kept pure so the math is tested apart from the overlay. A view is the
// image's scale and the stage offset of its top-left corner, in CSS pixels.

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type ZoomView = { scale: number; x: number; y: number };

export const MAX_SCALE = 8;
// one key press or button click
export const ZOOM_STEP = 1.25;
// wheel delta per e-fold of zoom: a mouse notch (~100) is about a 1.2x step, a trackpad flick is finer
const WHEEL_DELTA_PER_EFOLD = 500;

// fit never enlarges: a small image shows at its own size rather than blurred
export function fitScale(img: Size, stage: Size): number {
    if (img.width <= 0 || img.height <= 0 || stage.width <= 0 || stage.height <= 0) {
        return 1;
    }
    return Math.min(1, stage.width / img.width, stage.height / img.height);
}

// along one axis: an image narrower than the stage is centered; a wider one never leaves a gap at either edge
function clampAxis(offset: number, extent: number, stageExtent: number): number {
    if (extent <= stageExtent) {
        return (stageExtent - extent) / 2;
    }
    return Math.min(0, Math.max(stageExtent - extent, offset));
}

export function clampView(view: ZoomView, img: Size, stage: Size): ZoomView {
    const scale = Math.min(MAX_SCALE, Math.max(fitScale(img, stage), view.scale));
    return {
        scale,
        x: clampAxis(view.x, img.width * scale, stage.width),
        y: clampAxis(view.y, img.height * scale, stage.height),
    };
}

export function fitView(img: Size, stage: Size): ZoomView {
    return clampView({ scale: fitScale(img, stage), x: 0, y: 0 }, img, stage);
}

// scales by factor while the image pixel under `at` (stage coordinates) stays under it, then clamps
export function zoomAt(view: ZoomView, factor: number, at: Point, img: Size, stage: Size): ZoomView {
    const scale = Math.min(MAX_SCALE, Math.max(fitScale(img, stage), view.scale * factor));
    const ratio = scale / view.scale;
    return clampView({ scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, img, stage);
}

export function stageCenter(stage: Size): Point {
    return { x: stage.width / 2, y: stage.height / 2 };
}

export function wheelFactor(deltaY: number): number {
    return Math.exp(-deltaY / WHEEL_DELTA_PER_EFOLD);
}

export function panBy(view: ZoomView, dx: number, dy: number, img: Size, stage: Size): ZoomView {
    return clampView({ ...view, x: view.x + dx, y: view.y + dy }, img, stage);
}

// whether a drag can move the image: some part of it is outside the stage
export function canPan(view: ZoomView, img: Size, stage: Size): boolean {
    return img.width * view.scale > stage.width || img.height * view.scale > stage.height;
}

export function zoomPercent(view: ZoomView): number {
    return Math.round(view.scale * 100);
}

export type ZoomKeyAction = "in" | "out" | "fit";

// "=" and "_" are the +/- key with Shift off or held, so either posture zooms
export function zoomKeyAction(key: string): ZoomKeyAction | null {
    switch (key) {
        case "+":
        case "=":
            return "in";
        case "-":
        case "_":
            return "out";
        case "0":
            return "fit";
        default:
            return null;
    }
}
