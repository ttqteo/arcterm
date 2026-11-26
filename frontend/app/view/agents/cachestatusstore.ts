// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Focused-agent prompt-cache-expiry status: a thin whole-file scan of the agent's transcript via
// GetCacheStatusCommand (reuses the Historical scan's cache-write parsing). Mirrors tokenstore.ts's
// stale-load guard so a slow load for a previous focus can't overwrite a newer one.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { agentMemory } from "./agentmemory";

export interface CacheStatus {
    lastWriteTs: number; // epoch seconds
    oneHour: boolean;
}

export const agentCacheStatusAtom = atom<CacheStatus | null>(null) as PrimitiveAtom<CacheStatus | null>;

const current = { id: "" };

// each agent's last status, so a switch back shows its countdown at once while it is read again (agentmemory.ts)
const cacheMemory = agentMemory<CacheStatus>();

function showCacheStatus(id: string, status: CacheStatus | null): void {
    if (status == null) {
        cacheMemory.delete(id);
    } else {
        cacheMemory.set(id, status);
    }
    globalStore.set(agentCacheStatusAtom, status);
}

// silent: a periodic refresh of the same agent — keep the last status on screen while in flight and on
// failure, so the countdown doesn't blink out every poll. A switch to an agent read before does the same with its
// remembered status.
export async function loadCacheStatusForAgent(
    id: string,
    transcriptPath: string | undefined,
    opts?: { silent?: boolean }
): Promise<void> {
    current.id = id;
    if (!transcriptPath) {
        if (!opts?.silent) {
            showCacheStatus(id, null);
        }
        return;
    }
    const remembered = opts?.silent ? undefined : cacheMemory.get(id);
    const silent = opts?.silent || remembered != null;
    if (!opts?.silent) {
        globalStore.set(agentCacheStatusAtom, remembered ?? null);
    }
    try {
        const rtn = await RpcApi.GetCacheStatusCommand(TabRpcClient, { path: transcriptPath });
        if (current.id !== id) {
            return;
        }
        showCacheStatus(id, rtn.lastwritets ? { lastWriteTs: rtn.lastwritets, oneHour: !!rtn.onehour } : null);
    } catch {
        if (current.id === id && !silent) {
            showCacheStatus(id, null);
        }
    }
}

// Pure: ttl = 3600s (extended bucket) or 300s (default bucket) minus elapsed time since the last
// cache write. null -> "—" (no cache activity yet); <=0 remaining -> "expired".
export function formatCacheCountdown(status: CacheStatus | null, nowMs: number): string {
    if (status == null) {
        return "—";
    }
    const ttlSec = status.oneHour ? 3600 : 300;
    // clamp elapsed to >=0 so a stale/behind clock can never inflate the countdown past the TTL
    // (a frozen now once produced impossible values like "105m left").
    const elapsedSec = Math.max(0, nowMs / 1000 - status.lastWriteTs);
    const remainingSec = ttlSec - elapsedSec;
    if (remainingSec <= 0) {
        return "expired";
    }
    const mins = Math.floor(remainingSec / 60);
    return mins < 1 ? "<1m left" : `${mins}m left`;
}
