// frontend/app/view/agents/syncstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The sync bar's two writes, Pull and Push, and what they leave behind. Fetch is comparestore's (runFetch and its
// fetchStatesAtom), since a comparison reads it too. State is keyed by the worktree's cwd, so a run's spinner and its
// failure survive the surface unmounting and never show on another worktree.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { loadCommitList } from "./commitstore";
import { runFetch } from "./comparestore";
import { filesStateAtom, reloadChanges } from "./filesstore";
import { refreshHistory } from "./githistorystore";
import { syncToast } from "./syncstate";

export type SyncRunKind = "pull" | "push";

export interface SyncRun {
    // the action in flight, or null
    running: SyncRunKind | null;
    // the last action that git refused, shown under the top bar until it is dismissed or the next action starts
    failure: { kind: SyncRunKind; failure: GitFailure } | null;
}

const IDLE: SyncRun = { running: null, failure: null };

export const syncRunAtom = atom<Record<string, SyncRun>>({}) as PrimitiveAtom<Record<string, SyncRun>>;

export function syncRunOf(runs: Record<string, SyncRun>, cwd: string | undefined): SyncRun {
    return (cwd && runs[cwd]) || IDLE;
}

function put(cwd: string, run: SyncRun): void {
    globalStore.set(syncRunAtom, (prev) => ({ ...prev, [cwd]: run }));
}

// The branch and its upstream as the surface's poll last read them for `cwd`; undefined when it is reading another worktree.
function branchOf(cwd: string): { branch: string; upstream: string } | undefined {
    const state = globalStore.get(filesStateAtom);
    return state?.cwd === cwd ? { branch: state.branch, upstream: state.upstream } : undefined;
}

// What a finished action touches: the refs (a pull fetched, a push moved origin/<branch>), the counts, the log and the
// Commit tab, whose Amend lock follows the new upstream. None of it may turn a pull that worked into a failure.
async function refreshAfter(cwd: string): Promise<void> {
    try {
        await runFetch(cwd);
        await reloadChanges(cwd);
        refreshHistory();
        await loadCommitList(cwd);
    } catch {
        // the next poll reads again
    }
}

// The client budgets sit past gitinfo's own (55s for Pull, 120s for Push), so git's answer arrives before the call is
// cancelled underneath it.
async function runSync(cwd: string, kind: SyncRunKind): Promise<void> {
    if (syncRunOf(globalStore.get(syncRunAtom), cwd).running != null) {
        return;
    }
    const before = branchOf(cwd);
    put(cwd, { running: kind, failure: null });
    try {
        const r =
            kind === "pull"
                ? await RpcApi.GitPullCommand(TabRpcClient, { cwd }, { timeout: 60000 })
                : await RpcApi.GitPushCommand(TabRpcClient, { cwd }, { timeout: 125000 });
        if (r.failure != null) {
            put(cwd, { running: null, failure: { kind, failure: r.failure } });
            return;
        }
        put(cwd, IDLE);
        const toast = syncToast(kind, r.moved, {
            branch: r.branch || before?.branch || "",
            upstream: before?.upstream ?? "",
            // a push from a branch that tracked nothing set the upstream (the backend publishes it to origin)
            published: kind === "push" && before != null && before.upstream === "",
        });
        pushToast({ ...toast, level: "info" });
    } catch {
        put(cwd, {
            running: null,
            failure: {
                kind,
                failure: {
                    command: kind === "pull" ? "git pull --ff-only" : "git push",
                    exitcode: -1,
                    stderr: `the ${kind} did not complete`,
                },
            },
        });
        return;
    }
    await refreshAfter(cwd);
}

// The Fetch button: comparestore's fetch, then the change read that carries the upstream counts, so ↓ moves now instead
// of at the next poll.
export async function fetchNow(cwd: string): Promise<void> {
    await runFetch(cwd);
    try {
        await reloadChanges(cwd);
    } catch {
        // the next poll reads again
    }
}

export function runPull(cwd: string): Promise<void> {
    return runSync(cwd, "pull");
}

export function runPush(cwd: string): Promise<void> {
    return runSync(cwd, "push");
}

export function dismissSyncFailure(cwd: string): void {
    put(cwd, { ...syncRunOf(globalStore.get(syncRunAtom), cwd), failure: null });
}
