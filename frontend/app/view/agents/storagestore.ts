// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Storage report the page and the nudge share: one atom, loaded on mount and replaced by every storage:scan
// event, the reasons the last clean skipped items, by item id, and the items a clean is removing now. Also the two
// commands that size build output, which the server runs and reports back as the report's `sizing`.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { skippedOf, withoutCleaned } from "./storagemodel";

export const storageReportAtom = atom<StorageReport | null>(null) as PrimitiveAtom<StorageReport | null>;
// a skip reason lasts until the next clean or Rescan, so the map neither grows nor goes stale
export const storageSkippedAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;
// the ids a clean has in hand, so their buttons say Removing… until the RPC returns
export const storageCleaningAtom = atom<Record<string, true>>({}) as PrimitiveAtom<Record<string, true>>;

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
    const scannedBefore = globalStore.get(storageReportAtom)?.scannedts;
    globalStore.set(storageCleaningAtom, (m) => ({ ...m, ...Object.fromEntries(itemids.map((id) => [id, true])) }));
    try {
        const result = await RpcApi.CleanStorageCommand(
            TabRpcClient,
            { category, itemids, ...opts },
            { timeout: CLEAN_TIMEOUT_MS }
        );
        globalStore.set(storageSkippedAtom, skippedOf(result));
        // the server rescans after a clean, which takes seconds: drop what went now, unless that scan already landed
        globalStore.set(storageReportAtom, (r) =>
            r == null || r.scannedts !== scannedBefore ? r : withoutCleaned(r, result.cleaned ?? [])
        );
        return result;
    } finally {
        globalStore.set(storageCleaningAtom, (m) => {
            const next = { ...m };
            itemids.forEach((id) => delete next[id]);
            return next;
        });
    }
}

/** The sessions confirm's Scan them first: starts a Session ideas scan of these transcripts, which moves nothing. The
 *  Storage report says which sessions were never scanned as of its own scan, so when this one ends the report is
 *  rescanned and the next confirm's count is current. A start that is refused (a scan already runs) throws, and
 *  nothing waits for it. */
export async function scanSessionsForIdeas(paths: string[]): Promise<void> {
    const startedAt = Date.now();
    let done = false;
    const unsubscribe = waveEventSubscribeSingle({
        eventType: "sessionideas:changed",
        handler: () =>
            fireAndForget(async () => {
                const scan = (await RpcApi.SessionIdeasGetCommand(TabRpcClient)).scan;
                if (!done && scan != null && scan.startedts >= startedAt && scan.endedts > 0) {
                    done = true;
                    unsubscribe();
                    rescanStorage();
                }
            }),
    });
    try {
        await RpcApi.SessionIdeasScanCommand(TabRpcClient, { paths });
    } catch (e) {
        done = true;
        unsubscribe();
        throw e;
    }
}

/** Asks the server to size build output. It returns at once and the walk is the server's: the report's `sizing` and
 *  each walked project's new size arrive with the storage:scan events, so nothing is set here. `projects` is a row's
 *  open (the server skips folders sized in the last day); an empty list with `force` is Size all, every project. A
 *  refused or failed ask is a toast, not a silent drop. */
export function sizeBuildOutput(projects: string[], force = false): void {
    fireAndForget(async () => {
        try {
            await RpcApi.SizeBuildOutputCommand(TabRpcClient, { projects, force });
        } catch (e) {
            pushToast({ title: "Storage", message: `Couldn't size build output: ${String(e)}`, level: "error" });
        }
    });
}

/** The Size all button while it reads Stop sizing: the walk in progress finishes, the rest of the queue is dropped. */
export function stopSizingBuildOutput(): void {
    fireAndForget(async () => {
        try {
            await RpcApi.StopSizingBuildOutputCommand(TabRpcClient);
        } catch (e) {
            pushToast({ title: "Storage", message: `Couldn't stop sizing: ${String(e)}`, level: "error" });
        }
    });
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
