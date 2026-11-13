// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The model half of Chat's suggested replies (chatsuggest.ts has the rules and the merge): one ChatSuggestCommand per
// turn, its answer kept by turn (suggestKey) so the pane unmounting, a surface switch or a second look at the same turn
// asks nothing again. wavesrv keeps the answers too and joins a second ask for a call still running (pkg/chatsuggest).

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import type { ModelSuggest } from "./chatsuggest";

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
