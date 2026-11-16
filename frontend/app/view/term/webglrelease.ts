// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Hands WebGL contexts back to the browser. Chromium (WebView2 too) keeps about 16 live WebGL contexts per page and,
// past that, drops the oldest, which is how the Jarvis hologram fell back to Sprout. A context nobody draws with
// still counts until the garbage collector finds its canvas, and @xterm/addon-webgl's dispose() only removes its
// canvas: every pane parked while hidden, closed or unmounted left one behind. Losing it on purpose frees the slot
// at once.

// what releaseWebGlCanvases needs of a canvas, so a test can hand in stand-ins
export interface WebGlCanvasLike {
    getContext(kind: "webgl2"): { getExtension(name: "WEBGL_lose_context"): { loseContext(): void } | null } | null;
}

/**
 * Lose the WebGL2 context of each canvas that holds one; a 2D canvas (xterm's link layer) answers null and is left
 * alone. Call it after the owner is disposed and the canvas is out of the DOM, so the `webglcontextlost` it fires
 * reaches no listener that would take it for a GPU reset. Returns how many it lost.
 */
export function releaseWebGlCanvases(canvases: Iterable<WebGlCanvasLike>): number {
    let lost = 0;
    for (const canvas of canvases) {
        try {
            const ext = canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
            if (ext != null) {
                ext.loseContext();
                lost++;
            }
        } catch {
            // a canvas already given to another context kind throws on some engines: nothing to release
        }
    }
    return lost;
}
