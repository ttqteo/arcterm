// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy screenshot: one board, as it sits on screen, put on the clipboard as a PNG. The board is a cross-origin frame,
// so its pixels come from the host's window capture cropped to the board (as Send and the gallery preview take them);
// a board taller than its pane gives the part in view. Each failure throws a sentence for the person.

import type { DOMRectLike } from "./canvasmarks";
import { tauriSendIO } from "./canvassend";
import { tauriThumbIO } from "./canvasthumb";
import { withOverlaysHidden } from "./protocapture";

export type CopyShotIO = {
    // the part of the board inside its scroll pane, in CSS px; null when it is not on screen
    boardRect(el: HTMLElement): DOMRectLike | null;
    // runs fn (the window capture) with Arc's own overlays hidden from the board's frame, as the A/B/C chips are, so the
    // copy holds none of them (protocapture.ts withOverlaysHidden). A member of the io so a suite without a window can
    // pass fn straight through
    hideOverlays<T>(frameEl: HTMLElement, fn: () => Promise<T>): Promise<T>;
    capture(): Promise<Blob>;
    crop(png: Blob, rect: DOMRectLike): Promise<Blob>;
    writeImage(png: Blob): Promise<void>;
};

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export async function copyBoardShot(io: CopyShotIO, boardEl: HTMLElement): Promise<void> {
    const rect = io.boardRect(boardEl);
    if (rect == null || rect.width < 1 || rect.height < 1) {
        throw new Error("The board isn't on screen");
    }
    let png: Blob;
    try {
        png = await io.hideOverlays(boardEl, async () => io.crop(await io.capture(), rect));
    } catch (e) {
        throw new Error(`Couldn't capture the board: ${errText(e)}`);
    }
    try {
        await io.writeImage(png);
    } catch (e) {
        throw new Error(`Couldn't put the picture on the clipboard: ${errText(e)}`);
    }
}

export const tauriCopyShotIO: CopyShotIO = {
    boardRect: tauriThumbIO.boardRect,
    hideOverlays: withOverlaysHidden,
    capture: tauriSendIO.capture,
    crop: tauriSendIO.crop,
    async writeImage(png) {
        if (typeof ClipboardItem === "undefined" || navigator.clipboard?.write == null) {
            throw new Error("this webview can't copy images");
        }
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    },
};
