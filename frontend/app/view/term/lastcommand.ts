// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What each terminal block's shell reports (OSC 16162), kept where the cockpit can read it reactively: the command it
// last ran (C), which names a plain terminal in the Agent tree, and whether a command is running now (C until the next
// prompt, A), which marks the row. Seeded from the block's runtime info when its terminal loads, so a reload keeps both.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

const lastCommandAtoms = new Map<string, PrimitiveAtom<string | undefined>>();
const runningAtoms = new Map<string, PrimitiveAtom<boolean>>();

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

export function getCommandRunningAtom(blockId: string): PrimitiveAtom<boolean> {
    let a = runningAtoms.get(blockId);
    if (a == null) {
        a = atom(false);
        runningAtoms.set(blockId, a);
    }
    return a;
}

/** Records whether a block's shell is running a command (true from C) or back at its prompt (false from A). */
export function setCommandRunning(blockId: string, running: boolean): void {
    globalStore.set(getCommandRunningAtom(blockId), running);
}

/** Pure: what a change in a block's shell process status means for its running mark — false when the shell is not
 *  running (no command can be), and false when it has just started again (a new shell is at its first prompt, and
 *  that prompt's mark can land while the terminal is still loading); null leaves the mark alone. */
export function runningAfterProcStatus(prev: string | null | undefined, next: string | null | undefined): false | null {
    if (next !== "running") {
        return false;
    }
    if (prev != null && prev !== "running") {
        return false;
    }
    return null;
}

/** Pure: the OSC 16162 command letter of a mark that says where the shell is — "prompt" (A, or R for a reset),
 *  "command" (C) — or null for any other mark. */
export function shellPosition(oscData: string): "prompt" | "command" | null {
    const command = oscData.split(";", 1)[0];
    if (command === "A" || command === "R") {
        return "prompt";
    }
    if (command === "C") {
        return "command";
    }
    return null;
}
