// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Send: a picture of the board with its marks goes to <canvas>/feedback/NNN.png, then one line naming it is
// typed into the agent. Every failure throws before the line is typed, and the marks stay for a retry.

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
    nextFeedbackName,
    visibleRect,
    type DOMRectLike,
} from "./canvasmarks";
import { canvasFeedbackDir, canvasFeedbackFile, shownBoard } from "./canvasmodel";
import { getCanvas, setCanvasMode } from "./canvasstore";

export type SendIO = {
    capture(): Promise<Blob>;
    crop(png: Blob, rect: DOMRectLike): Promise<Blob>;
    boardRect(): DOMRectLike | null;
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

export const tauriSendIO: SendIO = {
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
    boardRect() {
        const board = document.querySelector("[data-canvas-board]")?.getBoundingClientRect();
        const pane = document.querySelector("[data-canvas-scroll]")?.getBoundingClientRect();
        return board == null || pane == null ? null : visibleRect(board, pane);
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

export async function sendCanvasMarks(agent: AgentVM, io: SendIO = tauriSendIO): Promise<void> {
    const s = getCanvas(agent.id);
    if (s == null || s.marks.length === 0) {
        throw new Error("Nothing to send");
    }
    if (!agent.blockId) {
        throw new Error("This agent has no terminal to type into");
    }
    const rect = io.boardRect();
    if (rect == null) {
        throw new Error("The board isn't on screen");
    }
    // first, while the overlay and the marks are still drawn
    const png = await step("Couldn't capture the board", async () => io.crop(await io.capture(), rect));
    const dir = canvasFeedbackDir(s.dir);
    const name = await step(`Couldn't save the picture in ${dir}`, async () => {
        await io.mkdir(dir);
        const next = nextFeedbackName(await io.list(dir));
        await io.write(canvasFeedbackFile(s.dir, next), new Uint8Array(await png.arrayBuffer()));
        return next;
    });
    const line = canvasHandoffLine(feedbackRelPath(s.topic, name), shownBoard(s).name, s.marks);
    await step(`Couldn't type into ${agent.name}`, () => io.type(agent.blockId!, line + "\r"));
    setCanvasMode(agent.id, "terminal", Date.now());
}
