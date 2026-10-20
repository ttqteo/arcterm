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
            resendSeenIfRefused();
        },
    });
    RpcApi.ServicesStatusCommand(TabRpcClient)
        .then((data) => {
            if (!heard) {
                globalStore.set(servicesAtom, data?.services ?? []);
            }
            resendSeenIfRefused();
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

let lastSeen: string[] | null = null;
let seenSerial = 0;
// the latest report was refused (wavesrv's services are not up yet: a refused report is lost, not recorded)
let seenRefused = false;

/** Tells wavesrv which services are on screen (serviceseen.ts), the whole set: each report replaces the last. A service
 * newly on screen starts if it sleeps, and one that left starts its ten minutes. wavesrv runs a wake inside the call, so
 * this is never awaited by the UI; a failure is logged, and a refused report is sent again at the next services read
 * or `services:changed` (resendSeenIfRefused). */
export function reportServicesSeen(ids: string[]): void {
    const serial = ++seenSerial;
    lastSeen = ids;
    RpcApi.ServiceSeenCommand(TabRpcClient, { ids })
        .then(() => {
            if (serial === seenSerial) {
                seenRefused = false;
            }
        })
        .catch((e) => {
            console.error("ServiceSeenCommand failed", e);
            if (serial === seenSerial) {
                seenRefused = true;
            }
        });
}

function resendSeenIfRefused(): void {
    if (seenRefused && lastSeen != null) {
        seenRefused = false;
        reportServicesSeen(lastSeen);
    }
}

/** "Keep running": on writes `autostart: true` into the tool's tools.json entry, off drops the key. It is the person's
 * own click, so it goes through ToolsSetUserCommand like any Setup → Tools edit. */
export async function setServiceAutostart(id: string, on: boolean): Promise<void> {
    const entry = globalStore.get(atoms.fullConfigAtom)?.tools?.[id];
    if (!entry) {
        return;
    }
    await addUserTool(id, withAutostart(entry, on));
}
