// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The parked launches (parkedmodel.ts): read reactively from the workspace's `launch:parked` and written back whole;
// the machine readings the New dialog parks on, polled only while it is open; and the way back from a parked row into
// the dialog, filled as it was parked.

import { pushToast } from "@/app/cockpit/notificationstore";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { addChunkOp, appendChunkNote } from "@/app/view/jarvis/effortstore";
import { typedBlob } from "@/app/view/jarvis/localimage";
import { fetch } from "@/util/fetchutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { Runtime } from "./launch";
import { HOME_NAME, HOME_PICK } from "./launcher";
import type { TaskImage } from "./launcherimages";
import {
    clearLauncherDraft,
    launcherImagesAtom,
    launcherParkedIdAtom,
    launcherRestoredAtom,
    openAgentLauncher,
    pickLauncherRuntime,
    type LauncherModel,
} from "./launcherstore";
import {
    busyReason,
    keepReadings,
    parkedChunk,
    parkedTitle,
    withoutParked,
    withParked,
    withParkedAt,
    type MachineReading,
} from "./parkedmodel";
import { streamFileUrl } from "./pdfframe";

const NONE: ParkedLaunch[] = [];

export const parkedLaunchesAtom = atom<ParkedLaunch[]>((get) => get(atoms.workspace)?.meta?.["launch:parked"] ?? NONE);

async function writeParked(next: ParkedLaunch[]): Promise<void> {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        throw new Error("no workspace to keep it in");
    }
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("workspace", ws.oid),
        meta: { "launch:parked": next.length > 0 ? next : null },
    });
}

/** Park what the dialog holds; the entry it was filled from is replaced where it stood. Rejects when the write fails,
 *  for the dialog's error line. */
export async function parkLaunch(input: {
    project: string;
    runtime: Runtime;
    task: string;
    images: string[];
    reason: string | null;
}): Promise<ParkedLaunch> {
    const entry: ParkedLaunch = {
        id: globalStore.get(launcherParkedIdAtom) ?? crypto.randomUUID(),
        project: input.project,
        runtime: input.runtime,
        task: input.task,
        ...(input.images.length > 0 ? { images: input.images } : {}),
        ts: Date.now(),
        ...(input.reason ? { reason: input.reason } : {}),
    };
    await writeParked(withParked(globalStore.get(parkedLaunchesAtom), entry));
    globalStore.set(launcherParkedIdAtom, null);
    pushToast({ title: "Parked for later", message: parkedTitle(entry), level: "info", check: true });
    return entry;
}

/** Drop a parked launch: its row's Remove, or the start of the one the dialog was filled from. */
export async function removeParked(id: string): Promise<void> {
    const list = globalStore.get(parkedLaunchesAtom);
    if (list.some((p) => p.id === id)) {
        await writeParked(withoutParked(list, id));
    }
}

/** A parked row's Remove: the entry goes at once, and the toast's Undo puts it back where it stood. */
export async function removeParkedWithUndo(p: ParkedLaunch): Promise<void> {
    const at = globalStore.get(parkedLaunchesAtom).findIndex((x) => x.id === p.id);
    await removeParked(p.id);
    pushToast({
        title: "Parked agent removed",
        message: parkedTitle(p),
        level: "info",
        action: {
            label: "Undo",
            run: () =>
                fireAndForget(() => writeParked(withParkedAt(globalStore.get(parkedLaunchesAtom), p, Math.max(0, at)))),
        },
    });
}

/** The person would rather plan it than start it: the parked launch becomes a chunk of the initiative `oref` (its
 *  task's first line, with the rest of the task and the screenshots in a note), and its row goes. A failure leaves the
 *  row, and its toast says why (a chunk of that name already there, say). */
export async function parkedToInitiative(p: ParkedLaunch, oref: string): Promise<void> {
    const { label, note } = parkedChunk(p);
    try {
        await addChunkOp(oref, label);
    } catch (e) {
        pushToast({ title: "Could not add it to the initiative", message: errorText(e), level: "error" });
        return;
    }
    // the note is a second write: one batch validates every op against the initiative as it was, which has no such
    // chunk yet. The chunk stands either way; a lost note is said, and the row stays so nothing is lost.
    if (note != null) {
        try {
            await appendChunkNote(oref, label, note);
        } catch (e) {
            pushToast({
                title: "Added, but without its note",
                message: `${label}: ${errorText(e)}. The parked row stays, task and screenshots in it.`,
                level: "warn",
            });
            return;
        }
    }
    await removeParked(p.id).catch((e) => console.warn("parked launch:", e));
    pushToast({ title: "Added to the initiative", message: label, level: "info", check: true });
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** A launch from the dialog went through: the parked entry it was filled from, if any, is done. A failed write leaves
 *  the row, which the person can still remove. */
export function settleParkedLaunch(): void {
    const id = globalStore.get(launcherParkedIdAtom);
    globalStore.set(launcherParkedIdAtom, null);
    if (id != null) {
        removeParked(id).catch((e) => console.warn("parked launch:", e));
    }
}

// a restored image's preview: the file read back through wavesrv as a blob URL (an <img> cannot carry the auth key)
async function previewOf(path: string): Promise<string> {
    const resp = await fetch(streamFileUrl(path));
    if (!resp.ok) {
        throw new Error(resp.status === 404 ? "This image is gone from disk" : `HTTP ${resp.status}`);
    }
    return URL.createObjectURL(typedBlob(await resp.blob(), resp.headers.get("content-type")));
}

/** Open the New dialog filled from a parked launch: its project, agent, task and images, in place of the draft. Enter
 *  then starts it (or parks it again while the machine is still busy). */
export function openParked(model: LauncherModel, p: ParkedLaunch): void {
    clearLauncherDraft();
    openAgentLauncher(model, { project: p.project === HOME_NAME ? HOME_PICK : p.project, task: p.task });
    pickLauncherRuntime(p.runtime as Runtime);
    globalStore.set(launcherParkedIdAtom, p.id);
    globalStore.set(launcherRestoredAtom, false);
    const images: TaskImage[] = (p.images ?? []).map((path) => ({ id: crypto.randomUUID(), previewUrl: "", path }));
    globalStore.set(launcherImagesAtom, images);
    for (const img of images) {
        previewOf(img.path).then(
            (url) => {
                // removed (or the dialog cleared) while it loaded: nothing shows it
                if (!globalStore.get(launcherImagesAtom).some((i) => i.id === img.id)) {
                    URL.revokeObjectURL(url);
                    return;
                }
                globalStore.set(launcherImagesAtom, (prev) =>
                    prev.map((i) => (i.id === img.id ? { ...i, previewUrl: url } : i))
                );
            },
            (e) =>
                globalStore.set(launcherImagesAtom, (prev) =>
                    prev.map((i) => (i.id === img.id ? { ...i, path: undefined, error: String(e?.message ?? e) } : i))
                )
        );
    }
}

// --- the machine readings -------------------------------------------------------------------------------------------

/** How often the open dialog reads the machine: two readings in a row decide the CPU (parkedmodel BUSY_CPU_PCT). */
export const READ_MS = 2_000;

// why the machine is too busy for another agent, null when it is not or there is no reading
export const machineBusyAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// a scenario's busy reading (the DEV seam below), which wins over the machine's while it is set
const busyOverrideAtom = atom<string | null | undefined>(undefined) as PrimitiveAtom<string | null | undefined>;
const shownBusyAtom = atom((get) => {
    const forced = get(busyOverrideAtom);
    return forced !== undefined ? forced : get(machineBusyAtom);
});

/** Read the machine while `active` (the New dialog open on an agent): one reading at once, then one every READ_MS,
 *  stopped when it is not. Returns why the machine is busy, or null. A failed reading counts as none: it never parks. */
export function useMachineBusy(active: boolean): string | null {
    useEffect(() => {
        if (!active) {
            return;
        }
        let live = true;
        let readings: MachineReading[] = [];
        const read = () =>
            RpcApi.GetMachineStatsCommand(TabRpcClient)
                .then((m) => {
                    if (live) {
                        readings = keepReadings(readings, { pressure: m.pressure, cpupct: m.cpupct });
                        globalStore.set(machineBusyAtom, busyReason(readings));
                    }
                })
                .catch(() => live && globalStore.set(machineBusyAtom, null));
        void read();
        const t = setInterval(read, READ_MS);
        return () => {
            live = false;
            clearInterval(t);
            globalStore.set(machineBusyAtom, null);
        };
    }, [active]);
    return useAtomValue(shownBusyAtom);
}

// scenarios make the machine read busy (a reason) or calm (null) without loading it; undefined hands back to the
// machine's own readings
declare global {
    interface Window {
        __arcMachineBusy?: { set: (reason: string | null | undefined) => void };
    }
}
if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__arcMachineBusy = { set: (reason) => globalStore.set(busyOverrideAtom, reason) };
}
