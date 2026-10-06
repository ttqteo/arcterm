// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The worker-capacity reading, shared by the app bar chip and the worker steppers: one poll however many of
// them are mounted, started by the first and stopped by the last.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { WorkerCapacity } from "./workercapacity";

export const POLL_MS = 5_000;

// null until the first reading and after a failed one: a stale "+2" is worse than no chip
export const workerCapacityAtom = atom<WorkerCapacity | null>(null) as PrimitiveAtom<WorkerCapacity | null>;

let failing = false;

export async function loadWorkerCapacity(
    read: () => Promise<WorkerCapacity> = () => RpcApi.GetWorkerCapacityCommand(TabRpcClient)
): Promise<void> {
    try {
        globalStore.set(workerCapacityAtom, await read());
        failing = false;
    } catch (e) {
        globalStore.set(workerCapacityAtom, null);
        // once per failure streak: a wavesrv without the command fails every poll
        if (!failing) {
            console.warn("worker capacity:", e);
        }
        failing = true;
    }
}

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Joins the shared poll; the first user starts it (loading at once), the returned release leaves it, and the
 * last release stops it. Releasing twice counts once. */
export function acquireCapacityPoll(load: () => void = () => void loadWorkerCapacity()): () => void {
    users++;
    if (timer == null) {
        load();
        timer = setInterval(load, POLL_MS);
    }
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        users--;
        if (users === 0 && timer != null) {
            clearInterval(timer);
            timer = null;
        }
    };
}

export function useWorkerCapacity(): WorkerCapacity | null {
    useEffect(() => acquireCapacityPoll(), []);
    return useAtomValue(workerCapacityAtom);
}
