// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";

// keyed by bare block id (BlockControllerRuntimeStatus.blockid, not an oref); undefined = no output seen yet
const lastOutputAtoms = new Map<string, PrimitiveAtom<number | undefined>>();

export function getLastOutputAtom(blockId: string): PrimitiveAtom<number | undefined> {
    let outputAtom = lastOutputAtoms.get(blockId);
    if (!outputAtom) {
        outputAtom = atom(undefined) as PrimitiveAtom<number | undefined>;
        lastOutputAtoms.set(blockId, outputAtom);
    }
    return outputAtom;
}

// keyed like lastOutputAtoms; set when the block's shell process reports done, cleared when it runs again
const procExitAtoms = new Map<string, PrimitiveAtom<{ code: number; at: number } | undefined>>();

export function getProcExitAtom(blockId: string): PrimitiveAtom<{ code: number; at: number } | undefined> {
    let exitAtom = procExitAtoms.get(blockId);
    if (!exitAtom) {
        exitAtom = atom(undefined) as PrimitiveAtom<{ code: number; at: number } | undefined>;
        procExitAtoms.set(blockId, exitAtom);
    }
    return exitAtom;
}

// whether a lead's process runs, as far as this window has seen: none in the roster, or its block reported done, is not
// live; an agent put to sleep is asleep, not gone
export function leadProcessLive(lead: { blockId?: string; sleeping?: unknown } | undefined): boolean {
    if (lead == null) {
        return false;
    }
    return lead.sleeping != null || globalStore.get(getProcExitAtom(lead.blockId ?? "")) == null;
}

// keyed like lastOutputAtoms; the reason the block's controller last refused to start, cleared once it runs
const startErrorAtoms = new Map<string, PrimitiveAtom<string | undefined>>();

export function getStartErrorAtom(blockId: string): PrimitiveAtom<string | undefined> {
    let errAtom = startErrorAtoms.get(blockId);
    if (!errAtom) {
        errAtom = atom(undefined) as PrimitiveAtom<string | undefined>;
        startErrorAtoms.set(blockId, errAtom);
    }
    return errAtom;
}

// set by devmock.ts while a dev fixture roster stands in for the live one (a CDP scenario's): its agents name blocks
// that do not exist. This module never imports devmock.ts, which a production build leaves out.
let fixtureRoster = false;
export function setFixtureRoster(on: boolean) {
    fixtureRoster = on;
    if (!on) {
        return;
    }
    // A refusal recorded before the flag went on (an earlier scenario set the same made-up blocks without it) is the
    // fixture's too, and nothing else clears it: a made-up block never sends the controllerstatus "running" that would.
    for (const errAtom of startErrorAtoms.values()) {
        if (fixtureBlockMissing(true, globalStore.get(errAtom) ?? "")) {
            globalStore.set(errAtom, undefined);
        }
    }
}

// Pure: whether a refused start is a fixture's made-up block rather than an agent that failed. The surface starts the
// controller of whichever agent it focuses, and a fixture's block is never there, so each focused fixture agent read
// "failed to start" (idle, red) and a scenario about its working state failed on it.
export function fixtureBlockMissing(fixture: boolean, message: string): boolean {
    return fixture && /error getting block\b.*\bnot found/i.test(message);
}

// every controller start goes through here, so a refusal reaches the roster instead of only the console
export async function resyncController(data: CommandControllerResyncData): Promise<void> {
    const errAtom = getStartErrorAtom(data.blockid);
    try {
        await RpcApi.ControllerResyncCommand(TabRpcClient, data);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (fixtureBlockMissing(fixtureRoster, message)) {
            globalStore.set(errAtom, undefined);
            return;
        }
        globalStore.set(errAtom, message);
        throw e;
    }
    globalStore.set(errAtom, undefined);
}

let subscribed = false;
export function setupControllerStatusSubscription() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    waveEventSubscribeSingle({
        eventType: "controllerstatus",
        handler: (event) => {
            const data = event.data;
            if (!data?.blockid) {
                return;
            }
            if (data.shellprocstatus === "done") {
                globalStore.set(getProcExitAtom(data.blockid), { code: data.shellprocexitcode, at: Date.now() });
            } else if (data.shellprocstatus === "running") {
                globalStore.set(getProcExitAtom(data.blockid), undefined);
                globalStore.set(getStartErrorAtom(data.blockid), undefined);
            }
            if (data.lastoutputts) {
                globalStore.set(getLastOutputAtom(data.blockid), data.lastoutputts);
            }
        },
    });
}
