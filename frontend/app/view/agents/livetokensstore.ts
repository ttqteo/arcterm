// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Each live agent's token total, by agent id, for its Active row: its own transcript read through GetTranscriptUsageCommand
// (the count the details rail's Usage shows), again whenever livetokens.ts says it moved. An agent not read yet, or whose
// read failed, is absent, and its row shows no total.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect, useRef } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { tokenReloads, watchOf, type TokenWatch } from "./livetokens";
import { aggregateSessionUsage } from "./sessionusage";

type Totals = ReadonlyMap<string, number>;

export const liveTokensAtom = atom<Totals>(new Map()) as PrimitiveAtom<Totals>;

// the transcript each agent's last read was for, so a slow read of a transcript it has since left cannot land
const reading = new Map<string, string>();

async function loadLiveTokens(id: string, path: string): Promise<void> {
    reading.set(id, path);
    try {
        const rtn = await RpcApi.GetTranscriptUsageCommand(TabRpcClient, { path });
        if (reading.get(id) !== path) {
            return;
        }
        const total = aggregateSessionUsage(rtn.buckets ?? []).totalTokens;
        globalStore.set(liveTokensAtom, (prev) => new Map(prev).set(id, total));
    } catch (e) {
        // keep the last total: the next turn's end reads it again
        console.warn("live tokens load failed", path, e);
    }
}

export function useLiveTokens(agents: AgentVM[]): void {
    const prev = useRef<Map<string, TokenWatch>>(new Map());
    const key = agents.map((a) => `${a.id}|${a.state}|${a.transcriptPath ?? ""}`).join(",");
    useEffect(() => {
        const next = watchOf(agents);
        for (const id of tokenReloads(prev.current, agents)) {
            fireAndForget(() => loadLiveTokens(id, next.get(id)!.path));
        }
        prev.current = next;
        const cur = globalStore.get(liveTokensAtom);
        if ([...cur.keys()].some((id) => !next.has(id))) {
            globalStore.set(liveTokensAtom, new Map([...cur].filter(([id]) => next.has(id))));
            for (const id of [...reading.keys()].filter((id) => !next.has(id))) {
                reading.delete(id);
            }
        }
    }, [key]);
}
