// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Usage surface store: raw wire buckets + the impure loader. The scan runs in the Go backend
// (GetUsageStatsCommand walks every in-window transcript, no file cap); this stores the raw buckets
// and exposes aggregateBuckets over them (all-history when no harness filter is applied — the
// surface's filtered stats come from the view model). On RPC failure the last-good buckets are kept
// (a transient websocket drop must not blank the surface) and usageErrorAtom is set.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { aggregateBuckets } from "./usagestats";

const DEFAULT_WINDOW_DAYS = 7;

export const usageBucketsAtom = atom<UsageBucket[]>([]) as PrimitiveAtom<UsageBucket[]>;
export const allUsageStatsAtom = atom((get) => aggregateBuckets(get(usageBucketsAtom), Date.now(), "all"));
export const usageErrorAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
export const usageLoadedAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

// UsageSurface toggle selections live here, not in surface-local useState: the surface unmounts on
// nav-rail switch (only the Agent surface stays mounted), so component state would reset to default
// on every tab switch. Module-level atoms keep the user's window/metric choice across unmount.
export const usageWindowAtom = atom<"7d" | "all">("7d");
export const usageMetricAtom = atom<"tokens" | "spend">("tokens");
// true once the person has picked a provider tab (click or key). Until then the surface writes the busiest
// provider into usageHarnessFilterAtom; after, the person's tab is left alone.
export const usageTabChosenAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

// DEV-only fixture seam: a deterministic localStorage array of wire buckets (see the usage-charts CDP
// scenario). Compiled out behaviorally in production because import.meta.env.DEV is false. Malformed
// or absent fixtures fall through to the RPC.
const DEV_USAGE_FIXTURE_KEY = "wave:dev-usage-buckets";

function devUsageBuckets(): UsageBucket[] | undefined {
    if (!import.meta.env.DEV || typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(DEV_USAGE_FIXTURE_KEY);
    if (raw == null) return undefined;
    try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

// Monotonic request id: the latest loadUsage wins. Replaces a single `loading` bool that silently
// dropped a window switch fired while a prior load was in flight (and let a slow prior-window response
// land after the switch and clobber the new window's data). Now a switch always issues a fresh request
// and any older, still-in-flight response is ignored on resolve.
let loadSeq = 0;
// the window the held buckets were requested for; undefined until the first load
let heldWindowDays: number | undefined;

export async function loadUsage(windowDays = DEFAULT_WINDOW_DAYS): Promise<void> {
    const seq = ++loadSeq;
    // the skeleton shows only while a different window loads. Reopening the surface, like the 60s
    // refresh, keeps the buckets it already holds on screen and replaces them when the scan returns.
    if (windowDays !== heldWindowDays) {
        heldWindowDays = windowDays;
        globalStore.set(usageLoadedAtom, false);
    }
    try {
        const fixture = devUsageBuckets();
        const buckets = fixture ?? (await RpcApi.GetUsageStatsCommand(TabRpcClient, { windowdays: windowDays })).buckets ?? [];
        if (seq !== loadSeq) {
            return; // a newer load superseded this one — ignore its result
        }
        globalStore.set(usageBucketsAtom, buckets);
        globalStore.set(usageErrorAtom, false);
    } catch {
        if (seq !== loadSeq) {
            return;
        }
        // keep the last-good buckets; surface a subtle "couldn't refresh" instead of blanking
        globalStore.set(usageErrorAtom, true);
    } finally {
        if (seq === loadSeq) {
            globalStore.set(usageLoadedAtom, true);
        }
    }
}
