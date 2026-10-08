// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Consumers panel's state: whether it is open and on which sort, and its last GetConsumers reading. The poll
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

/** An opener's click: opens on its sort, closes when the panel already shows that sort, else switches to it. It
 *  closes the Servers popover, which rises from the same corner. */
export function toggleConsumers(sort: ConsumersSort): void {
    globalStore.set(machineServersOpenAtom, false);
    globalStore.set(consumersOpenAtom, (cur) => (cur === sort ? null : sort));
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
