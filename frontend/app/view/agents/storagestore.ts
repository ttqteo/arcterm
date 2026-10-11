// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Storage report the page and the nudge share: one atom, loaded on mount and replaced by every storage:scan
// event, and the reasons the last clean skipped items, by item id.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { skippedOf } from "./storagemodel";

export const storageReportAtom = atom<StorageReport | null>(null) as PrimitiveAtom<StorageReport | null>;
// a skip reason lasts until the next clean or Rescan, so the map neither grows nor goes stale
export const storageSkippedAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

// removing a cargo target or node_modules can take a while: the RPC must outlast it
const CLEAN_TIMEOUT_MS = 10 * 60_000;

/** Reads the server's last scan. `scanIfEmpty` (the Storage page) asks for a scan when there is none yet: the
 *  server's own first scan waits 2 minutes after start, and the nudge must not move it earlier. */
export async function loadStorage(scanIfEmpty: boolean): Promise<void> {
    try {
        const report = await RpcApi.GetStorageCommand(TabRpcClient);
        globalStore.set(storageReportAtom, report);
        if (scanIfEmpty && report.scannedts === 0 && !report.scanning) {
            rescanStorage();
        }
    } catch (e) {
        // before the server starts storage this errors; the storage:scan event brings the report
        console.warn("storage: reading the report failed:", e);
    }
}

/** Keeps storageReportAtom current while mounted: a load now, then each storage:scan event's report. */
export function useStorageReport(scanIfEmpty = false): StorageReport | null {
    useEffect(() => {
        void loadStorage(scanIfEmpty);
        return waveEventSubscribeSingle({
            eventType: "storage:scan",
            handler: (event) => {
                if (event?.data != null) {
                    globalStore.set(storageReportAtom, event.data as StorageReport);
                }
            },
        });
    }, [scanIfEmpty]);
    return useAtomValue(storageReportAtom);
}

export async function cleanStorage(
    category: string,
    itemids: string[],
    opts: { olderthandays?: number; allowguarded?: boolean } = {}
): Promise<StorageCleanResult> {
    const result = await RpcApi.CleanStorageCommand(
        TabRpcClient,
        { category, itemids, ...opts },
        { timeout: CLEAN_TIMEOUT_MS }
    );
    globalStore.set(storageSkippedAtom, skippedOf(result));
    return result;
}

/** Starts a scan. The head says Scanning… at once, set before the RPC goes out: the server publishes only when a
 *  scan ends, and that event's report replaces this one. A failed ask reads the server's report back. */
export function rescanStorage(): void {
    globalStore.set(storageSkippedAtom, {});
    globalStore.set(storageReportAtom, (r) => (r == null ? r : { ...r, scanning: true }));
    fireAndForget(async () => {
        try {
            await RpcApi.RescanStorageCommand(TabRpcClient);
        } catch (e) {
            console.warn("storage: rescan failed:", e);
            await loadStorage(false);
        }
    });
}
