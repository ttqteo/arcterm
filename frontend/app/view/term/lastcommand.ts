// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The command each terminal block last ran, as its shell reported it (OSC 16162 C), kept where the cockpit can read
// it reactively: the Agent tree names a plain terminal by it. Seeded from the block's runtime info when its terminal
// loads, so a reload keeps the name.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

const lastCommandAtoms = new Map<string, PrimitiveAtom<string | undefined>>();

export function getLastCommandAtom(blockId: string): PrimitiveAtom<string | undefined> {
    let a = lastCommandAtoms.get(blockId);
    if (a == null) {
        a = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;
        lastCommandAtoms.set(blockId, a);
    }
    return a;
}

/** Records a block's last command; an empty one (a bare Enter, a command too large to report) keeps the last. */
export function setLastCommand(blockId: string, cmd: string | null | undefined): void {
    if (!cmd || cmd.trim() === "") {
        return;
    }
    globalStore.set(getLastCommandAtom(blockId), cmd);
}
