// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The workspace's marks for later (latermodel.ts): read reactively from `session:later`, written back whole.

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom } from "jotai";
import { laterKey, withLater, type LaterMarks } from "./latermodel";

const NO_MARKS: LaterMarks = {};

export const laterMarksAtom = atom<LaterMarks>((get) => get(atoms.workspace)?.meta?.["session:later"] ?? NO_MARKS);

/** Mark the session writing `transcriptPath` for later, or clear its mark (Done). A session with no transcript yet has
 *  no key and is left alone; its menu item is disabled. */
export function setLater(transcriptPath: string | undefined, on: boolean): void {
    const key = laterKey(transcriptPath);
    if (key != null) {
        fireAndForget(() => writeLater(key, on));
    }
}

/** Clear the mark filed under `key`, a session id: Jarvis's For later clears by the mark's own key, since a mark whose
 *  session is gone has no transcript path. Rejects when the write fails, for the caller's toast. */
export function clearLaterMark(key: string): Promise<void> {
    return writeLater(key, false);
}

// the marks are written back whole, read from the atom at the moment of the write
async function writeLater(key: string, on: boolean): Promise<void> {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        return;
    }
    const marks = withLater(globalStore.get(laterMarksAtom), key, on, Date.now());
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("workspace", ws.oid),
        meta: { "session:later": Object.keys(marks).length > 0 ? marks : null },
    });
}
