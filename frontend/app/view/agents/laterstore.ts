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
    const ws = globalStore.get(atoms.workspace);
    const key = laterKey(transcriptPath);
    if (ws?.oid == null || key == null) {
        return;
    }
    const marks = withLater(globalStore.get(laterMarksAtom), key, on, Date.now());
    fireAndForget(() =>
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("workspace", ws.oid),
            meta: { "session:later": Object.keys(marks).length > 0 ? marks : null },
        })
    );
}
