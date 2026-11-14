// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The held agents (parkedmodel.ts): read reactively from the workspace's `launch:parked` and written back whole; the
// machine readings the New dialog holds on and the held view words "now" with, polled only while one of them shows;
// and what a held agent can become: started, a chunk of an initiative, or gone.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { addChunkOp, appendChunkNote, removeChunks } from "@/app/view/jarvis/effortstore";
import { typedBlob } from "@/app/view/jarvis/localimage";
import { openAddress } from "@/app/view/jarvis/openref";
import { landOn } from "@/app/view/jarvis/returnsurface";
import { fetch } from "@/util/fetchutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { centerModeAtom, heldSelAtom, showTerminal } from "./agentcenter";
import { runtimeStartupCommand, sessionIdFromTranscript, type Runtime } from "./launch";
import { HOME_NAME, HOME_PICK } from "./launcher";
import { composeTaskWithImages, type TaskImage } from "./launcherimages";
import {
    clearLauncherDraft,
    launcherImagesAtom,
    launcherParkedIdAtom,
    launcherRestoredAtom,
    launcherResumeAtom,
    openAgentLauncher,
    pickLauncherRuntime,
    type LauncherModel,
} from "./launcherstore";
import {
    busyReason,
    heldToast,
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

// put an entry back where it stood (an Undo)
function restoreParked(p: ParkedLaunch, at: number): Promise<void> {
    return writeParked(withParkedAt(globalStore.get(parkedLaunchesAtom), p, Math.max(0, at)));
}

/** Hold what the dialog launched; the entry it was filled from (Edit in New…) is replaced where it stood. Rejects when
 *  the write fails, for the dialog's error line. */
export async function parkLaunch(input: {
    project: string;
    projectPath: string;
    runtime: Runtime;
    command: string;
    branch?: string;
    // a resume: the spec New would launch it with (launcherresume.ts resumeLaunchSpec) and the session it picks up
    args?: string[];
    resumeOf?: string;
    resumePath?: string;
    resumeTitle?: string;
    task: string;
    images: string[];
    reason: string | null;
}): Promise<ParkedLaunch> {
    const entry: ParkedLaunch = {
        id: globalStore.get(launcherParkedIdAtom) ?? crypto.randomUUID(),
        project: input.project,
        projectpath: input.projectPath,
        runtime: input.runtime,
        command: input.command,
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.args?.length ? { args: input.args } : {}),
        ...(input.resumeOf ? { resumeof: input.resumeOf } : {}),
        ...(input.resumePath ? { resumepath: input.resumePath } : {}),
        ...(input.resumeTitle ? { resumetitle: input.resumeTitle } : {}),
        task: input.task,
        ...(input.images.length > 0 ? { images: input.images } : {}),
        ts: Date.now(),
        ...(input.reason ? { reason: input.reason } : {}),
    };
    await writeParked(withParked(globalStore.get(parkedLaunchesAtom), entry));
    globalStore.set(launcherParkedIdAtom, null);
    return entry;
}

/** Say an agent was held, with a way to it: a launch that started nothing is never silent, even after the person has
 *  moved on from the centre that shows it. */
export function notifyHeld(model: Pick<AgentsViewModel, "surfaceAtom">, p: ParkedLaunch): void {
    const { title, message } = heldToast(p);
    pushToast({
        title,
        message,
        level: "warn",
        ttlMs: 10_000,
        onOpen: () => showHeld(model, p.id),
        action: { label: "Open", run: () => showHeld(model, p.id) },
    });
}

/** Show a held agent in the Agent surface's centre, as picking an agent shows it. */
export function showHeld(model: Pick<AgentsViewModel, "surfaceAtom">, id: string): void {
    globalStore.set(heldSelAtom, id);
    globalStore.set(centerModeAtom, "held");
    landOn(model.surfaceAtom, "agent");
}

// A held agent that leaves (started, added, removed) while the centre shows it hands the centre back to the terminal.
function leaveIfShown(id: string): void {
    if (globalStore.get(centerModeAtom) === "held" && globalStore.get(heldSelAtom) === id) {
        showTerminal();
    }
}

/** Drop a held agent: its Remove, or the start of the one the dialog was filled from. */
export async function removeParked(id: string): Promise<void> {
    const list = globalStore.get(parkedLaunchesAtom);
    if (list.some((p) => p.id === id)) {
        await writeParked(withoutParked(list, id));
    }
    leaveIfShown(id);
}

/** Remove: the held agent goes at once, and the toast's Undo puts it back where it stood. */
export async function removeParkedWithUndo(p: ParkedLaunch): Promise<void> {
    const at = globalStore.get(parkedLaunchesAtom).findIndex((x) => x.id === p.id);
    await removeParked(p.id);
    pushToast({
        title: "Held agent removed",
        message: parkedTitle(p),
        level: "info",
        action: { label: "Undo", run: () => fireAndForget(() => restoreParked(p, at)) },
    });
}

/** Start now: the agent starts as New would have started it (its project, command, branch, task and images), and the
 *  held entry goes. A failed start leaves the entry, and its toast says why. */
export async function startHeld(model: AgentsViewModel, p: ParkedLaunch): Promise<void> {
    const runtime = p.runtime as Runtime;
    const resuming = !!p.resumeof;
    const { task, extraArgs } = composeTaskWithImages(runtime, p.task, p.images ?? [], resuming);
    try {
        await launchAgent(model, {
            runtime,
            task,
            extraArgs,
            projectPath: p.projectpath ?? "",
            // as the dialog launches it: Home goes by its name too
            projectName: p.project,
            branch: p.branch,
            startupCommand: p.command || runtimeStartupCommand(runtime),
            ...(p.args?.length ? { startupArgs: p.args } : {}),
            ...(p.resumepath ? { resumePath: p.resumepath } : {}),
            ...(resuming ? { resumeOf: p.resumeof } : {}),
        });
    } catch (e) {
        pushToast({ title: "Could not start the held agent", message: errorText(e), level: "error" });
        return;
    }
    await removeParked(p.id).catch((e) => console.warn("held agent:", e));
}

/** One click: the held agent becomes a chunk of the initiative `oref` (its task's first line, the rest of the task and
 *  the screenshots in a note), and goes. The toast's Undo takes the chunk back out and the held agent back in; Open it
 *  goes to the initiative. A failure leaves the held agent, and its toast says why (a chunk of that name already there). */
export async function parkedToInitiative(
    model: AgentsViewModel,
    p: ParkedLaunch,
    target: { oref: string; title: string }
): Promise<void> {
    const { label, note } = parkedChunk(p);
    try {
        await addChunkOp(target.oref, label);
    } catch (e) {
        pushToast({ title: "Could not add it to the initiative", message: errorText(e), level: "error" });
        return;
    }
    // the note is a second write: one batch validates every op against the initiative as it was, which has no such
    // chunk yet. The chunk stands either way; a lost note is said, and the held agent stays so nothing is lost.
    if (note != null) {
        try {
            await appendChunkNote(target.oref, label, note);
        } catch (e) {
            pushToast({
                title: "Added, but without its note",
                message: `${label}: ${errorText(e)}. The held agent stays, task and screenshots in it.`,
                level: "warn",
            });
            return;
        }
    }
    const at = globalStore.get(parkedLaunchesAtom).findIndex((x) => x.id === p.id);
    await removeParked(p.id).catch((e) => console.warn("held agent:", e));
    pushToast({
        title: "Added to the initiative",
        message: target.title,
        level: "info",
        check: true,
        onOpen: () => fireAndForget(() => openAddress(model, target.oref)),
        action: {
            label: "Undo",
            run: () =>
                fireAndForget(async () => {
                    await removeChunks(target.oref, [{ label, stage: "" }], [label]);
                    await restoreParked(p, at);
                }),
        },
    });
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** A launch from the dialog went through: the held entry it was filled from (Edit in New…), if any, is done. A failed
 *  write leaves the row, which the person can still remove. */
export function settleParkedLaunch(): void {
    const id = globalStore.get(launcherParkedIdAtom);
    globalStore.set(launcherParkedIdAtom, null);
    if (id != null) {
        removeParked(id).catch((e) => console.warn("held agent:", e));
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

/** Edit in New…: the New dialog filled from a held agent (its project, agent, task and images) in place of the draft.
 *  Launch agent then starts it, or holds it again, in its place, while the machine is still busy. */
export function openParked(model: LauncherModel, p: ParkedLaunch): void {
    clearLauncherDraft();
    openAgentLauncher(model, { project: p.project === HOME_NAME ? HOME_PICK : p.project, task: p.task });
    pickLauncherRuntime(p.runtime as Runtime);
    // a held resume picks its session again, once the list has it (launcherresume.ts pickedResume)
    globalStore.set(launcherResumeAtom, p.resumeof ? (sessionIdFromTranscript(p.resumeof) ?? null) : null);
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

/** How often the machine is read while a reader shows: two readings in a row decide the CPU (BUSY_CPU_PCT). */
export const READ_MS = 2_000;

type Machine = { busy: string | null; free: number | null };
const NO_READING: Machine = { busy: null, free: null };

// why the machine is too busy for another agent (null when it is not or there is no reading), and its free memory
const machineAtom = atom<Machine>(NO_READING) as PrimitiveAtom<Machine>;
// a scenario's busy reading (the DEV seam below), which wins over the machine's while it is set
const busyOverrideAtom = atom<string | null | undefined>(undefined) as PrimitiveAtom<string | null | undefined>;
const shownMachineAtom = atom((get): Machine => {
    const forced = get(busyOverrideAtom);
    const m = get(machineAtom);
    return forced !== undefined ? { ...m, busy: forced } : m;
});

// One poll however many readers show (the dialog over a held view is two): the first starts it, the last stops it.
let readers = 0;
let stop: (() => void) | null = null;

function startPoll(): () => void {
    let live = true;
    let readings: MachineReading[] = [];
    const read = () =>
        RpcApi.GetMachineStatsCommand(TabRpcClient)
            .then((m) => {
                if (live) {
                    readings = keepReadings(readings, { pressure: m.pressure, cpupct: m.cpupct });
                    globalStore.set(machineAtom, { busy: busyReason(readings), free: m.memavailable || null });
                }
            })
            // a failed reading counts as none: it never holds an agent
            .catch(() => live && globalStore.set(machineAtom, NO_READING));
    void read();
    const t = setInterval(read, READ_MS);
    return () => {
        live = false;
        clearInterval(t);
        globalStore.set(machineAtom, NO_READING);
    };
}

/** Read the machine while `active` (the New dialog open on an agent, or a held agent in the centre). */
export function useMachine(active: boolean): Machine {
    useEffect(() => {
        if (!active) {
            return;
        }
        readers++;
        if (stop == null) {
            stop = startPoll();
        }
        return () => {
            readers--;
            if (readers === 0 && stop != null) {
                stop();
                stop = null;
            }
        };
    }, [active]);
    return useAtomValue(shownMachineAtom);
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
