// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The updates started from Settings → About, by runtime (harnessupdatemodel.ts reads them), and the dev hooks the
// harness-update scenario uses to stand in a newer release, each update state, and an empty install list.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { harnessesAtom, loadHarnesses } from "./harnessstore";
import type { UpdateRun } from "./harnessupdatemodel";

// the updater downloads a release: the server allows it 5 minutes, the wire a little more
const UPDATE_RPC_TIMEOUT_MS = 330_000;

export const updateRunsAtom = atom<Record<string, UpdateRun>>({}) as PrimitiveAtom<Record<string, UpdateRun>>;

function setRun(runtime: string, run: UpdateRun) {
    globalStore.set(updateRunsAtom, (prev) => ({ ...prev, [runtime]: run }));
}

export async function updateHarness(runtime: string): Promise<void> {
    setRun(runtime, { status: "running" });
    try {
        const rtn = await RpcApi.UpdateHarnessCommand(TabRpcClient, { runtime }, { timeout: UPDATE_RPC_TIMEOUT_MS });
        setRun(runtime, { status: "done", version: rtn?.version });
        await loadHarnesses();
    } catch (e) {
        setRun(runtime, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
}

if (import.meta.env.DEV) {
    const w = window as any;
    w.__setHarnessLatest = (runtime: string, latest: string) =>
        globalStore.set(harnessesAtom, (prev) =>
            prev.map((h) => (h.runtime === runtime ? { ...h, latestversion: latest } : h))
        );
    // a row state without running the real updater; null clears it
    w.__setHarnessUpdateRun = (runtime: string, run: UpdateRun | null) =>
        globalStore.set(updateRunsAtom, (prev) => {
            const next = { ...prev };
            if (run == null) {
                delete next[runtime];
            } else {
                next[runtime] = run;
            }
            return next;
        });
    // snapshot and restore the install list, so a scenario can show "No harness installed." and put it back
    w.__getHarnesses = () => globalStore.get(harnessesAtom);
    w.__setHarnesses = (list: HarnessInfo[]) => globalStore.set(harnessesAtom, list);
}
