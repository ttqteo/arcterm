// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
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
            }
            if (data.lastoutputts) {
                globalStore.set(getLastOutputAtom(data.blockid), data.lastoutputts);
            }
        },
    });
}
