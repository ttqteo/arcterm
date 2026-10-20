// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Held services as the cockpit holds them (spec 2026-10-20-held-services-design.md): wavesrv's snapshot, kept current by
// its `services:changed` event, and the commands that move a service. wavesrv owns every state, so there is no poll and
// no optimistic write here: an action asks, and the event brings the answer.

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { withAutostart } from "./servicesmodel";
import { addUserTool } from "./toolsstore";

// null until the first reading
export const servicesAtom = atom<ServiceStatus[] | null>(null) as PrimitiveAtom<ServiceStatus[] | null>;

/** The services that have a tab, by tab id. */
export const serviceByTabAtom = atom((get) => {
    const byTab: Record<string, ServiceStatus> = {};
    for (const s of get(servicesAtom) ?? []) {
        if (s.tabid) {
            byTab[s.tabid] = s;
        }
    }
    return byTab;
});

let feeding = false;

/** Feeds servicesAtom: one read, then every `services:changed` event. Idempotent, and never unmounted: the chip, the
 * tree and the header all read the one atom. The event is subscribed first, and a read that lands after an event is
 * dropped, so a slow read never puts back a list the event already moved on from. */
export function ensureServicesFeed(): void {
    if (feeding) {
        return;
    }
    feeding = true;
    let heard = false;
    waveEventSubscribeSingle({
        eventType: "services:changed",
        handler: (e) => {
            heard = true;
            globalStore.set(servicesAtom, (e.data as ServicesData | undefined)?.services ?? []);
        },
    });
    RpcApi.ServicesStatusCommand(TabRpcClient)
        .then((data) => {
            if (!heard) {
                globalStore.set(servicesAtom, data?.services ?? []);
            }
        })
        .catch(() => {});
}

// puts one status into the list (by id), so a caller that opened a service sees its tab before the event arrives
function upsert(status: ServiceStatus): void {
    const list = globalStore.get(servicesAtom) ?? [];
    const at = list.findIndex((s) => s.id === status.id);
    globalStore.set(servicesAtom, at < 0 ? [...list, status] : list.map((s, i) => (i === at ? status : s)));
}

/** Gives the service its tab and block without starting it, and returns its status. null when wavesrv refuses. */
export async function openService(id: string): Promise<ServiceStatus | null> {
    try {
        const status = await RpcApi.ServiceOpenCommand(TabRpcClient, { id });
        if (status) {
            upsert(status);
        }
        return status ?? null;
    } catch {
        return null;
    }
}

export async function startService(id: string): Promise<void> {
    await RpcApi.ServiceStartCommand(TabRpcClient, { id });
}

export async function stopService(id: string): Promise<void> {
    await RpcApi.ServiceStopCommand(TabRpcClient, { id });
}

export async function restartService(id: string): Promise<void> {
    await RpcApi.ServiceRestartCommand(TabRpcClient, { id });
}

/** "Start with arcterm": off writes `autostart: false` into the tool's tools.json entry, on drops the key. It is the
 * person's own click, so it goes through ToolsSetUserCommand like any Setup → Tools edit. */
export async function setServiceAutostart(id: string, on: boolean): Promise<void> {
    const entry = globalStore.get(atoms.fullConfigAtom)?.tools?.[id];
    if (!entry) {
        return;
    }
    await addUserTool(id, withAutostart(entry, on));
}
