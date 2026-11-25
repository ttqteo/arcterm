// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Code surface's pinned files (codepins.ts), kept in the workspace's `code:pins` so a script can read and write
// them through `wsh setmeta` (the person's thesis sync carries them between machines): read reactively from the meta,
// written back whole, as laterstore.ts does for `session:later`.

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { parsePins, pinsToMigrate, type CodePins } from "./codepins";

// where the pins lived before they moved into the workspace
const LEGACY_STORAGE_KEY = "code.pins";

// The map a write sent, shown until that write settles. A second change made before the workspace's update comes
// back would otherwise start from the old map and drop the first: a move of several files renames pins once per file.
const pendingPinsAtom = atom<CodePins | null>(null) as PrimitiveAtom<CodePins | null>;

// parsePins drops anything malformed, which a hand-written `wsh setmeta` can carry
export const codePinsAtom = atom<CodePins>(
    (get) => get(pendingPinsAtom) ?? parsePins(get(atoms.workspace)?.meta?.["code:pins"])
);

/** Change the pins: `change` gets the current map and returns the next one (a codepins.ts helper), which is written
 *  back whole. Returning the same map writes nothing. */
export function updateCodePins(change: (pins: CodePins) => CodePins): void {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        return;
    }
    const before = globalStore.get(codePinsAtom);
    const pins = change(before);
    if (pins === before) {
        return;
    }
    globalStore.set(pendingPinsAtom, pins);
    fireAndForget(async () => {
        try {
            await writeCodePins(ws.oid, pins);
        } finally {
            // a later change has its own write in flight, and the map it holds already builds on this one
            if (globalStore.get(pendingPinsAtom) === pins) {
                globalStore.set(pendingPinsAtom, null);
            }
        }
    });
}

function writeCodePins(oid: string, pins: CodePins): Promise<void> {
    return RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("workspace", oid),
        meta: { "code:pins": Object.keys(pins).length > 0 ? pins : null },
    });
}

/** Once per boot, after the workspace has loaded: move pins localStorage still holds into the workspace, then drop the
 *  localStorage key. The key stays when the write fails, so the next boot tries again and no pin is lost. */
export async function migrateLegacyCodePins(ws: Workspace): Promise<void> {
    let local: string | null;
    try {
        local = localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch (e) {
        console.warn("code pins: could not read the old localStorage pins", e);
        return;
    }
    if (local == null || ws?.oid == null) {
        return;
    }
    const pins = pinsToMigrate(ws.meta?.["code:pins"], local);
    if (pins != null) {
        await writeCodePins(ws.oid, pins);
        console.log(
            `code pins: moved the localStorage pins of ${Object.keys(pins).length} project(s) into the workspace`
        );
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
}
