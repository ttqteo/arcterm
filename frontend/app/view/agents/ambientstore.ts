// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ambient attribution state. Module-scope so the map survives a surface unmount (only the Agent surface
// stays mounted). One whole-vault read backs every tagged row on every surface — the alternative, a
// lookup per row, would be an RPC per rendered item.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { makeAmbientProvider } from "./ambient";

// ResolveAmbient sweeps every dossier against every run and shells out to git for commit subjects, so
// the 5s default RPC budget is not enough against a populated vault.
const AMBIENT_TIMEOUT_MS = 30_000;

const ambientDataAtom = atom<CommandResolveAmbientRtnData | null>(
    null
) as PrimitiveAtom<CommandResolveAmbientRtnData | null>;

export const ambientProviderAtom = atom((get) => makeAmbientProvider(get(ambientDataAtom)));

let inflight: Promise<void> | null = null;
let loaded = false;

// ensureAmbient loads the attribution map once per session; every ambient component calls it on mount and
// all but the first call is a no-op. A failure leaves the empty map in place and only warns: ambient data
// decorates a row, it is never a surface's primary content, so it must not surface an error.
export function ensureAmbient(): void {
    if (loaded || inflight != null) {
        return;
    }
    inflight = (async () => {
        try {
            const rtn = await RpcApi.ResolveAmbientCommand(TabRpcClient, { timeout: AMBIENT_TIMEOUT_MS });
            globalStore.set(ambientDataAtom, rtn ?? null);
            loaded = true;
        } catch (e) {
            console.warn("ambient attribution unavailable", e);
        } finally {
            inflight = null;
        }
    })();
}

// A correction changes attribution everywhere the ambient layer draws a tag — run bodies,
// Memory rows — not just the surface the user corrected it on. Clearing the once-per-session latch and
// re-reading is the whole mechanism; there is no per-object invalidation because the read is whole-vault.
export function reloadAmbient(): void {
    loaded = false;
    ensureAmbient();
}
