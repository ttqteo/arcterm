// frontend/app/view/agents/diffcontentstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The diff pane's content: two full file texts, loaded from whichever pair of refs the current
// selection names. Module-level like every other store on this surface, because the surface
// unmounts on a nav switch. One loader for all three states — the selection decides the refs
// (diffcontent.ts) and nothing here knows which state it is serving.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { joinRepoPath } from "@/util/paths";
import { base64ToArray } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { pairRefsFor, type DiffPairRefs, type DiffSelection, type DiffSide } from "./diffcontent";

// Monaco is comfortable well past this; the cap exists so one accidental click on a vendored bundle
// or a lockfile does not freeze the surface. Same number the patch readers cap at server-side, so a
// file this pane will refuse is a file the patch path refuses too.
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;

export interface DiffPair {
    path: string;
    original: string;
    modified: string;
    // set when either side is a blob git has no text for
    binary: boolean;
    // set when either side exceeds MAX_DIFF_BYTES; size is the larger side, for the message
    tooLarge: boolean;
    size: number;
    // set when the file does not exist on that side: two empty texts then read as an added or deleted empty
    // file rather than a rename. Optional so hand-built pairs (tests, fixtures) need not say.
    originalMissing?: boolean;
    modifiedMissing?: boolean;
    // the refs this pair was read from: a comment made on it is anchored to them
    refs: DiffPairRefs;
}

export const diffPairAtom = atom<DiffPair | null>(null) as PrimitiveAtom<DiffPair | null>;

// why the open file's pair could not be read; the pane shows it with a Retry in place of the skeleton
export const diffPairFailureAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

type LoadArgs = Parameters<typeof loadDiffPair>;

const current: { token: string; args: LoadArgs | null } = { token: "", args: null };

export function clearDiffPair(): void {
    current.token = "";
    current.args = null;
    globalStore.set(diffPairAtom, null);
    globalStore.set(diffPairFailureAtom, null);
}

export interface SideResult {
    text: string;
    binary: boolean;
    tooLarge: boolean;
    missing: boolean;
    size: number;
}

const EMPTY_SIDE: SideResult = { text: "", binary: false, tooLarge: false, missing: false, size: 0 };

// a read the file system refused because the path is not there: the file was deleted from the working tree
const NOT_FOUND = /ENOENT|no such file|does not exist|not exist|cannot find|not found/i;

// Pure: one working-tree read, made with a byte range one past the cap, as a side of the pair. The same caps as a ref
// read (gitinfo.FileAtRef): past MAX_DIFF_BYTES it is too large and its text is dropped, and bytes that are not UTF-8
// are binary, so an untracked lockfile or blob cannot freeze the pane.
export function worktreeSide(data: FileData | null | undefined): SideResult {
    if (data?.info?.notfound) {
        return { ...EMPTY_SIDE, missing: true };
    }
    const bytes = data?.data64 ? base64ToArray(data.data64) : new Uint8Array(0);
    const size = Math.max(data?.info?.size ?? 0, bytes.length);
    if (size > MAX_DIFF_BYTES) {
        return { ...EMPTY_SIDE, tooLarge: true, size };
    }
    try {
        return { ...EMPTY_SIDE, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), size };
    } catch {
        return { ...EMPTY_SIDE, binary: true, size };
    }
}

async function readSide(cwd: string, path: string, side: DiffSide): Promise<SideResult> {
    if (side.kind === "worktree") {
        try {
            const data = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: joinRepoPath(cwd, path) },
                // one byte past the cap is enough to know it is too large, and nothing past it crosses the wire
                at: { offset: 0, size: MAX_DIFF_BYTES + 1 },
            });
            return worktreeSide(data);
        } catch (e) {
            // deleted from the working tree: an empty right side is exactly how that reads. Any other refusal (a
            // directory, a file it may not read) is a failed read the pane says, not an empty file.
            if (NOT_FOUND.test(failureMessage(e))) {
                return { ...EMPTY_SIDE, missing: true };
            }
            throw e;
        }
    }
    const r = await RpcApi.GitFileAtRefCommand(TabRpcClient, {
        cwd,
        ref: side.ref,
        path,
        maxbytes: MAX_DIFF_BYTES,
    });
    // missing is not a failure: the file was added on one side or deleted on the other
    return {
        text: r.content ?? "",
        binary: !!r.binary,
        tooLarge: !!r.toolarge,
        missing: !!r.missing,
        size: r.size ?? 0,
    };
}

function failureMessage(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    return msg || "The read failed with no message.";
}

// re-runs the last loadDiffPair, for the pane's Retry after a failed read
export function retryDiffPair(): Promise<void> {
    return current.args == null ? Promise.resolve() : loadDiffPair(...current.args);
}

export async function loadDiffPair(cwd: string, path: string, sel: DiffSelection): Promise<void> {
    const refs = pairRefsFor(sel);
    const token = `${cwd}|${path}|${JSON.stringify(refs)}`;
    // Re-reading what is already on screen is a refresh, not a navigation: the change poll replaces
    // the working-tree state every few seconds and the surface re-reads with it, so blanking here
    // would flash the skeleton on every tick. A different file or range still blanks — showing the
    // previous file's text under the new one's header is worse than showing nothing.
    const refresh = current.token === token;
    current.token = token;
    current.args = [cwd, path, sel];
    if (!refresh) {
        globalStore.set(diffPairAtom, null);
        globalStore.set(diffPairFailureAtom, null);
    }
    try {
        const [original, modified] = await Promise.all([
            readSide(cwd, path, refs.original),
            readSide(cwd, path, refs.modified),
        ]);
        if (current.token !== token) {
            return; // selection moved on
        }
        globalStore.set(diffPairAtom, {
            path,
            original: original.text,
            modified: modified.text,
            binary: original.binary || modified.binary,
            tooLarge: original.tooLarge || modified.tooLarge,
            size: Math.max(original.size, modified.size),
            originalMissing: original.missing,
            modifiedMissing: modified.missing,
            refs,
        });
        globalStore.set(diffPairFailureAtom, null);
    } catch (e) {
        if (current.token === token) {
            globalStore.set(diffPairAtom, null);
            globalStore.set(diffPairFailureAtom, failureMessage(e));
        }
    }
}
