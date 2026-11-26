// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Keeps the agents' drafts (wakeDraftsAtom's text, attachmentDraftsAtom's chips) in localStorage, so closing or
// reloading arcterm finds them again (chatdrafts.ts holds the rules). Installed once by the main window before it
// renders. Best effort: storage that is blocked or full only means drafts last until arcterm closes, as before.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { parseDrafts, restoreDrafts, snapshotDrafts, type SavedDrafts } from "./chatdrafts";
import { attachmentDraftsAtom, type Attachment } from "./composerattachments";
import { LAUNCHER_DRAFT } from "./launcherstore";
import { wakeDraftsAtom } from "./wakingstore";

const KEY = "chat.drafts";
// typing writes at most this often; a close in the gap loses at most these last keystrokes (beforeunload flushes)
const WRITE_DELAY_MS = 300;
const SKIP = new Set([LAUNCHER_DRAFT]);

function read(): SavedDrafts {
    try {
        return parseDrafts(JSON.parse(localStorage.getItem(KEY) ?? "{}"), Date.now());
    } catch {
        return {};
    }
}

function write(d: SavedDrafts): void {
    try {
        if (Object.keys(d).length === 0) {
            localStorage.removeItem(KEY);
        } else {
            localStorage.setItem(KEY, JSON.stringify(d));
        }
    } catch (e) {
        console.warn("chat.drafts: not kept", e);
    }
}

// a restored file chip whose file is gone (deleted, or a temp the sweep took) is dropped rather than sent as a dead path
async function dropMissingFiles(ids: string[]): Promise<void> {
    for (const id of ids) {
        const atts: readonly Attachment[] = globalStore.get(attachmentDraftsAtom).get(id) ?? [];
        const gone = new Set<string>();
        for (const a of atts) {
            if (a.path == null) {
                continue;
            }
            try {
                const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: a.path } });
                if (info == null || info.notfound) {
                    gone.add(a.id);
                }
            } catch {
                // unknown: keep the chip, the agent says so if it cannot read the file
            }
        }
        if (gone.size === 0) {
            continue;
        }
        const cur = globalStore.get(attachmentDraftsAtom).get(id) ?? [];
        const left = cur.filter((a) => !gone.has(a.id));
        const m = new Map(globalStore.get(attachmentDraftsAtom));
        if (left.length > 0) {
            m.set(id, left);
        } else {
            m.delete(id);
        }
        globalStore.set(attachmentDraftsAtom, m);
    }
}

let installed = false;

/** Puts the kept drafts back in the stores, then keeps them written as they change. */
export function installChatDrafts(): void {
    if (installed) {
        return;
    }
    installed = true;
    let saved = read();
    const { texts, atts } = restoreDrafts(saved);
    if (texts.size > 0) {
        // what is in the store already (nothing, at boot) wins over the kept copy
        globalStore.set(wakeDraftsAtom, new Map([...texts, ...globalStore.get(wakeDraftsAtom)]));
    }
    if (atts.size > 0) {
        globalStore.set(attachmentDraftsAtom, new Map([...atts, ...globalStore.get(attachmentDraftsAtom)]));
        fireAndForget(() => dropMissingFiles([...atts.keys()]));
    }
    // the read dropped the stale ones: write that back
    write(saved);

    let timer: number | null = null;
    const flush = () => {
        if (timer != null) {
            window.clearTimeout(timer);
            timer = null;
        }
        saved = snapshotDrafts(
            globalStore.get(wakeDraftsAtom),
            globalStore.get(attachmentDraftsAtom),
            saved,
            Date.now(),
            SKIP
        );
        write(saved);
    };
    const schedule = () => {
        if (timer == null) {
            timer = window.setTimeout(flush, WRITE_DELAY_MS);
        }
    };
    globalStore.sub(wakeDraftsAtom, schedule);
    globalStore.sub(attachmentDraftsAtom, schedule);
    window.addEventListener("beforeunload", flush);
}
