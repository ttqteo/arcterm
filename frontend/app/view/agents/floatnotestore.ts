// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Float ledge's Note and Translate tabs: the global scratch note's state (its body, the save error, Edit or Preview,
// and whether the overlay is up), its debounced save over wshrpc, and what the Translate tab does. Module-level atoms:
// the overlay unmounts with Float, and the text must outlive it. Called by float-ledge.tsx, FloatNote and the
// `float-note` binding; the pure parts are floatnote.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import { SCRATCH_SAVE_MS, scratchErrorLine, translateStep } from "./floatnote";
import { enterFloat, floatModeAtom } from "./floatstore";
import { installTool, loadTools, openTool, toolsStatusAtom } from "./toolsstore";

// whether FloatNote covers the terminal area; Float ending or any focus change closes it, so re-entering shows the terminal
export const floatNoteOpenAtom = atom(false) as PrimitiveAtom<boolean>;
// the note's markdown; null until the first read
export const scratchBodyAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// the line under the note after a failed save; the next save that works clears it
export const scratchErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// Preview rather than Edit
export const scratchPreviewAtom = atom(false) as PrimitiveAtom<boolean>;

// ---- saving ----

let saveTimer: ReturnType<typeof setTimeout> | null = null;
// the body waiting for its save, null when nothing is
let pending: string | null = null;
// counts edits, so a read that began before one does not overwrite it
let editSeq = 0;

// the write in flight, null when none is; a later write and a read wait for it, so neither passes it
let writing: Promise<void> | null = null;

// Writes the pending body now. A failure goes to scratchErrorAtom, not to the caller, and the body goes back to pending
// (unless a newer edit is), so a close or the next flush saves it again and a read never replaces it.
export async function flushScratch(): Promise<void> {
    if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (pending == null) {
        await writing;
        return;
    }
    const body = pending;
    pending = null;
    const send = async () => {
        try {
            await RpcApi.NoteScratchWriteCommand(TabRpcClient, { body });
            globalStore.set(scratchErrorAtom, null);
        } catch (err) {
            globalStore.set(scratchErrorAtom, scratchErrorLine(err));
            if (pending == null) {
                pending = body;
            }
        }
    };
    const run = writing == null ? send() : writing.then(send);
    writing = run;
    void run.finally(() => {
        if (writing === run) {
            writing = null;
        }
    });
    await run;
}

/** An edit of the note: shows at once and saves SCRATCH_SAVE_MS after the last one. */
export function editScratch(body: string): void {
    editSeq++;
    globalStore.set(scratchBodyAtom, body);
    pending = body;
    if (saveTimer != null) {
        clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => void flushScratch(), SCRATCH_SAVE_MS);
}

/** Reads the note from the vault, after a write in flight lands, unless an edit was made while the read was out or text still waits to be saved. */
export async function loadScratch(): Promise<void> {
    await writing;
    const seq = editSeq;
    const body = await RpcApi.NoteScratchReadCommand(TabRpcClient);
    // unsaved text (an edit, or a save that failed) beats the disk
    if (seq === editSeq && pending == null) {
        globalStore.set(scratchBodyAtom, body);
    }
}

// ---- the overlay ----

/** Opens the note over Float's terminal, entering Float first when it is not on. */
export async function openFloatNote(model: AgentsViewModel): Promise<void> {
    if (!globalStore.get(floatModeAtom)) {
        await enterFloat(model);
    }
    // enterFloat returns without floating while busy or folded: an open atom left set would show the note on the next Float
    if (!globalStore.get(floatModeAtom)) {
        return;
    }
    try {
        await loadScratch();
    } catch (err) {
        console.error("reading the scratch note failed", err);
    }
    globalStore.set(floatNoteOpenAtom, true);
}

/** Closes the note, saving a pending edit at once. */
export function closeFloatNote(): void {
    void flushScratch();
    globalStore.set(floatNoteOpenAtom, false);
    globalStore.set(scratchPreviewAtom, false);
}

/** The `float-note` binding: the note from outside Float or from a terminal, the terminal from the note. */
export async function toggleFloatNote(model: AgentsViewModel): Promise<void> {
    if (globalStore.get(floatModeAtom) && globalStore.get(floatNoteOpenAtom)) {
        closeFloatNote();
        return;
    }
    await openFloatNote(model);
}

// ---- Translate ----

/** The Translate tab: the trans terminal if one is open, else the tool opened, else its install. */
export async function showTranslate(model: AgentsViewModel): Promise<void> {
    closeFloatNote();
    let tools = globalStore.get(toolsStatusAtom);
    if (tools == null) {
        try {
            await loadTools();
        } catch (err) {
            console.warn("reading the tool catalog failed", err);
        }
        tools = globalStore.get(toolsStatusAtom);
    }
    const step = translateStep(globalStore.get(model.terminalsAtom), tools);
    switch (step.kind) {
        case "show":
            model.openTerminal(step.id);
            return;
        case "open": {
            const res = await openTool(model, step.tool, { place: "centre" });
            if (res.ok === false) {
                console.warn("opening translate-shell failed:", res.reason);
            }
            return;
        }
        case "install":
            try {
                const res = await installTool(model, step.tool);
                if (res.ok === false) {
                    console.warn("installing translate-shell failed:", res.reason);
                } else {
                    model.openTerminal(res.tabId);
                }
            } catch (err) {
                console.warn("installing translate-shell failed:", err);
            }
            return;
        case "missing":
            console.warn("translate-shell is not in the tool catalog");
    }
}
