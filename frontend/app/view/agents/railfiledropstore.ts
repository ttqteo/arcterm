// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The writes behind a drop of OS files on the Agent panel's Files tree (railfiledrop.ts has the rules): each dropped
// file goes to wavesrv in chunks (FileDropWriteCommand), a dropped folder is made first and its files written under it,
// then the tree reloads with the copies selected. A strip in the pane says how far the copy is, and one toast names
// whatever was not copied. The tree's own rows dropped on one of its folders move there instead (moveRowsInto,
// railmove.ts). Impure glue.

import { pushToast } from "@/app/cockpit/notificationstore";
import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { renamedPath } from "@/app/view/code/codemutate";
import { renameCodePinsIn } from "@/app/view/code/codestore";
import { joinRepoPath } from "@/util/paths";
import { arrayToBase64 } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { railPanelsAtom } from "./agentrailstore";
import type { FileRef } from "./agentrailtabs";
import {
    afterDropState,
    chunkRanges,
    copyingLabel,
    dropBytes,
    dropFailedToast,
    readDrop,
    type DropEntryLike,
} from "./railfiledrop";
import { moveFailedToast, planMove } from "./railmove";
import { railTreeStateAtom, reloadTree } from "./railtreestore";

const CHUNK_TIMEOUT_MS = 30000;
// files written at once; a file's own chunks go one after another
const PARALLEL_FILES = 4;
// how often the strip's percentage may change
const PROGRESS_EVERY_MS = 150;

// the copy running into each folder (by its tree's cwd): the strip's words, and which drop wrote them
export const railDropProgressAtom = atom<Record<string, { token: number; label: string }>>({}) as PrimitiveAtom<
    Record<string, { token: number; label: string }>
>;

let nextToken = 0;

function readChunk(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
        reader.readAsArrayBuffer(blob);
    });
}

// Writes one file in chunks and returns the path it took, which is `path` or, with unique, a free "name (n)" beside it.
async function writeFile(path: string, file: File, unique: boolean, onBytes: (n: number) => void): Promise<string> {
    let at = path;
    for (const { start, end } of chunkRanges(file.size)) {
        const data = await readChunk(file.slice(start, end));
        at = await RpcApi.FileDropWriteCommand(
            TabRpcClient,
            {
                path: at,
                data64: data.length > 0 ? arrayToBase64(data) : undefined,
                offset: start > 0 ? start : undefined,
                unique: start === 0 && unique ? true : undefined,
            },
            { timeout: CHUNK_TIMEOUT_MS }
        );
        onBytes(end - start);
    }
    return at;
}

async function inPool<T>(items: readonly T[], width: number, run: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const lane = async () => {
        while (next < items.length) {
            await run(items[next++]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
}

function reasonOf(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.replace(/^drop write: /, "");
}

// Copies what was dropped into `dirRel` (repo-relative, "" for the root) of the tree at `cwd`. `entries` and `files`
// were taken from the drop event while it ran, since its items are unreadable after.
export async function copyDropInto(
    cwd: string,
    agentId: string,
    dirRel: string,
    entries: readonly (DropEntryLike | null)[],
    files: readonly File[]
): Promise<void> {
    const token = ++nextToken;
    const target = dirRel === "" ? cwd : joinRepoPath(cwd, dirRel);
    const setLabel = (label: string) =>
        globalStore.set(railDropProgressAtom, (m) => ({ ...m, [cwd]: { token, label } }));
    setLabel(copyingLabel(entries.length || files.length, dirRel, 0, 0));
    const failed: { name: string; reason: string }[] = [];
    const copied: string[] = [];
    try {
        const read = await readDrop(entries, files);
        failed.push(...read.failed);
        const total = dropBytes(read.items);
        let done = 0;
        let shownAt = 0;
        const onBytes = (n: number) => {
            done += n;
            const now = Date.now();
            if (now - shownAt >= PROGRESS_EVERY_MS) {
                shownAt = now;
                setLabel(copyingLabel(read.items.length, dirRel, done, total));
            }
        };
        setLabel(copyingLabel(read.items.length, dirRel, 0, total));
        for (const item of read.items) {
            try {
                if (item.kind === "file") {
                    const at = await writeFile(joinRepoPath(target, item.name), item.file, true, onBytes);
                    copied.push(toRel(cwd, at));
                    continue;
                }
                const top = await RpcApi.FileDropWriteCommand(
                    TabRpcClient,
                    { path: joinRepoPath(target, item.name), dir: true, unique: true },
                    { timeout: CHUNK_TIMEOUT_MS }
                );
                copied.push(toRel(cwd, top));
                for (const dir of item.emptyDirs) {
                    await RpcApi.FileDropWriteCommand(
                        TabRpcClient,
                        { path: joinRepoPath(top, dir), dir: true },
                        { timeout: CHUNK_TIMEOUT_MS }
                    );
                }
                await inPool(item.files, PARALLEL_FILES, async (f) => {
                    try {
                        await writeFile(joinRepoPath(top, f.rel), f.file, false, onBytes);
                    } catch (e) {
                        failed.push({ name: `${item.name}/${f.rel}`, reason: reasonOf(e) });
                    }
                });
            } catch (e) {
                failed.push({ name: item.name, reason: reasonOf(e) });
            }
        }
    } finally {
        globalStore.set(railDropProgressAtom, (m) => {
            if (m[cwd]?.token !== token) {
                return m; // a later drop into this tree owns the strip now
            }
            const { [cwd]: _, ...rest } = m;
            return rest;
        });
        const toast = dropFailedToast(failed);
        if (toast != null) {
            pushToast({ ...toast, level: "warn" });
        }
    }
    if (copied.length > 0) {
        await reloadTree(cwd, agentId);
        const stateAtom = railTreeStateAtom(agentId);
        globalStore.set(stateAtom, afterDropState(globalStore.get(stateAtom), dirRel, copied));
    }
}

function moveReason(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return /already exists/.test(msg) ? "something with that name is already there" : msg;
}

// Moves the tree's own rows (`rels`, repo-relative) into `dirRel` of the tree at `cwd` (railmove.ts has the rules). The
// pins and the panel's open files on what moved follow it, so a moved file open in the File tab stays open; then the
// tree reloads with what moved selected.
export async function moveRowsInto(
    cwd: string,
    agentId: string,
    rels: readonly string[],
    dirRel: string
): Promise<void> {
    const plan = planMove(rels, dirRel);
    const failed = [...plan.skipped];
    const moved: string[] = [];
    for (const step of plan.moves) {
        try {
            await RpcApi.FileMoveCommand(TabRpcClient, {
                srcuri: joinRepoPath(cwd, step.from),
                desturi: joinRepoPath(cwd, step.to),
                opts: { recursive: true },
            });
        } catch (e) {
            failed.push({ name: step.from, reason: moveReason(e) });
            continue;
        }
        moved.push(step.to);
        renameCodePinsIn(cwd, step.from, step.to);
        carryPanelFiles(cwd, agentId, step.from, step.to);
    }
    const toast = moveFailedToast(failed);
    if (toast != null) {
        pushToast({ ...toast, level: "warn" });
    }
    if (moved.length > 0) {
        await reloadTree(cwd, agentId);
        const stateAtom = railTreeStateAtom(agentId);
        globalStore.set(stateAtom, afterDropState(globalStore.get(stateAtom), dirRel, moved));
    }
}

function carryPanelFiles(cwd: string, agentId: string, from: string, to: string): void {
    const carry = (ref: FileRef): FileRef => {
        if (!isUnderRoot(cwd, ref.abs)) {
            return ref;
        }
        const rel = toRel(cwd, ref.abs);
        const next = renamedPath(rel, from, to);
        return next === rel ? ref : { ...ref, abs: joinRepoPath(cwd, next) };
    };
    globalStore.set(railPanelsAtom, (panels) => {
        const p = panels[agentId];
        if (p == null) {
            return panels;
        }
        const files = p.files.map((f) => ({
            ...f,
            back: f.back.map(carry),
            current: f.current == null ? null : carry(f.current),
            forward: f.forward.map(carry),
        }));
        return { ...panels, [agentId]: { ...p, files } };
    });
}
