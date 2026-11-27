// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Send: marks are grouped by the screen and variants they were drawn on. Each group's newest clean picture of the board
// (taken when its mark was drawn, with no Arc overlay in it) gets the group's boxes and numbers drawn onto it and goes to
// <canvas>/feedback/NNN.png, then one line naming every group's picture and context is typed into the agent. Every
// failure throws before the line is typed, and the marks stay for a retry.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { arrayToBase64, makeConnRoute } from "@/util/util";
import { invoke } from "@tauri-apps/api/core";
import { sendToAgent } from "./agentsubmit";
import type { AgentVM } from "./agentsviewmodel";
import {
    canvasHandoffLine,
    cropRect,
    feedbackRelPath,
    groupMarks,
    groupShot,
    nextFeedbackName,
    NO_CONTEXT,
    shotBox,
    visibleRect,
    type DOMRectLike,
    type MarkShot,
} from "./canvasmarks";
import { canvasFeedbackDir, canvasFeedbackFile, shownBoard } from "./canvasmodel";
import { getCanvas, setCanvasMode } from "./canvasstore";
import { withOverlaysHidden } from "./protocapture";
import { contextKey, type MarkContext } from "./protomodel";

// a mark's box in a picture's device pixels, with the number the tray and the line give it
export type ShotBox = { n: number; x: number; y: number; w: number; h: number };

export type SendIO = {
    capture(): Promise<Blob>;
    crop(png: Blob, rect: DOMRectLike): Promise<Blob>;
    // device px per CSS px in a capture of the window
    pixelScale(png: Blob): Promise<number>;
    // the part of the board in view, in the window's CSS px
    boardRect(): DOMRectLike | null;
    // where a mark's x and y start (the frame's inside), in the window's CSS px
    markOrigin(): { left: number; top: number } | null;
    // runs fn (a capture) with every Arc overlay in the board's frame hidden, and shows them again after
    hideOverlays<T>(fn: () => Promise<T>): Promise<T>;
    // the picture with the numbered boxes drawn on it; scale is its device px per CSS px
    compose(png: Blob, boxes: ShotBox[], scale: number): Promise<Blob>;
    mkdir(path: string): Promise<void>;
    list(path: string): Promise<string[]>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    type(blockId: string, text: string): Promise<void>;
};

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

async function step<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (e) {
        throw new Error(`${what}: ${errText(e)}`);
    }
}

// the colors of the boxes come from the theme's tokens, so a picture matches the layer the user drew on
function paintBoxes(g: OffscreenCanvasRenderingContext2D, boxes: ShotBox[], scale: number): void {
    const root = getComputedStyle(document.documentElement);
    const accent = root.getPropertyValue("--color-accent").trim();
    const wash = root.getPropertyValue("--color-accentbg").trim();
    const ink = root.getPropertyValue("--color-background").trim();
    const line = 2 * scale;
    for (const b of boxes) {
        g.fillStyle = wash;
        g.fillRect(b.x, b.y, b.w, b.h);
        g.lineWidth = line;
        g.strokeStyle = accent;
        g.strokeRect(b.x + line / 2, b.y + line / 2, b.w - line, b.h - line);
        // the number chip of the layer: a 20 CSS px disc at the box's top-left corner
        g.fillStyle = accent;
        g.beginPath();
        g.arc(b.x, b.y, 10 * scale, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = ink;
        g.font = `bold ${11 * scale}px ${getComputedStyle(document.body).fontFamily}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(b.n), b.x, b.y + scale / 2);
    }
}

// frame: the board's frame element, or none for the one shown (the selected board in the pane or the rail)
function makeSendIO(frame?: HTMLElement): SendIO {
    const frameEl = () => frame ?? document.querySelector<HTMLElement>("[data-canvas-board]");
    return {
        async capture() {
            return new Blob([await invoke<ArrayBuffer>("capture_webview")], { type: "image/png" });
        },
        async crop(png, rect) {
            const bitmap = await createImageBitmap(png);
            try {
                const { sx, sy, sw, sh } = cropRect(rect, window.innerWidth, bitmap);
                if (sw === 0 || sh === 0) {
                    throw new Error("the board is off screen");
                }
                const canvas = new OffscreenCanvas(sw, sh);
                canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
                return await canvas.convertToBlob({ type: "image/png" });
            } finally {
                bitmap.close();
            }
        },
        async pixelScale(png) {
            const bitmap = await createImageBitmap(png);
            try {
                return window.innerWidth > 0 ? bitmap.width / window.innerWidth : 1;
            } finally {
                bitmap.close();
            }
        },
        boardRect() {
            const el = frameEl();
            const board = el?.getBoundingClientRect();
            const pane = (
                el?.closest("[data-canvas-scroll]") ?? document.querySelector("[data-canvas-scroll]")
            )?.getBoundingClientRect();
            return board == null || pane == null ? null : visibleRect(board, pane);
        },
        markOrigin() {
            const el = frameEl();
            if (el == null) {
                return null;
            }
            const r = el.getBoundingClientRect();
            // the layer sits inside the frame's border
            return { left: r.left + el.clientLeft, top: r.top + el.clientTop };
        },
        hideOverlays(fn) {
            const el = frameEl();
            return el == null ? fn() : withOverlaysHidden(el, fn);
        },
        async compose(png, boxes, scale) {
            const bitmap = await createImageBitmap(png);
            try {
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const g = canvas.getContext("2d");
                g.drawImage(bitmap, 0, 0);
                paintBoxes(g, boxes, scale);
                return await canvas.convertToBlob({ type: "image/png" });
            } finally {
                bitmap.close();
            }
        },
        // FileMkdirCommand fails on a directory that already exists
        async mkdir(path) {
            const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
            if (info != null && !info.notfound) {
                if (!info.isdir) {
                    throw new Error(`${path} is a file`);
                }
                return;
            }
            await RpcApi.FileMkdirCommand(TabRpcClient, { info: { path } });
        },
        // FileReadCommand on a directory returns its info but no entries
        async list(path) {
            const names: string[] = [];
            const gen = RpcApi.RemoteListEntriesCommand(TabRpcClient, { path }, { route: makeConnRoute(null) });
            for await (const chunk of gen) {
                names.push(...(chunk.fileinfo ?? []).map((f) => f.name ?? ""));
            }
            return names;
        },
        async write(path, bytes) {
            await RpcApi.FileWriteCommand(TabRpcClient, { info: { path }, data64: arrayToBase64(bytes) });
        },
        // a line ending in "\r" goes with its Enter as a write of its own (agentsubmit.ts)
        async type(blockId, text) {
            await sendToAgent(blockId, text);
        },
    };
}

// the shown board's frame
export const tauriSendIO: SendIO = makeSendIO();

// one particular frame: the mark layer shoots the board it sits in
export function frameSendIO(frame: HTMLElement): SendIO {
    return makeSendIO(frame);
}

// A picture of the board as it is on screen with no Arc overlay in it (the mark layer, the marks, the chips), and where
// it sits in the frame. The rect is read after the overlays are gone, right before the capture, so a scroll in between
// cannot shift the picture off it.
export async function shootBoard(io: SendIO): Promise<MarkShot> {
    return io.hideOverlays(async () => {
        const rect = io.boardRect();
        const origin = io.markOrigin();
        if (rect == null || origin == null) {
            throw new Error("The board isn't on screen");
        }
        return step("Couldn't capture the board", async () => {
            const full = await io.capture();
            const scale = await io.pixelScale(full);
            return {
                png: await io.crop(full, rect),
                rect: {
                    left: rect.left - origin.left,
                    top: rect.top - origin.top,
                    width: rect.width,
                    height: rect.height,
                },
                scale,
            };
        });
    });
}

// onScreen: the context the board shows now. A group of marks with no picture (the capture at its draw failed) is shot
// here only when it is that one; any other is sent with its line and no picture, never a picture of another screen
export async function sendCanvasMarks(
    agent: AgentVM,
    io: SendIO = tauriSendIO,
    onScreen: MarkContext = NO_CONTEXT
): Promise<void> {
    const s = getCanvas(agent.id);
    if (s == null || s.marks.length === 0) {
        throw new Error("Nothing to send");
    }
    if (!agent.blockId) {
        throw new Error("This agent has no terminal to type into");
    }
    const groups = groupMarks(s.marks);
    const showing = contextKey(onScreen);
    // first, while the board is as it was when its marks were drawn
    const shots: (MarkShot | null)[] = [];
    for (const g of groups) {
        shots.push(groupShot(g) ?? (g.key === showing ? await shootBoard(io) : null));
    }
    const pictures = await step("Couldn't draw the marks on the picture", () =>
        Promise.all(
            groups.map(async (g, i) => {
                const shot = shots[i];
                return shot == null
                    ? null
                    : io.compose(
                          shot.png,
                          g.marks.map(({ n, mark }) => ({ n, ...shotBox(mark, shot) })),
                          shot.scale
                      );
            })
        )
    );
    const dir = canvasFeedbackDir(s.dir);
    const names: (string | null)[] = await step(`Couldn't save the picture in ${dir}`, async () => {
        if (pictures.every((p) => p == null)) {
            return pictures.map(() => null);
        }
        await io.mkdir(dir);
        // one listing, so the next number follows the ones this send writes
        const taken = await io.list(dir);
        const out: (string | null)[] = [];
        for (const png of pictures) {
            if (png == null) {
                out.push(null);
                continue;
            }
            const name = nextFeedbackName(taken);
            taken.push(name);
            await io.write(canvasFeedbackFile(s.dir, name), new Uint8Array(await png.arrayBuffer()));
            out.push(name);
        }
        return out;
    });
    const board = shownBoard(s).name;
    const line = groups
        .map((g, i) =>
            canvasHandoffLine(
                names[i] == null ? null : feedbackRelPath(s.topic, names[i]!),
                board,
                g.marks.map((m) => m.mark),
                g.ctx,
                g.marks.map((m) => m.n)
            )
        )
        .join(" | ");
    await step(`Couldn't type into ${agent.name}`, () => io.type(agent.blockId!, line + "\r"));
    setCanvasMode(agent.id, "terminal", Date.now());
}
