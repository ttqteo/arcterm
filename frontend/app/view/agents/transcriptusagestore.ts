// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Focused-agent per-session usage: buckets for the agent's own transcript (GetTranscriptUsageCommand)
// folded via aggregateSessionUsage. Mirrors tokenstore.ts's stale-load guard so a slow load for a
// previous focus can't overwrite a newer one. A silent reload (the rail's refresh tick) keeps the
// last-good value instead of blanking to the skeleton.
//
// null is loading and nothing else: an agent with no transcript, or a load that failed, is "unavailable",
// so the section can say so instead of showing its skeleton forever.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { agentMemory } from "./agentmemory";
import { aggregateSessionUsage, type SessionUsage } from "./sessionusage";

export const UsageUnavailable = "unavailable";
export type SessionUsageState = SessionUsage | typeof UsageUnavailable | null;

export const sessionUsageAtom = atom<SessionUsageState>(null) as PrimitiveAtom<SessionUsageState>;

const current = { id: "" };

// each agent's last usage, so a switch back shows its spend at once while it is read again (agentmemory.ts)
const usageMemory = agentMemory<SessionUsage>();

export async function loadSessionUsage(
    id: string,
    transcriptPath: string | undefined,
    opts?: { silent?: boolean }
): Promise<void> {
    current.id = id;
    if (!transcriptPath) {
        usageMemory.delete(id);
        globalStore.set(sessionUsageAtom, UsageUnavailable);
        return;
    }
    // an agent read before re-reads the way a silent reload does: its last usage stays on screen, and on a failure too
    const remembered = opts?.silent ? undefined : usageMemory.get(id);
    const silent = opts?.silent || remembered != null;
    if (!opts?.silent) {
        globalStore.set(sessionUsageAtom, remembered ?? null);
    }
    try {
        const rtn = await RpcApi.GetTranscriptUsageCommand(TabRpcClient, { path: transcriptPath });
        if (current.id === id) {
            const usage = aggregateSessionUsage(rtn.buckets ?? []);
            usageMemory.set(id, usage);
            globalStore.set(sessionUsageAtom, usage);
        }
    } catch (e) {
        console.warn("session usage load failed", transcriptPath, e);
        if (current.id === id && !silent) {
            globalStore.set(sessionUsageAtom, UsageUnavailable);
        }
    }
}
