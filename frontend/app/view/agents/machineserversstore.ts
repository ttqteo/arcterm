// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The footer's Servers state: whether the popover is open and the last ListAllDevServers reading. The panel, mounted
// once in cockpit-root, polls: slowly for the chip, fast while open, never while the window is hidden.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { DevServerRow } from "./devserversmodel";
import { machinePollMs } from "./machineservers";

export const machineServersOpenAtom = atom(false) as PrimitiveAtom<boolean>;

export interface MachineServersReading {
    servers: DevServerRow[] | null; // null until the first reading
    failed: boolean; // the last poll failed; servers is the reading before it
}

export const machineServersReadingAtom = atom<MachineServersReading>({
    servers: null,
    failed: false,
}) as PrimitiveAtom<MachineServersReading>;

let inflight = false;

export async function loadMachineServers(
    read: () => Promise<CommandListDevServersRtnData> = () => RpcApi.ListAllDevServersCommand(TabRpcClient)
): Promise<void> {
    if (inflight) {
        return;
    }
    inflight = true;
    try {
        const rtn = await read();
        globalStore.set(machineServersReadingAtom, { servers: (rtn.servers ?? []) as DevServerRow[], failed: false });
    } catch {
        globalStore.set(machineServersReadingAtom, (prev) => ({ ...prev, failed: true }));
    } finally {
        inflight = false;
    }
}

export function useMachineServersPoll(open: boolean): void {
    useEffect(() => {
        const poll = () => {
            if (!document.hidden) {
                fireAndForget(() => loadMachineServers());
            }
        };
        poll();
        const timer = setInterval(poll, machinePollMs(open));
        return () => clearInterval(timer);
    }, [open]);
}

// drops a stopped server's row at once; the next poll confirms
export function forgetMachineServer(row: DevServerRow): void {
    globalStore.set(machineServersReadingAtom, (prev) => ({
        ...prev,
        servers: prev.servers?.filter((s) => !(s.pid === row.pid && s.createms === row.createms)) ?? null,
    }));
}
