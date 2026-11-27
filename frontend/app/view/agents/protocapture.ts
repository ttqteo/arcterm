// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A picture of a board must not hold Arc's own overlays on it (the A/B/C chips, the marks, a draft box). The frame carries
// CAPTURE_ATTR while it is captured, and every overlay inside it wears HIDE_WHILE_CAPTURING (protomodel.ts).

import { CAPTURE_ATTR } from "./protomodel";

// a window that draws no frames (minimized, behind another) never runs requestAnimationFrame; the picture is not
// waited for forever
const NO_FRAME_MS = 250;

// how many captures hold each frame, so one finishing does not show the overlays to another still under way
const holds = new WeakMap<HTMLElement, number>();

function twoFrames(): Promise<void> {
    return new Promise((resolve) => {
        const stalled = setTimeout(resolve, NO_FRAME_MS);
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                clearTimeout(stalled);
                resolve();
            })
        );
    });
}

// Hides every overlay in the frame, waits until they are gone (two animation frames), runs fn (the capture), and shows
// them again, whether fn returned or threw
export async function withOverlaysHidden<T>(frameEl: HTMLElement, fn: () => Promise<T>): Promise<T> {
    holds.set(frameEl, (holds.get(frameEl) ?? 0) + 1);
    frameEl.setAttribute(CAPTURE_ATTR, "");
    try {
        await twoFrames();
        return await fn();
    } finally {
        const left = (holds.get(frameEl) ?? 1) - 1;
        if (left > 0) {
            holds.set(frameEl, left);
        } else {
            holds.delete(frameEl);
            frameEl.removeAttribute(CAPTURE_ATTR);
        }
    }
}
