// frontend/app/view/agents/railstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Cockpit rail state: the agent details-rail toggle + the channels context-rail toggle (both
// global, persisted) plus a thin git load for the agent rail (branch + changed-file list, no
// per-file diff). Mirrors filesstore.ts but lighter — the rail shows the list, not the diff.
// cwd resolution is shared via agentcwdresolve.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { resolveCwd } from "./agentcwdresolve";
import { linkedWorktree } from "./agentrailmodel";
import { ensureSessionStart } from "./agentsessionstore";
import { parseGitChanges, type GitChanges } from "./gitstatus";

export interface RailGitState {
    cwd: string | null;
    branch: string;
    isRepo: boolean;
    changes: GitChanges | null;
    // the linked worktree the agent works in, as linkedWorktree names it; unset in the main checkout
    worktree?: string;
}

// First persisted FE pref in frontend/app: the rail is global and on by default (localStorage key
// "agent.rail.visible"). A stored value, on or off, wins over the default: it was off by default until 2026-10, so a
// stored "false" is a choice, and a profile that never toggled it just gets the new default. getOnInit reads the
// stored value when the atom is created, so a user who closed the rail does not see it open for the render before
// storage arrives.
export const DEFAULT_RAIL_VISIBLE = true;

export const railVisibleAtom = atomWithStorage("agent.rail.visible", DEFAULT_RAIL_VISIBLE, undefined, {
    getOnInit: true,
});

// Terminal-fullscreen toggle for the Agent surface: when on, the AgentTree (and the rail) are
// hidden so the focused agent's live terminal fills the surface. Session-scoped UI, not persisted.
export const terminalFullscreenAtom = atom(false);

// whether the rail's Token usage section shows its per-class and per-model breakdown. Session-scoped, not
// persisted; global so it holds while the surface unmounts.
export const usageBreakdownAtom = atom(false);

// whether the rail's Terminals section lists every terminal rather than the focused item's project's. Session-scoped,
// not persisted, like usageBreakdownAtom: it is a look at the others, not a preference.
export const railTerminalsAllAtom = atom(false);

export const railStateAtom = atom<RailGitState | null>(null) as PrimitiveAtom<RailGitState | null>;

// guards against a stale focus's load overwriting a newer one (same pattern as filesstore.ts)
const current = { id: "" };

const EMPTY: RailGitState = { cwd: null, branch: "", isRepo: false, changes: null };

export async function loadRailForAgent(
    id: string,
    transcriptPath: string | undefined,
    blockId?: string
): Promise<void> {
    current.id = id;
    globalStore.set(railStateAtom, null);

    const [cwd, startTs] = await Promise.all([resolveCwd(transcriptPath, blockId), ensureSessionStart(transcriptPath)]);
    if (current.id !== id) {
        return;
    }
    if (!cwd) {
        globalStore.set(railStateAtom, EMPTY);
        return;
    }
    try {
        // sessionstartts: match the card pill / Diff tab — the branch's changed-file list vs the
        // session-start commit. Null ts degrades to the live working-tree-vs-HEAD diff.
        // the worktree list only names the worktree, so a failure there leaves the line out rather than the rail
        const [ch, wts] = await Promise.all([
            RpcApi.GitChangesCommand(TabRpcClient, { cwd, sessionstartts: startTs ?? undefined }),
            RpcApi.GitListWorktreesCommand(TabRpcClient, { cwd }).catch(() => null),
        ]);
        if (current.id !== id) {
            return;
        }
        const changes = ch.isrepo ? parseGitChanges(ch.statusz, ch.numstat) : null;
        const worktree = ch.isrepo ? linkedWorktree(cwd, wts?.worktrees ?? []) : undefined;
        globalStore.set(railStateAtom, { cwd, branch: ch.branch, isRepo: ch.isrepo, changes, worktree });
    } catch {
        if (current.id === id) {
            globalStore.set(railStateAtom, { ...EMPTY, cwd });
        }
    }
}
