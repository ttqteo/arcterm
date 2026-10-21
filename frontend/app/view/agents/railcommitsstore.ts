// frontend/app/view/agents/railcommitsstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The rail's Commits section and commit mode, per agent: the commits of the files list's range (railcommits.ts), whether
// the section is open, and whether the tab is committing. Module atoms written through globalStore, like railstore.ts: the
// rail unmounts with its surface. The uncommitted list and everything a commit needs are commitstore.ts's, keyed by cwd,
// shared with the Diff surface's Commit tab.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { devCommitFault } from "./changesstatus";
import { loadCommitList } from "./commitstore";
import { RAIL_COMMITS_CAP } from "./railcommits";

export interface RailCommitsState {
    key: string; // cwd|from: the range the commits belong to
    status: "loading" | "ready" | "failed";
    commits: HistoryCommit[];
    head: string;
    failure: GitFailure | null;
}

export const railCommitsAtom = atom<Record<string, RailCommitsState>>({}) as PrimitiveAtom<
    Record<string, RailCommitsState>
>;
// the person's fold choice per agent; absent, the section takes commitsOpenByDefault
export const railCommitsOpenAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;
export const railCommitModeAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;

function putFor<T>(a: PrimitiveAtom<Record<string, T>>, id: string, value: T | undefined): void {
    globalStore.set(a, (prev) => {
        const next = { ...prev };
        if (value === undefined) {
            delete next[id];
        } else {
            next[id] = value;
        }
        return next;
    });
}

// a newer read of an agent's commits supersedes one still in flight
const seq = new Map<string, number>();

// The commits after `from`, newest first, one past the cap so the section knows there are more. A read of the range
// already shown keeps its rows until the answer lands; a new range starts from a skeleton.
export async function loadRailCommits(agentId: string, cwd: string, from: string): Promise<void> {
    const key = `${cwd}|${from}`;
    const n = (seq.get(agentId) ?? 0) + 1;
    seq.set(agentId, n);
    if (globalStore.get(railCommitsAtom)[agentId]?.key !== key) {
        putFor(railCommitsAtom, agentId, { key, status: "loading", commits: [], head: "", failure: null });
    }
    // the Uncommitted row's count; its own sequence guard keeps the newest
    void loadCommitList(cwd);
    const command = `git log ${from}..HEAD`;
    try {
        await devCommitFault();
        const r = await RpcApi.GitHistoryCommand(TabRpcClient, {
            cwd,
            ref: `${from}..HEAD`,
            limit: RAIL_COMMITS_CAP + 1,
        });
        if (seq.get(agentId) !== n) {
            return;
        }
        if (r.failure != null) {
            putFor(railCommitsAtom, agentId, { key, status: "failed", commits: [], head: "", failure: r.failure });
            return;
        }
        putFor(railCommitsAtom, agentId, {
            key,
            status: "ready",
            commits: r.commits ?? [],
            head: r.head ?? "",
            failure: null,
        });
    } catch (e) {
        if (seq.get(agentId) === n) {
            putFor(railCommitsAtom, agentId, {
                key,
                status: "failed",
                commits: [],
                head: "",
                failure: { command, exitcode: -1, stderr: String((e as Error)?.message ?? e) },
            });
        }
    }
}

export function setRailCommitsOpen(agentId: string, open: boolean): void {
    putFor(railCommitsOpenAtom, agentId, open);
}

export function setRailCommitMode(agentId: string, on: boolean): void {
    putFor(railCommitModeAtom, agentId, on ? true : undefined);
}
