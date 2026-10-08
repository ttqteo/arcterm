// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// State for the Diff surface's worktree sidebar. Mirrors filesstore.ts: module-level atoms written by async
// loaders via globalStore, so the folded rail, the expanded groups and each group's last read survive the surface
// unmounting on a nav switch. The rows themselves are derived purely in worktreesidebar.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { sameRepoPath } from "@/util/paths";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { resolveCwd } from "./agentcwdresolve";
import { resolveSidebarFolded } from "./difflayout";
import type { FilesProject, FilesState } from "./filesstore";
import { projectListAtom } from "./projectsstore";

// The person's own fold: null = follow the surface's width, true/false = they said so and a resize must not undo it.
// Persisted across launches; the width's fold never is. The cast is railstore.ts's (jotai otherwise types it as a
// promise).
export const sidebarFoldedAtom = atomWithStorage<boolean | null>("cockpit.files.sidebar.folded", null, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<boolean | null>;

// The Diff surface's whole width, sidebar included, as FilesSurface last measured it; 0 until it has.
export const diffSurfaceWidthAtom = atom(0) as PrimitiveAtom<number>;

// Whether the sidebar shows as its rail: the explicit choice, else the width's (difflayout.ts).
export const sidebarShownFoldedAtom = atom((get) =>
    resolveSidebarFolded(get(sidebarFoldedAtom), get(diffSurfaceWidthAtom))
);

// Project names whose group is open, for this session only. The view adds the current source's group on a scope change.
export const sidebarExpandedAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

// Each project's checkouts from its last good read, by project name; absent = not read yet. An empty list means the
// project path is not a repository.
export const worktreesByProjectAtom = atom<Record<string, GitWorktree[] | undefined>>({}) as PrimitiveAtom<
    Record<string, GitWorktree[] | undefined>
>;
// The message of a group's last failed read, by project name; cleared by its next good read. A failure keeps the
// group's previous checkouts and never touches another group.
export const worktreeErrorsAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

// Each agent's working directory by agent id; null = it did not resolve.
export const agentCwdsAtom = atom<Record<string, string | null>>({}) as PrimitiveAtom<Record<string, string | null>>;

// The latest load per project: a response from an older one is dropped.
const loadTokens = new Map<string, number>();

// The DEV fault hook (window.__worktreeSidebarFault) is read where a load starts: "error" fails that one load, then it
// clears itself. It lets the CDP scenario show a group error.
function devFault(): void {
    if (!import.meta.env.DEV || typeof window === "undefined") {
        return;
    }
    const fault = window.__worktreeSidebarFault;
    if (fault == null) {
        return;
    }
    window.__worktreeSidebarFault = undefined;
    if (fault === "error") {
        throw new Error("injected by __worktreeSidebarFault");
    }
}

export async function loadProjectWorktrees(project: FilesProject): Promise<void> {
    const token = (loadTokens.get(project.name) ?? 0) + 1;
    loadTokens.set(project.name, token);
    try {
        devFault();
        const rtn = await RpcApi.GitListWorktreesCommand(TabRpcClient, { cwd: project.path, status: true });
        if (loadTokens.get(project.name) !== token) {
            return;
        }
        globalStore.set(worktreesByProjectAtom, (prev) => ({ ...prev, [project.name]: rtn?.worktrees ?? [] }));
        globalStore.set(worktreeErrorsAtom, (prev) => {
            if (!(project.name in prev)) {
                return prev;
            }
            const { [project.name]: _, ...rest } = prev;
            return rest;
        });
    } catch (e) {
        if (loadTokens.get(project.name) !== token) {
            return;
        }
        console.error(`worktree sidebar: couldn't read worktrees of ${project.name} (${project.path})`, e);
        const msg = e instanceof Error ? e.message : String(e);
        globalStore.set(worktreeErrorsAtom, (prev) => ({ ...prev, [project.name]: msg }));
    }
}

// Reloads every expanded group (the `r` binding, beside reloadChanges). A collapsed group is not read.
export async function refreshSidebar(): Promise<void> {
    const expanded = globalStore.get(sidebarExpandedAtom);
    const projects = globalStore.get(projectListAtom).filter((p) => expanded.has(p.name));
    await Promise.all(projects.map((p) => loadProjectWorktrees(p)));
}

export interface SidebarAgent {
    id: string;
    transcriptPath?: string;
    blockId?: string;
}

// The transcript path each agent's cwd was resolved for, so a steady agent is read once and a moved one again.
const resolvedFor = new Map<string, string>();

export async function resolveAgentCwds(agents: SidebarAgent[]): Promise<void> {
    await Promise.all(
        agents.map(async (a) => {
            const key = a.transcriptPath ?? "";
            if (resolvedFor.get(a.id) === key) {
                return;
            }
            resolvedFor.set(a.id, key);
            const cwd = await resolveCwd(a.transcriptPath, a.blockId);
            if (resolvedFor.get(a.id) !== key) {
                return;
            }
            globalStore.set(agentCwdsAtom, (prev) => ({ ...prev, [a.id]: cwd }));
        })
    );
}

// Pure: the open checkout's row takes its changed count from the loaded file list, so the badge and the list never
// disagree. Only a live working-tree read (ref "") counts the same thing as `git status`; a session or run range lists
// committed work too, so it leaves the counts alone.
export function withLiveCount(worktrees: GitWorktree[], filesState: FilesState | null): GitWorktree[] {
    const cwd = filesState?.cwd;
    if (!cwd || !filesState.isRepo || filesState.ref !== "" || filesState.changes == null) {
        return worktrees;
    }
    const changed = filesState.changes.files.length;
    return worktrees.map((wt) => (sameRepoPath(wt.path, cwd) ? { ...wt, changed } : wt));
}

declare global {
    interface Window {
        // DEV: "error" fails the next worktree sidebar load; cleared after one load
        __worktreeSidebarFault?: "error";
    }
}
