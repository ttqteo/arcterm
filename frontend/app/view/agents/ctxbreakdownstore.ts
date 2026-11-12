// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The context breakdown per folder (GetContextBreakdownCommand): read only when asked (Read the breakdown, Refresh),
// since one read boots a headless Claude Code session for ~30 s. wavesrv keeps it 30 min per folder; this keeps the
// last answer per folder for the session, and a stale-load guard so a late reply for one press cannot overwrite the next.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

export type CtxState =
    | { state: "idle" }
    | { state: "reading"; prev?: ContextBreakdown }
    | { state: "ready"; data: ContextBreakdown }
    | { state: "failed"; error: string };

export const ctxBreakdownAtom = atomFamily((_cwd: string) => atom<CtxState>({ state: "idle" }));
const seq = new Map<string, number>();

export async function readCtxBreakdown(cwd: string, refresh: boolean): Promise<void> {
    const a = ctxBreakdownAtom(cwd);
    const n = (seq.get(cwd) ?? 0) + 1;
    seq.set(cwd, n);
    const cur = globalStore.get(a);
    globalStore.set(a, { state: "reading", prev: cur.state === "ready" ? cur.data : undefined });
    try {
        const data = await RpcApi.GetContextBreakdownCommand(TabRpcClient, { cwd, refresh }, { timeout: 120_000 });
        if (seq.get(cwd) === n) {
            globalStore.set(a, { state: "ready", data });
        }
    } catch (e) {
        if (seq.get(cwd) === n) {
            globalStore.set(a, { state: "failed", error: String((e as Error)?.message ?? e) });
        }
    }
}

// scenarios seed any state (idle, reading, ready, failed) without spawning claude; seeding bumps seq so a reply
// still in flight cannot overwrite it
declare global {
    interface Window {
        __arcCtxBreakdown?: { seed: (cwd: string, s: CtxState) => void };
    }
}
if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__arcCtxBreakdown = {
        seed: (cwd, s) => {
            seq.set(cwd, (seq.get(cwd) ?? 0) + 1);
            globalStore.set(ctxBreakdownAtom(cwd), s);
        },
    };
}
