// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { pollCanvasOnce, type CanvasIO, type HttpStatus } from "./canvaspoller";
import type { CanvasState } from "./canvasstore";

const NOW = 50_000;
const BASE = "http://127.0.0.1:5005/canvas/tok";
const STALE_BASE = "http://127.0.0.1:4004/canvas/old";

function state(over: Partial<CanvasState> = {}): CanvasState {
    return {
        topic: "t",
        dir: "/p/.superpowers/design/t",
        projectDir: "/p",
        mode: "canvas",
        board: null,
        all: false,
        boards: [],
        base: null,
        status: "probing",
        lastModifiedMs: null,
        lastViewedMs: 0,
        marking: false,
        marks: [],
        reloadKey: 0,
        ...over,
    };
}

type Served = { files: Record<string, number>; json?: unknown };

// a fake wavesrv: it serves the design folder under BASE, each file with a Last-Modified; any other base refuses.
// served null is a wavesrv that refuses to serve the folder at all
function fakeIO(
    served: Served | null,
    opts: { dirExists?: boolean } = {}
): CanvasIO & { urls: string[]; serves: string[] } {
    const urls: string[] = [];
    const serves: string[] = [];
    const answer = (url: string): { status: HttpStatus; lastModified: number | null } => {
        urls.push(url);
        const prefix = `${BASE}/t/project/`;
        if (served == null || !url.startsWith(prefix)) {
            return { status: "error", lastModified: null };
        }
        const lm = served.files[url.slice(prefix.length)];
        return lm == null ? { status: 404, lastModified: null } : { status: 200, lastModified: lm };
    };
    return {
        urls,
        serves,
        dirExists: async (path) => {
            expect(path).toBe("/p/.superpowers/design/t/project");
            return opts.dirExists ?? true;
        },
        serve: async (designDir) => {
            serves.push(designDir);
            return served == null ? null : BASE;
        },
        get: async (url) => ({ ...answer(url), json: served?.json }),
        head: async (url) => answer(url),
    };
}

const JSON_TWO = {
    order: ["Main.dc.html", "States.dc.html"],
    boards: { "Main.dc.html": { x: 0, y: 0 }, "States.dc.html": { x: 1520, y: 0, w: 900, h: 600 } },
};
const BOARDS_TWO = [
    { name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 },
    { name: "States.dc.html", x: 1520, y: 0, w: 900, h: 600 },
];

describe("pollCanvasOnce", () => {
    it("reports a deleted canvas folder as removed, without touching the network", async () => {
        const io = fakeIO({ files: { "Main.dc.html": 1 } }, { dirExists: false });
        expect(await pollCanvasOnce(state(), io, NOW)).toEqual({ status: "removed" });
        expect(io.urls).toEqual([]);
        expect(io.serves).toEqual([]);
    });

    it("is server-down when wavesrv refuses to serve the folder", async () => {
        const io = fakeIO(null);
        expect(await pollCanvasOnce(state(), io, NOW)).toEqual({ base: null, status: "server-down" });
        expect(io.urls).toEqual([]);
    });

    it("asks wavesrv to serve the project's design folder, then reads the boards and the newest Last-Modified", async () => {
        const io = fakeIO({
            files: { "Main.dc.html": 1000, "States.dc.html": 3000, "canvas.json": 2000 },
            json: JSON_TWO,
        });
        expect(await pollCanvasOnce(state(), io, NOW)).toEqual({
            base: BASE,
            status: "ready",
            boards: BOARDS_TWO,
            lastModifiedMs: 3000,
            lastViewedMs: NOW,
        });
        expect(io.serves).toEqual(["/p/.superpowers/design"]);
    });

    it("leaves lastViewedMs alone in terminal mode", async () => {
        const io = fakeIO({ files: { "Main.dc.html": 1000 } });
        const patch = await pollCanvasOnce(state({ mode: "terminal" }), io, NOW);
        expect(patch.lastViewedMs).toBeUndefined();
        expect(patch.status).toBe("ready");
    });

    it("reloads the boards when any board's Last-Modified moves in canvas mode, since all are on screen", async () => {
        const io = fakeIO({
            files: { "Main.dc.html": 1000, "States.dc.html": 5000, "canvas.json": 500 },
            json: JSON_TWO,
        });
        const shownMoved = state({ base: BASE, board: "States.dc.html", lastModifiedMs: 1000, reloadKey: 4 });
        expect((await pollCanvasOnce(shownMoved, io, NOW)).reloadKey).toBe(5);
        const otherMoved = state({ base: BASE, board: "Main.dc.html", lastModifiedMs: 1000, reloadKey: 4 });
        expect((await pollCanvasOnce(otherMoved, io, NOW)).reloadKey).toBe(5);
        const unchanged = state({ base: BASE, lastModifiedMs: 5000, reloadKey: 4 });
        expect((await pollCanvasOnce(unchanged, io, NOW)).reloadKey).toBeUndefined();
        const inTerminal = state({ base: BASE, board: "States.dc.html", lastModifiedMs: 1000, mode: "terminal" });
        expect((await pollCanvasOnce(inTerminal, io, NOW)).reloadKey).toBeUndefined();
    });

    it("does not reload on the first read", async () => {
        const io = fakeIO({ files: { "Main.dc.html": 1000 } });
        expect((await pollCanvasOnce(state({ base: BASE }), io, NOW)).reloadKey).toBeUndefined();
    });

    it("drops a base that stopped answering, so the next tick asks wavesrv again", async () => {
        const io = fakeIO({ files: { "Main.dc.html": 1000 } });
        const stale = state({ base: STALE_BASE, status: "ready" });
        expect(await pollCanvasOnce(stale, io, NOW)).toEqual({ base: null, status: "server-down" });
        const patch = await pollCanvasOnce({ ...stale, base: null }, io, NOW);
        expect(patch.base).toBe(BASE);
        expect(patch.status).toBe("ready");
    });

    it("keeps a known base and does not ask wavesrv again while it answers", async () => {
        const io = fakeIO({ files: { "Main.dc.html": 1000 } });
        await pollCanvasOnce(state({ base: BASE }), io, NOW);
        expect(io.serves).toEqual([]);
        expect(io.urls.every((u) => u.startsWith(`${BASE}/`))).toBe(true);
    });
});
