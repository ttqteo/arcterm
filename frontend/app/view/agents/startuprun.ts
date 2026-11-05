// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where the pet is on the startup loader (startuploader.tsx) a given time into its run: across its track, turn, back,
// its legs swapping every step and a one-cell bounce on the second foot. Pure, so the lap can be tested without a
// timer.

export const RUN_FRAME_MS = 1_000 / 12;
// px per ms: ~5 s to cross a 600 px track, quick enough to read as running, slow enough to watch
export const RUN_SPEED = 0.12;
export const RUN_STEP_MS = 140;

export interface RunFrame {
    x: number; // px from the track's left edge to the sprite's
    facing: "right" | "left";
    pose: "walk1" | "walk2";
    lift: number; // px the sprite is raised this frame
}

export function runFrame(elapsedMs: number, trackPx: number, spritePx: number, cellPx: number): RunFrame {
    const t = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
    const pose = Math.floor(t / RUN_STEP_MS) % 2 === 0 ? "walk1" : "walk2";
    const lift = pose === "walk2" ? cellPx : 0;
    const span = Math.max(0, trackPx - spritePx);
    if (span === 0) {
        return { x: 0, facing: "right", pose, lift };
    }
    const along = (t * RUN_SPEED) % (2 * span);
    return along < span
        ? { x: Math.round(along), facing: "right", pose, lift }
        : { x: Math.round(2 * span - along), facing: "left", pose, lift };
}
