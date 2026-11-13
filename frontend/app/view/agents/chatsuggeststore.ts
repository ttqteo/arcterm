// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The model half of Chat's suggested replies (chatsuggest.ts has the rules and the merge): one ChatSuggestCommand per
// turn, its answer kept by turn (suggestKey) so the pane unmounting, a surface switch or a second look at the same turn
// asks nothing again. wavesrv keeps the answers too and joins a second ask for a call still running (pkg/chatsuggest).
// Also the initiative chip's Mark done, shared with the header popover's.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { advanceChunk, effortDetailAtom, setChunkStatus } from "@/app/view/jarvis/effortstore";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useMemo } from "react";
import type { ModelSuggest } from "./chatsuggest";
import { planEditChunks } from "./planreviewmodel";

// the turns kept: past this the oldest go
const KEEP = 40;

// the call is claude starting on haiku, 8-11 s; past this it is given up
const TIMEOUT_MS = 70_000;

declare global {
    interface Window {
        // DEV: a CDP scenario answers the call itself (no haiku call, and an answer it chooses), and reads what was asked
        __chatSuggestFake?: (data: CommandChatSuggestData) => string[] | Promise<string[]>;
    }
}

/** each turn's model answer by suggestKey, oldest first */
export const modelSuggestAtom = atom<Record<string, ModelSuggest>>({}) as PrimitiveAtom<Record<string, ModelSuggest>>;

function put(key: string, state: ModelSuggest): void {
    const cur = globalStore.get(modelSuggestAtom);
    const keys = Object.keys(cur).filter((k) => k !== key);
    const kept: Record<string, ModelSuggest> = {};
    for (const k of keys.slice(Math.max(0, keys.length - (KEEP - 1)))) {
        kept[k] = cur[k];
    }
    kept[key] = state;
    globalStore.set(modelSuggestAtom, kept);
}

/** One turn's model answer, or undefined before it is asked: a pane reads only its own turn's, so an answer landing for
 *  another agent draws nothing here. */
export function useModelSuggest(key: string | null): ModelSuggest | undefined {
    const one = useMemo(() => atom((get) => (key == null ? undefined : get(modelSuggestAtom)[key])), [key]);
    return useAtomValue(one);
}

/** Ticks `label` done on the initiative `oref`, as the header popover's Mark done does: from the active chunk it is
 *  `advance` (done, and the next one active); from any other it marks that chunk done and moves on only when nothing
 *  is active, since `advance` would finish another chunk. The initiative must be loaded (effortDetailAtom). */
export async function markChunkDone(oref: string, label: string): Promise<void> {
    const chunks = globalStore.get(effortDetailAtom).get(oref)?.chunks ?? [];
    const chunk = chunks.find((c) => c.label === label);
    if (chunk == null) {
        return;
    }
    if (chunk.status === "active") {
        await advanceChunk(oref);
        return;
    }
    await setChunkStatus(oref, chunkRef(planEditChunks(chunks), label), "done");
    const after = globalStore.get(effortDetailAtom).get(oref);
    if (!(after?.chunks ?? []).some((c) => c.status === "active")) {
        await advanceChunk(oref);
    }
}

/** The initiative `oref`'s detail, or undefined until it is loaded: a pane reads only its own. */
export function useEffortDetail(oref: string | null): Effort | undefined {
    const one = useMemo(() => atom((get) => (oref == null ? undefined : get(effortDetailAtom).get(oref))), [oref]);
    return useAtomValue(one);
}

/** Asks the model about one turn, once: a turn already asked (answered, failed or on its way) asks nothing. */
export function requestModelSuggest(key: string, data: CommandChatSuggestData): void {
    if (key in globalStore.get(modelSuggestAtom)) {
        return;
    }
    put(key, { status: "loading" });
    const fake = import.meta.env.DEV && typeof window !== "undefined" ? window.__chatSuggestFake : undefined;
    fireAndForget(async () => {
        try {
            const rtn =
                fake != null
                    ? { replies: await fake(data) }
                    : await RpcApi.ChatSuggestCommand(TabRpcClient, data, { timeout: TIMEOUT_MS });
            put(key, { status: "done", replies: rtn?.replies ?? [] });
        } catch {
            put(key, { status: "failed" });
        }
    });
}
