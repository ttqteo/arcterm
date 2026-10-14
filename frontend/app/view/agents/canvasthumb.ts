// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A canvas's gallery preview: <topic>/thumb.png, written once per session from the board as it sits on screen, when
// the file is missing or older than the newest board. The host's window capture is the only way to read pixels out of
// the cross-origin board frame (canvassend.ts does the same for Send), so this is never a background job: it runs a
// moment after a board settles in the viewer or in an agent's canvas pane. Every failure is swallowed; a card without
// a preview shows its board names.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { previewStale } from "./canvasgallery";
import { visibleRect, type DOMRectLike } from "./canvasmarks";
import { tauriSendIO } from "./canvassend";

export const THUMB_W = 480;
// how long a board stays loaded before it counts as settled: its own scripts and fonts finish by then
export const THUMB_SETTLE_MS = 1000;

export type ThumbIO = {
    // the preview's modtime in ms, 0 when there is none
    thumbTime(path: string): Promise<number>;
    // the part of the board inside its scroll pane, in CSS px; null when it is not on screen
    boardRect(el: HTMLElement): DOMRectLike | null;
    capture(): Promise<Blob>;
    crop(png: Blob, rect: DOMRectLike): Promise<Blob>;
    scale(png: Blob, width: number): Promise<Blob>;
    write(path: string, bytes: Uint8Array): Promise<void>;
};

export function thumbPath(topicDir: string): string {
    const sep = topicDir.includes("\\") ? "\\" : "/";
    return `${topicDir.replace(/[\\/]+$/, "")}${sep}thumb.png`;
}

// done: captured and written this session. busy: a capture is under way, so a second board load does not start another
const done = new Set<string>();
const busy = new Set<string>();

export async function maybeCaptureThumb(
    io: ThumbIO,
    a: { topicDir: string; boardEl: HTMLElement; modts: number }
): Promise<void> {
    if (done.has(a.topicDir) || busy.has(a.topicDir)) {
        return;
    }
    busy.add(a.topicDir);
    try {
        const path = thumbPath(a.topicDir);
        if (!previewStale({ modts: a.modts, thumbts: await io.thumbTime(path) })) {
            return;
        }
        // measured now, after the await: the board may have scrolled or left the screen meanwhile
        const rect = io.boardRect(a.boardEl);
        if (rect == null || rect.width < 1 || rect.height < 1) {
            return;
        }
        const png = await io.scale(await io.crop(await io.capture(), rect), THUMB_W);
        await io.write(path, new Uint8Array(await png.arrayBuffer()));
        done.add(a.topicDir);
    } catch (e) {
        // a Mac has no window capture; a minimised window has nothing to capture. Neither is the user's problem
        console.debug("canvas preview not taken", a.topicDir, e);
    } finally {
        busy.delete(a.topicDir);
    }
}

export const tauriThumbIO: ThumbIO = {
    async thumbTime(path) {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
        return info == null || info.notfound ? 0 : (info.modtime ?? 0);
    },
    boardRect(el) {
        const clip = el.closest("[data-canvas-scroll], [data-canvas-viewer-scroll]");
        return clip == null ? null : visibleRect(el.getBoundingClientRect(), clip.getBoundingClientRect());
    },
    capture: tauriSendIO.capture,
    crop: tauriSendIO.crop,
    // never up: a capture narrower than the card needs no blur
    async scale(png, width) {
        const bitmap = await createImageBitmap(png);
        try {
            const w = Math.min(width, bitmap.width);
            const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(bitmap, 0, 0, w, h);
            return await canvas.convertToBlob({ type: "image/png" });
        } finally {
            bitmap.close();
        }
    },
    write: tauriSendIO.write,
};
