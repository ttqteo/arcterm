// frontend/app/view/code/codeblamestore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Blame state, module-scoped so the toggle and the last answer survive the surface unmounting.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { blameEntries, blameIsCurrent, type BlameState } from "./codeblame";
import { codeFileAtom, codeProjectAtom, codeViewModeAtom, draftKey } from "./codestore";
import { sourceEditorShowing } from "./codeviewmodestore";

// past GitBlameCommand's own 30s budget: the client's timeout binds the server's context, and the first
// blame after launch reads every landed run's commits to credit them
const BLAME_RPC_TIMEOUT_MS = 35000;

export const codeBlameOnAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
export const codeBlameAtom = atom<BlameState>({ kind: "idle" }) as PrimitiveAtom<BlameState>;

let blameToken = "";

// Keyed by absolute path, so two projects' same relative path never share an answer.
export function blameKey(rel: string): string | null {
    const project = globalStore.get(codeProjectAtom);
    return project == null ? null : draftKey(project, rel);
}

export async function loadBlame(rel: string, modtime: number, lineCount: number): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    const key = blameKey(rel);
    if (project == null || key == null || blameIsCurrent(globalStore.get(codeBlameAtom), key, modtime)) {
        return;
    }
    const token = `${key}:${modtime}`;
    if (blameToken === token) {
        return; // this exact read is already in flight
    }
    blameToken = token;
    globalStore.set(codeBlameAtom, { kind: "loading", path: key });
    try {
        const rtn = await RpcApi.GitBlameCommand(
            TabRpcClient,
            { cwd: project.path, path: rel },
            { timeout: BLAME_RPC_TIMEOUT_MS }
        );
        if (blameToken !== token) {
            return;
        }
        globalStore.set(codeBlameAtom, { kind: "ready", path: key, modtime, entries: blameEntries(rtn, lineCount) });
    } catch (e) {
        if (blameToken !== token) {
            return;
        }
        globalStore.set(codeBlameAtom, {
            kind: "error",
            path: key,
            message: e instanceof Error ? e.message : String(e),
        });
    } finally {
        if (blameToken === token) {
            blameToken = "";
        }
    }
}

// The column draws beside the source editor only, so asking for it anywhere else brings the editor up with it
// on: the press always shows a column, never a pressed button with nothing beside it.
export function toggleBlame(): void {
    if (globalStore.get(codeFileAtom).kind === "text" && !sourceEditorShowing()) {
        globalStore.set(codeViewModeAtom, "source");
        globalStore.set(codeBlameOnAtom, true);
        return;
    }
    globalStore.set(codeBlameOnAtom, (on) => !on);
}
