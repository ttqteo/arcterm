// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The benchmark chart's state (docs/superpowers/plans/2026-11-19-council-figures.md, figure F): the bench results
// wavesrv holds (`wsh council bench results`'s rows), and whether the chart's section is open. The chart is
// councilbenchchart.tsx; the numbers it draws are councilfiguresmodel.ts's `benchPoints`.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";

/** The bench results as last loaded, or null before the first load (and while the first load has not answered). */
export const benchResultsAtom = atom(null) as PrimitiveAtom<CouncilBenchResultsRtnData | null>;

/** Reads the bench results from wavesrv into `benchResultsAtom`. `RpcApi` is read at call time, so a scenario's `stubRpc`
 *  stand-in answers. A failed read is a logged line and `null`; the atom keeps what it held. */
export async function loadBenchResults(): Promise<CouncilBenchResultsRtnData | null> {
    try {
        const res = await RpcApi.CouncilBenchResultsCommand(TabRpcClient);
        globalStore.set(benchResultsAtom, res);
        return res;
    } catch (err) {
        console.error("loading the council bench results failed", err);
        return null;
    }
}

/** localStorage key of the section's fold: "1" open, anything else folded. */
export const BENCH_OPEN_KEY = "council.benchOpen";

/** Whether the person left the Benchmark section open. Folded by default, and when storage is blocked. */
export function readBenchOpen(): boolean {
    try {
        return window.localStorage.getItem(BENCH_OPEN_KEY) === "1";
    } catch {
        return false;
    }
}

/** Remembers the section's fold across reloads; a blocked storage leaves it to this session. */
export function writeBenchOpen(open: boolean): void {
    try {
        window.localStorage.setItem(BENCH_OPEN_KEY, open ? "1" : "0");
    } catch {
        // per-viewer convenience only
    }
}
