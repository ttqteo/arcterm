// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Jarvis graph surface (U3) state + loaders. Module-scope jotai atoms written by async loaders via
// globalStore (mirrors memstore), so state survives the nav-switch unmount. Snapshot
// semantics: the base graph loads once per open; a dossier's attribution blooms lazily on focus and
// is cached. No live push this cycle.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";

// vault scan/read are local FS ops; bound them so a dead backend rejects instead of hanging on "Loading…".
const GRAPH_RPC_TIMEOUT_MS = 5000;

export const graphBaseAtom = atom<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null) as PrimitiveAtom<{
    nodes: GraphNode[];
    links: GraphLink[];
} | null>;
export const graphLoadedAtom = atom(false) as PrimitiveAtom<boolean>;
export const graphErrorAtom = atom(false) as PrimitiveAtom<boolean>;
export const graphSelectedIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const graphBloomAtom = atom<Map<string, { runs: GraphNode[]; links: GraphLink[] }>>(new Map()) as PrimitiveAtom<
    Map<string, { runs: GraphNode[]; links: GraphLink[] }>
>;

export async function loadGraph(): Promise<void> {
    try {
        const g = await RpcApi.VaultGraphCommand(TabRpcClient, { timeout: GRAPH_RPC_TIMEOUT_MS });
        globalStore.set(graphBaseAtom, { nodes: g.nodes ?? [], links: g.links ?? [] });
        globalStore.set(graphErrorAtom, false);
        globalStore.set(graphLoadedAtom, true);
    } catch {
        globalStore.set(graphErrorAtom, true);
        globalStore.set(graphLoadedAtom, true);
    }
}

// Select a node. For a task, also resolve + cache its attribution bloom (focusDossier); other kinds
// just select.
export function selectNode(id: string | null): void {
    globalStore.set(graphSelectedIdAtom, id);
}

// Select a run node, but only if the bloom that would carry it actually returned it. VaultGraph emits no
// run nodes, so a run is selectable only through its record's bloom — selecting an id with no node behind
// it would leave the overlay claiming a selection the canvas cannot draw.
export function selectBloomedRun(dossierId: string, runORef: string): boolean {
    const bloom = globalStore.get(graphBloomAtom).get(dossierId);
    if (!bloom?.runs?.some((r) => r.id === runORef)) {
        return false;
    }
    selectNode(runORef);
    return true;
}

export async function focusDossier(dossierId: string): Promise<void> {
    globalStore.set(graphSelectedIdAtom, dossierId);
    const bloom = globalStore.get(graphBloomAtom);
    if (bloom.has(dossierId)) return; // cached
    try {
        const r = await RpcApi.ResolveDossierEdgesCommand(
            TabRpcClient,
            { dossierid: dossierId },
            { timeout: GRAPH_RPC_TIMEOUT_MS }
        );
        const next = new Map(bloom);
        next.set(dossierId, { runs: r.runs ?? [], links: r.links ?? [] });
        globalStore.set(graphBloomAtom, next);
    } catch {
        // leave the dossier selected with no bloom; failure is non-fatal (graceful degradation).
    }
}

// The base graph is the vault's node set and a correction does not change it; the bloom IS the attribution,
// so that is the only part that goes stale.
export function invalidateBloom(dossierId: string): void {
    const next = new Map(globalStore.get(graphBloomAtom));
    if (next.delete(dossierId)) {
        globalStore.set(graphBloomAtom, next);
    }
}
