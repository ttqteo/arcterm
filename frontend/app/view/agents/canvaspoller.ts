// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Keeps the focused agent's canvas state in step with its folder on disk, which wavesrv serves.
// The step is pure over an injected IO so it can be tested; the hook runs it every CANVAS_POLL_MS.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import {
    boardsFromCanvasJson,
    boardUrl,
    CANVAS_POLL_MS,
    canvasDesignDir,
    canvasProjectDir,
    type CanvasBoard,
} from "./canvasmodel";
import { canvasStateAtom, updateCanvas, type CanvasState } from "./canvasstore";

const CANVAS_JSON = "canvas.json";
const HTTP_OK = 200;

export type HttpStatus = number | "error";

export type CanvasIO = {
    dirExists(path: string): Promise<boolean>;
    // asks wavesrv to serve a project's design folder; the base URL it is served under, or null when it refuses
    serve(designDir: string): Promise<string | null>;
    get(url: string): Promise<{ status: HttpStatus; lastModified: number | null; json?: unknown }>;
    head(url: string): Promise<{ status: HttpStatus; lastModified: number | null }>;
};

type ServerRead = { boards: CanvasBoard[]; lastModifiedMs: number | null };

function newest(a: number | null, b: number | null): number | null {
    return a == null ? b : b == null ? a : Math.max(a, b);
}

// null when the server did not answer at all, which is what sends the poll back to asking for a base
async function readServer(s: CanvasState, io: CanvasIO, base: string): Promise<ServerRead | null> {
    const res = await io.get(boardUrl(base, s.topic, CANVAS_JSON));
    if (res.status === "error") {
        return null;
    }
    const boards = boardsFromCanvasJson(res.status === HTTP_OK ? res.json : undefined);
    const heads = await Promise.all(boards.map((b) => io.head(boardUrl(base, s.topic, b.name))));
    if (heads.some((h) => h.status === "error")) {
        return null;
    }
    const lastModifiedMs = heads.reduce((m, h) => newest(m, h.lastModified), res.lastModified);
    return { boards, lastModifiedMs };
}

export async function pollCanvasOnce(s: CanvasState, io: CanvasIO, now: number): Promise<Partial<CanvasState>> {
    if (!(await io.dirExists(canvasProjectDir(s.dir)))) {
        return { status: "removed" };
    }
    const base = s.base ?? (await io.serve(canvasDesignDir(s.projectDir)));
    const read = base == null ? null : await readServer(s, io, base);
    if (read == null) {
        // the base goes too, so the next tick asks wavesrv again rather than retrying a dead one
        return { base: null, status: "server-down" };
    }
    const patch: Partial<CanvasState> = {
        base,
        status: "ready",
        boards: read.boards,
        lastModifiedMs: read.lastModifiedMs,
    };
    if (s.mode === "canvas") {
        patch.lastViewedMs = now;
        // every board is on screen, so any file passing the previous newest reloads them
        if (read.lastModifiedMs != null && s.lastModifiedMs != null && read.lastModifiedMs > s.lastModifiedMs) {
            patch.reloadKey = s.reloadKey + 1;
        }
    }
    return patch;
}

function lastModifiedOf(res: Response): number | null {
    const ms = Date.parse(res.headers.get("last-modified") ?? "");
    return Number.isNaN(ms) ? null : ms;
}

// the canvas route takes no auth key (a token in the path stands in), so straight through the http plugin (no CORS)
async function httpFetch(url: string, method: "GET" | "HEAD"): Promise<Response | null> {
    try {
        const { fetch } = await import("@tauri-apps/plugin-http");
        return await fetch(url, { method });
    } catch {
        return null;
    }
}

export const tauriCanvasIO: CanvasIO = {
    async dirExists(path) {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
        return info != null && !info.notfound;
    },
    async serve(designDir) {
        try {
            return getWebServerEndpoint() + (await RpcApi.CanvasServeCommand(TabRpcClient, designDir));
        } catch (e) {
            console.warn("canvas serve refused", designDir, e);
            return null;
        }
    },
    async get(url) {
        const res = await httpFetch(url, "GET");
        if (res == null) {
            return { status: "error", lastModified: null };
        }
        let json: unknown;
        if (res.ok) {
            json = await res.json().catch((): unknown => undefined);
        }
        return { status: res.status, lastModified: lastModifiedOf(res), json };
    },
    async head(url) {
        const res = await httpFetch(url, "HEAD");
        return res == null
            ? { status: "error", lastModified: null }
            : { status: res.status, lastModified: lastModifiedOf(res) };
    },
};

// A result that lands after the focus moved to another agent, or after the canvas was detached or re-attached
// to another topic, is dropped rather than written over the newer state.
export async function pollAndMerge(agentId: string, io: CanvasIO = tauriCanvasIO): Promise<void> {
    const s = globalStore.get(canvasStateAtom(agentId));
    if (s == null) {
        return;
    }
    const patch = await pollCanvasOnce(s, io, Date.now());
    updateCanvas(agentId, (cur) => (cur.topic === s.topic && cur.dir === s.dir ? { ...cur, ...patch } : cur));
}

export function useCanvasPoller(model: AgentsViewModel, agent: AgentVM | undefined): void {
    const id = agent?.id ?? "";
    const hasCanvas = useAtomValue(canvasStateAtom(id)) != null;
    useEffect(() => {
        if (!hasCanvas) {
            return;
        }
        let live = true;
        let busy = false;
        // a poll can outlast the interval (a port that never answers), so ticks never stack
        const tick = () => {
            if (!live || busy || globalStore.get(model.focusIdAtom) !== id) {
                return;
            }
            busy = true;
            pollAndMerge(id)
                .catch((e) => console.warn("canvas poll failed", id, e))
                .finally(() => (busy = false));
        };
        tick();
        const t = setInterval(tick, CANVAS_POLL_MS);
        return () => {
            live = false;
            clearInterval(t);
        };
    }, [model, id, hasCanvas]);
}
