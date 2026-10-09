// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The heavy-job queue as the cockpit holds it (spec 2026-10-09-heavy-job-queue-design.md): wavesrv's snapshot, whether
// the Jobs popover is open and the control it hangs from. wavesrv publishes a `jobqueue` event on every change, so
// there is no poll; one read at mount covers a queue that was already moving.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { consumersOpenAtom } from "@/app/view/agents/consumersstore";
import { machineServersOpenAtom } from "@/app/view/agents/machineserversstore";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";

// null until the first reading
export const jobQueueAtom = atom<JobQueueData | null>(null) as PrimitiveAtom<JobQueueData | null>;
export const jobQueueOpenAtom = atom(false) as PrimitiveAtom<boolean>;
// the control that opened the popover, which it hangs from (panelPlacement); null when code opened it
export const jobQueueOpenerAtom = atom<Element | null>(null) as PrimitiveAtom<Element | null>;

/** The chip's click: opens the popover from the chip, or closes it when it is open. It closes the Consumers and Servers
 * popovers, so only one of them is open. */
export function toggleJobQueue(opener: Element | null = null): void {
    globalStore.set(machineServersOpenAtom, false);
    globalStore.set(consumersOpenAtom, null);
    if (globalStore.get(jobQueueOpenAtom)) {
        globalStore.set(jobQueueOpenAtom, false);
        return;
    }
    globalStore.set(jobQueueOpenerAtom, opener);
    globalStore.set(jobQueueOpenAtom, true);
}

/** Feeds jobQueueAtom: one read, then every `jobqueue` event. The event is subscribed first, and a read that lands after
 * an event is dropped, so a slow read never puts back a queue the event already moved on from. */
export function useJobQueueFeed(): void {
    useEffect(() => {
        let live = true;
        let heard = false;
        const unsub = waveEventSubscribeSingle({
            eventType: "jobqueue",
            handler: (e) => {
                heard = true;
                globalStore.set(jobQueueAtom, e.data as JobQueueData);
            },
        });
        RpcApi.GetJobQueueCommand(TabRpcClient)
            .then((data) => {
                if (live && !heard) {
                    globalStore.set(jobQueueAtom, data);
                }
            })
            .catch(() => {});
        return () => {
            live = false;
            unsub();
        };
    }, []);
}

declare global {
    interface Window {
        // DEV: the CDP scenario sets a snapshot the queue cannot make in seconds, such as a job queued over 5 minutes ago
        __jobQueueInject?: (data: JobQueueData) => void;
    }
}

if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__jobQueueInject = (data) => globalStore.set(jobQueueAtom, data);
}
