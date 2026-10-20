// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Consumers panel's state: whether it is open and which measure ranked it, and its last GetConsumers reading. The poll
// runs only while the panel is open.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { ConsumersSort } from "./consumers";
import { machineServersOpenAtom } from "./machineserversstore";

export const CONSUMERS_POLL_MS = 5_000;

// null = closed
export const consumersOpenAtom = atom<ConsumersSort | null>(null) as PrimitiveAtom<ConsumersSort | null>;
// the control that opened the panel, which it hangs from (panelPlacement); null when code opened it
export const consumersOpenerAtom = atom<Element | null>(null) as PrimitiveAtom<Element | null>;

export interface ConsumersReading {
    data: CommandGetConsumersRtnData | null;
    lastOkMs: number | null;
    failed: boolean; // the last poll failed; data is the reading before it
}

export const consumersReadingAtom = atom<ConsumersReading>({
    data: null,
    lastOkMs: null,
    failed: false,
}) as PrimitiveAtom<ConsumersReading>;

export async function loadConsumers(
    read: () => Promise<CommandGetConsumersRtnData> = () => RpcApi.GetConsumersCommand(TabRpcClient),
    now: () => number = Date.now
): Promise<void> {
    try {
        const data = await read();
        globalStore.set(consumersReadingAtom, { data, lastOkMs: now(), failed: false });
    } catch {
        globalStore.set(consumersReadingAtom, (prev) => ({ ...prev, failed: true }));
    }
}

/** An opener's click: opens the panel ranked by the opener's measure, and closes it when it is open, whichever opener
 * opened it (RAM and tokens are one view). The panel hangs from `opener`. It closes the Servers popover, so only one
 * of them is open. */
export function toggleConsumers(sort: ConsumersSort, opener: Element | null = null): void {
    globalStore.set(machineServersOpenAtom, false);
    if (globalStore.get(consumersOpenAtom) != null) {
        globalStore.set(consumersOpenAtom, null);
        return;
    }
    globalStore.set(consumersOpenerAtom, opener);
    globalStore.set(consumersOpenAtom, sort);
}

/** Polls while open: one read at once, then every CONSUMERS_POLL_MS, stopped when the panel closes. */
export function useConsumersPoll(open: boolean): void {
    useEffect(() => {
        if (!open) {
            return;
        }
        void loadConsumers();
        const timer = setInterval(() => void loadConsumers(), CONSUMERS_POLL_MS);
        return () => clearInterval(timer);
    }, [open]);
}
