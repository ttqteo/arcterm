// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The servers listening in each agent's project, polled while the rail is mounted: the backend has no sweeper, so the
// rail asks (pkg/devservers, ListDevServers) and keeps the last answer here, keyed by agent id. Labels, matching and the
// poll interval are devserversmodel.ts; agentdetailsrail.tsx renders.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { pollMs, type DevServerRow } from "./devserversmodel";

export interface DevServersEntry {
    servers: DevServerRow[];
    // the last poll failed; servers still holds the last one that worked
    failed: boolean;
}

const NONE: DevServersEntry = { servers: [], failed: false };

// agent id -> its project's listening servers
type DevServersByAgent = Record<string, DevServersEntry>;

export const devServersAtom = atom<DevServersByAgent>({}) as PrimitiveAtom<DevServersByAgent>;

// own keys only: a lookup should never read an Object.prototype member
function entryFor(map: DevServersByAgent, agentId: string): DevServersEntry | undefined {
    return Object.prototype.hasOwnProperty.call(map, agentId) ? map[agentId] : undefined;
}

function writeEntry(agentId: string, next: (prev: DevServersEntry) => DevServersEntry): void {
    globalStore.set(devServersAtom, (map) => ({ ...map, [agentId]: next(entryFor(map, agentId) ?? NONE) }));
}

// Polls the agent's project for listening servers: at once, then every pollMs(railVisible), none while the window is
// hidden. With neither a cwd nor a block id (a subagent's interior, an ended session) nothing is asked and nothing
// is listed. A failed poll keeps the last servers and marks the entry failed; a reply that lands after the inputs
// changed or the rail unmounted is dropped.
export function useDevServers(
    agentId: string,
    cwd: string | null,
    blockId: string | undefined,
    railVisible: boolean
): DevServersEntry {
    const stored = entryFor(useAtomValue(devServersAtom), agentId);
    const active = Boolean(cwd) || Boolean(blockId);
    useEffect(() => {
        if (!active) {
            return;
        }
        let cancelled = false;
        let inflight = false;
        const poll = async () => {
            // one ask at a time, so a slow sweep never lets an older reply land after a newer one
            if (document.hidden || inflight) {
                return;
            }
            inflight = true;
            try {
                // the rail-servers CDP scenario's way to the failed state; DEV is statically false in a build
                if (import.meta.env.DEV && (window as any).__arcDevServersFail) {
                    throw new Error("dev servers: fault injected");
                }
                const rtn = await RpcApi.ListDevServersCommand(TabRpcClient, {
                    cwd: cwd ?? undefined,
                    blockid: blockId,
                });
                if (!cancelled) {
                    // the generated Server types owner.kind as string; Go only writes the four devservers.Owner* kinds
                    writeEntry(agentId, () => ({ servers: (rtn.servers ?? []) as DevServerRow[], failed: false }));
                }
            } catch {
                if (!cancelled) {
                    writeEntry(agentId, (prev) => ({ servers: prev.servers, failed: true }));
                }
            } finally {
                inflight = false;
            }
        };
        fireAndForget(poll);
        const timer = setInterval(() => fireAndForget(poll), pollMs(railVisible));
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [agentId, cwd, blockId, railVisible, active]);
    return active && stored != null ? stored : NONE;
}

// Stops the server and its descendants (the backend refuses a reused PID), then drops its row from every agent's
// list at once; the next poll confirms. The same process can be listed under two agents that share a project, and
// pid + createms names one process, so the row goes from all of them. A failed stop throws and leaves the row.
export async function stopDevServer(row: DevServerRow): Promise<void> {
    await RpcApi.StopDevServerCommand(TabRpcClient, { pid: row.pid, createms: row.createms });
    globalStore.set(devServersAtom, (map) =>
        Object.fromEntries(
            Object.entries(map).map(([id, entry]) => [
                id,
                {
                    ...entry,
                    servers: entry.servers.filter((s) => !(s.pid === row.pid && s.createms === row.createms)),
                },
            ])
        )
    );
}
