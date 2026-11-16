// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DUM-E's status as the Brief reads it: wavesrv's snapshot, kept current by its `dume:changed` event. wavesrv owns the
// status (the loop writes it each tick), so there is no poll here: one read, then the events.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";

// null until the first reading
export const dumeStatusAtom = atom<DumeStatusData | null>(null) as PrimitiveAtom<DumeStatusData | null>;

let feeding = false;

/** Feeds dumeStatusAtom: one read, then every `dume:changed` event. Idempotent, and never unmounted. The event is
 * subscribed first, and a read that lands after an event is dropped, so a slow read never puts back a status the event
 * already moved on from. */
export function ensureDumeFeed(): void {
    if (feeding) {
        return;
    }
    feeding = true;
    let heard = false;
    waveEventSubscribeSingle({
        eventType: "dume:changed",
        handler: (e) => {
            heard = true;
            globalStore.set(dumeStatusAtom, (e.data as DumeStatusData | undefined) ?? null);
        },
    });
    RpcApi.DumeStatusCommand(TabRpcClient)
        .then((data) => {
            if (!heard) {
                globalStore.set(dumeStatusAtom, data ?? null);
            }
        })
        .catch(() => {});
}
