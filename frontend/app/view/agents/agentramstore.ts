// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The RAM each agent row shows (agentram.ts), one derived atom per block so a row redraws only when its own words
// change, not on every 2-second snapshot. Where the Resource Manager does not run, the Consumers reading stands in:
// useAgentRamPoll reads it every AGENT_RAM_POLL_MS while the tree is up and the field is on.

import { resmonSnapshotAtom } from "@/app/cockpit/resmonstore";
import { atom, useAtomValue, type Atom } from "jotai";
import { useEffect } from "react";
import { agentRamLabel, needsConsumersPoll } from "./agentram";
import { consumersReadingAtom, loadConsumers } from "./consumersstore";
import { rowFieldsAtom } from "./rowfieldsstore";

export const AGENT_RAM_POLL_MS = 10_000;

const ramAtoms = new Map<string, Atom<string | null>>();

/** The RAM words of the agent whose terminal is blockId, or null while no reading names it. */
export function agentRamAtom(blockId: string | undefined): Atom<string | null> {
    const key = blockId ?? "";
    let a = ramAtoms.get(key);
    if (a == null) {
        a = atom((get) => agentRamLabel(key, get(resmonSnapshotAtom), get(consumersReadingAtom).data));
        ramAtoms.set(key, a);
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
