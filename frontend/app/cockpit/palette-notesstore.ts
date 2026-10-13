// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The only place the frontend calls the note RPCs. The list is read each time the palette opens, and again
// after every write, failed or not: an agent may have added, renamed or deleted a note meanwhile.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { NoteDraft } from "./palette-notes";

// null until the first load
export const paletteNotesAtom = atom<UserNote[] | null>(null) as PrimitiveAtom<UserNote[] | null>;

export async function loadPaletteNotes(): Promise<void> {
    const notes = await RpcApi.NoteListCommand(TabRpcClient);
    globalStore.set(paletteNotesAtom, notes ?? []);
}

// The outcome is the write's alone. A failed reload never rejects: after a write that landed, the caller
// would take it for a failed save and a retry would add the note twice. The list is read again on the next open.
async function reloadAfter<T>(write: () => Promise<T>): Promise<T> {
    try {
        return await write();
    } finally {
        await loadPaletteNotes().catch((err) => console.warn("palette: reloading notes failed", err));
    }
}

export function saveNoteDraft(d: NoteDraft): Promise<string> {
    return reloadAfter(async () => {
        if (d.id == null) {
            const note = await RpcApi.NoteAddCommand(TabRpcClient, { title: d.title, body: d.body });
            return note.id;
        }
        await RpcApi.NoteUpdateCommand(TabRpcClient, { id: d.id, title: d.title, body: d.body });
        return d.id;
    });
}

export function deletePaletteNote(id: string): Promise<void> {
    return reloadAfter(() => RpcApi.NoteDeleteCommand(TabRpcClient, { id }));
}
