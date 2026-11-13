// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The RAM each agent row shows (agentram.ts, worded by rowcols.ts), one derived atom per block so a row redraws only
// when its own reading changes, not on every 2-second snapshot. Where the Resource Manager does not run, the Consumers
// reading stands in: useAgentRamPoll reads it every AGENT_RAM_POLL_MS while the tree is up and the field is on.

import { resmonSnapshotAtom } from "@/app/cockpit/resmonstore";
import { atom, useAtomValue, type Atom, type Getter } from "jotai";
import { useEffect } from "react";
import { agentRamBytes, needsConsumersPoll, runRamBytes } from "./agentram";
import { consumersReadingAtom, loadConsumers } from "./consumersstore";
import { ramReading, sameRamReading, type RamReading } from "./rowcols";
import { rowFieldsAtom } from "./rowfieldsstore";

export const AGENT_RAM_POLL_MS = 10_000;

// a reading atom that hands back its last object while the words stay the same, so a row reading it is not redrawn
function readingAtom(bytesOf: (get: Getter) => number | null): Atom<RamReading | null> {
    let last: RamReading | null = null;
    return atom((get) => {
        const next = ramReading(bytesOf(get));
        if (!sameRamReading(last, next)) {
            last = next;
        }
        return last;
    });
}

const ramAtoms = new Map<string, Atom<RamReading | null>>();

/** The RAM reading of the agent whose terminal is blockId, or null while no reading names it. */
export function agentRamAtom(blockId: string | undefined): Atom<RamReading | null> {
    const key = blockId ?? "";
    let a = ramAtoms.get(key);
    if (a == null) {
        a = readingAtom((get) => agentRamBytes(key, get(resmonSnapshotAtom), get(consumersReadingAtom).data));
        ramAtoms.set(key, a);
    }
    return a;
}

const runRamAtoms = new Map<string, Atom<RamReading | null>>();

/** The RAM reading of a run's tabs together, by the terminals they hold (`blockKey`: their block ids joined by ","),
 * or null while no reading names any of them. */
export function runRamAtom(blockKey: string): Atom<RamReading | null> {
    let a = runRamAtoms.get(blockKey);
    if (a == null) {
        const ids = blockKey === "" ? [] : blockKey.split(",");
        a = readingAtom((get) => runRamBytes(ids, get(resmonSnapshotAtom), get(consumersReadingAtom).data));
        runRamAtoms.set(blockKey, a);
    }
    return a;
}

// a boolean, so the tree that reads it is not redrawn by every snapshot
const pollNeededAtom = atom((get) => needsConsumersPoll(get(rowFieldsAtom).ram, get(resmonSnapshotAtom)));

/** Keeps the Consumers reading fresh for the rows where the Resource Manager does not run (macOS). */
export function useAgentRamPoll(): void {
    const poll = useAtomValue(pollNeededAtom);
    useEffect(() => {
        if (!poll) {
            return;
        }
        void loadConsumers();
        const timer = setInterval(() => {
            if (!document.hidden) {
                void loadConsumers();
            }
        }, AGENT_RAM_POLL_MS);
        return () => clearInterval(timer);
    }, [poll]);
}
