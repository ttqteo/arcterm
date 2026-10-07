// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Shared preferred-route state. The route pin is authoritative for run-worker launches; the
// compatibility harness setter keeps consult callers on the same persisted choice.

import { atom } from "jotai";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/app/store/global";
import { capabilityFor, leadRuntimes, normalizeRoute } from "./route";

export { leadRuntimes };

export interface HarnessPreferenceState {
    route: RoutePin | null;
    persistedRoute: RoutePin | null;
    saving: boolean;
    error?: string;
}

export const emptyHarnessPreference: HarnessPreferenceState = {
    route: null,
    persistedRoute: null,
    saving: false,
};

export const harnessPreferenceAtom = atom<HarnessPreferenceState>(emptyHarnessPreference);
export const harnessesAtom = atom<HarnessInfo[]>([]);
export const harnessesLoadingAtom = atom(false);
// the runtimes a run lead (and its reviewers) may use; the pickers of those two roles list only these
export const leadRuntimesAtom = atom((get) => leadRuntimes(get(harnessesAtom)));

export function resolveDefaultRuntime(pref: string, harnesses: HarnessInfo[]): string {
    if (pref && harnesses.some((h) => h.runtime === pref && h.installed && h.runworkercapable)) {
        return pref;
    }
    const first = harnesses.find((h) => h.installed && h.runworkercapable);
    return first ? first.runtime : "";
}

export function beginSave(state: HarnessPreferenceState, route: RoutePin): HarnessPreferenceState {
    return { route, persistedRoute: state.persistedRoute, saving: true };
}

export function persistSave(state: HarnessPreferenceState): HarnessPreferenceState {
    return { route: state.route, persistedRoute: state.route, saving: false, error: undefined };
}

export function failSave(state: HarnessPreferenceState, error: string): HarnessPreferenceState {
    return { route: state.persistedRoute, persistedRoute: state.persistedRoute, saving: false, error };
}

export function setPreferredRoute(route: RoutePin): void {
    const current = globalStore.get(harnessPreferenceAtom);
    const same =
        current.route != null &&
        current.route.runtime === route.runtime &&
        (current.route.model ?? "") === (route.model ?? "");
    if (current.saving || same) {
        return;
    }
    globalStore.set(harnessPreferenceAtom, beginSave(current, route));
    void (async () => {
        try {
            // the server takes the pair together; an empty model clears the previous runtime's model
            const patch: Record<string, string> = {
                "harness:preferredruntime": route.runtime,
                "harness:preferredmodel": route.model ?? "",
            };
            await RpcApi.SetConfigCommand(TabRpcClient, patch as Parameters<typeof RpcApi.SetConfigCommand>[1]);
            globalStore.set(harnessPreferenceAtom, persistSave(globalStore.get(harnessPreferenceAtom)));
        } catch (e) {
            globalStore.set(harnessPreferenceAtom, failSave(globalStore.get(harnessPreferenceAtom), String(e)));
        }
    })();
}

// Consult still passes a runtime string. Pick a backend-provided route rather than manufacturing a pair.
export function setPreferredHarness(runtime: string): void {
    const current = globalStore.get(harnessPreferenceAtom);
    const harness = globalStore.get(harnessesAtom).find((h) => h.runtime === runtime);
    const route = harness?.routecapabilities?.find((c) => (c.model ?? "") === "");
    if (route == null) {
        globalStore.set(harnessPreferenceAtom, { ...current, error: `No route capability available for ${runtime}` });
        return;
    }
    // re-picking the harness already in use must not discard its model pin; a model id belongs to one
    // harness's namespace, so switching harnesses does drop it
    const model = current.route?.runtime === runtime ? current.route.model : undefined;
    setPreferredRoute({ runtime: route.runtime, ...(model ? { model } : {}) });
}

export function initHarnessPreference(persistedRuntime: string, persistedModel = ""): void {
    const current = globalStore.get(harnessPreferenceAtom);
    if (current.saving) {
        return;
    }
    const route = normalizeRoute(persistedRuntime, persistedModel);
    globalStore.set(harnessPreferenceAtom, { route, persistedRoute: route, saving: false });
}

// A cold listharnesses spawns one CLI per harness to enumerate its models (`pi --list-models`,
// `opencode models`, `claude --help`), serialized server-side; that measured 5.3s against the RPC
// layer's 5s DefaultTimeoutMs, so the picker loaded or came up empty depending on machine luck. The
// budget has to cover the process spawns, not the wire.
const CATALOG_RPC_TIMEOUT_MS = 30_000;

export async function loadHarnesses(forceRefresh = false): Promise<void> {
    globalStore.set(harnessesLoadingAtom, true);
    try {
        await fetchHarnesses(forceRefresh);
    } finally {
        globalStore.set(harnessesLoadingAtom, false);
    }
}

async function fetchHarnesses(forceRefresh: boolean): Promise<void> {
    if (forceRefresh) {
        // the catalog is cached server-side; only a forced refresh re-enumerates installed CLIs
        try {
            await RpcApi.RefreshRouteCatalogCommand(TabRpcClient);
        } catch (e) {
            console.error("refreshing route catalog failed", e);
        }
    }
    try {
        const rtn = await RpcApi.ListHarnessesCommand(TabRpcClient, { timeout: CATALOG_RPC_TIMEOUT_MS });
        globalStore.set(harnessesAtom, rtn?.harnesses ?? []);
    } catch (e) {
        // a failed re-list must not empty a catalog that already loaded — the picker would fall back
        // to "Unknown: <runtime>" for a selection that is in fact valid
        console.error("loading harness catalog failed", e);
    }
}

export async function refreshHarnessCatalog(): Promise<void> {
    return loadHarnesses(true);
}

export function preferredCapability(route: RoutePin | null): RouteCapabilityInfo | undefined {
    return route == null ? undefined : capabilityFor(route, globalStore.get(harnessesAtom));
}
