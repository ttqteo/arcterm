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
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { showTerminal } from "./agentcenter";
import { resolveCwd } from "./agentcwdresolve";
import { linkedWorktree } from "./agentrailmodel";
import { ensureSessionStart } from "./agentsessionstore";
import { parseGitChanges, type GitChanges } from "./gitstatus";
import { recentTabsAtom } from "./tabswitcherstore";
import { DOCK_DEFAULT_PX, dockHostId } from "./terminaldock";

export interface RailGitState {
    cwd: string | null;
    branch: string;
    isRepo: boolean;
    changes: GitChanges | null;
    // the linked worktree the agent works in, as linkedWorktree names it; unset in the main checkout
    worktree?: string;
    // the commit changes is measured from (the session start's); "" is HEAD
    ref?: string;
    // the whole branch's changes, from where it left the default branch; unset on the default branch itself, or when
    // no default branch resolves
    branchDiff?: BranchDiff;
}

export interface BranchDiff {
    base: string; // the default branch it is measured against, e.g. "main"
    ref: string; // the merge base the changes are measured from
    changes: GitChanges;
}

// which changes the rail's Files changed lists: this session's, or everything on the agent's branch. One choice for
// every agent, kept across launches
export type RailChangesRange = "session" | "branch";

export const railChangesRangeAtom = atomWithStorage<RailChangesRange>("agent.rail.changesRange", "session", undefined, {
    getOnInit: true,
}) as PrimitiveAtom<RailChangesRange>;

// First persisted FE pref in frontend/app: the rail is global and on by default (localStorage key
// "agent.rail.visible"). A stored value, on or off, wins over the default: it was off by default until 2026-10, so a
// stored "false" is a choice, and a profile that never toggled it just gets the new default. getOnInit reads the
// stored value when the atom is created, so a user who closed the rail does not see it open for the render before
// storage arrives.
export const DEFAULT_RAIL_VISIBLE = true;

export const railVisibleAtom = atomWithStorage("agent.rail.visible", DEFAULT_RAIL_VISIBLE, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<boolean>;

// Terminal-fullscreen toggle for the Agent surface: when on, the AgentTree (and the rail) are
// hidden so the focused agent's live terminal fills the surface. Session-scoped UI, not persisted.
export const terminalFullscreenAtom = atom(false);

// The plain terminal docked under the agent stack (terminaldock.ts), or null with the dock closed. Session-scoped:
// "Move to the panel" (moveToDock) fills it, and the surface empties it when that terminal closes or is chosen.
export const dockedTerminalAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// the dock folded to its 32 px strip (the terminal's name, a running dot and its latest output line); one choice for
// every terminal, kept across launches
export const terminalDockFoldedAtom = atomWithStorage("agent.terminalDock.folded", false, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<boolean>;

// What moveToDock and undock need of AgentsViewModel; spelled out so they can be tested without one.
interface DockModel {
    focusIdAtom: PrimitiveAtom<string | undefined>;
    agentsAtom: Atom<ReadonlyArray<{ id: string; blockId?: string }>>;
}

// "Move to the panel": the terminal goes under the agent that was in view before it, which takes the centre back, and
// the panel opens to show it. False (and nothing moves) when there is no agent to dock it under.
export function moveToDock(model: DockModel, id: string): boolean {
    const host = dockHostId(globalStore.get(recentTabsAtom), globalStore.get(model.agentsAtom), id);
    if (host == null) {
        return false;
    }
    globalStore.set(dockedTerminalAtom, id);
    globalStore.set(terminalDockFoldedAtom, false);
    globalStore.set(model.focusIdAtom, host);
    showTerminal();
    return true;
}

// The panel empties and the shown agent stays in focus: the first half of "Open in split" on the panel (the second is
// openInSplit, which gives the terminal a cell beside that agent). A terminal that is not the docked one is left alone.
// The terminal is not a cell while it is docked (the surface prunes it from the grid), so this runs before openInSplit.
export function undock(_model: DockModel, id: string): void {
    if (globalStore.get(dockedTerminalAtom) !== id) {
        return;
    }
    globalStore.set(dockedTerminalAtom, null);
    globalStore.set(terminalDockMaxAtom, false);
}

// The dock's height as last dragged, in px; clampDockHeight bounds it against the column when it is drawn.
export const terminalDockHeightAtom = atomWithStorage("agent.terminalDock.height", DOCK_DEFAULT_PX, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<number>;

// the docked terminal maximized over the agent stack: it takes the whole grid, the agents' panes hidden under it.
// Session-scoped; closing the dock or emptying it turns it off.
export const terminalDockMaxAtom = atom(false);

// the height while the dock's edge is being dragged, committed to terminalDockHeightAtom on release
export const terminalDockDragAtom = atom<number | null>(null) as PrimitiveAtom<number | null>;

// whether the rail's Session section shows its token usage's per-class and per-model breakdown. Not persisted;
// global so it holds while the surface unmounts.
export const usageBreakdownAtom = atom(false);

export const railStateAtom = atom<RailGitState | null>(null) as PrimitiveAtom<RailGitState | null>;

// each agent's resolved cwd, kept across focus changes: railStateAtom empties on every switch and fills only after its
// git reads, so the panel's Files tab reads the cwd here instead, and an agent left on Files comes back on Files at once
// rather than through Overview
export const railCwdsAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

function setRailCwd(id: string, cwd: string | null): void {
    const cwds = globalStore.get(railCwdsAtom);
    if ((cwds[id] ?? null) === cwd) {
        return;
    }
    const next = { ...cwds };
    if (cwd == null) {
        delete next[id];
    } else {
        next[id] = cwd;
    }
    globalStore.set(railCwdsAtom, next);
}

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
    setRailCwd(id, cwd || null);
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
        // the branch view is extra: a failure there leaves the session's list standing
        const [ch, wts, br] = await Promise.all([
            RpcApi.GitChangesCommand(TabRpcClient, { cwd, sessionstartts: startTs ?? undefined }),
            RpcApi.GitListWorktreesCommand(TabRpcClient, { cwd }).catch(() => null),
            RpcApi.GitChangesCommand(TabRpcClient, { cwd, branchbase: true }).catch(() => null),
        ]);
        if (current.id !== id) {
            return;
        }
        const changes = ch.isrepo ? parseGitChanges(ch.statusz, ch.numstat) : null;
        const worktree = ch.isrepo ? linkedWorktree(cwd, wts?.worktrees ?? []) : undefined;
        globalStore.set(railStateAtom, {
            cwd,
            branch: ch.branch,
            isRepo: ch.isrepo,
            changes,
            worktree,
            ref: ch.ref ?? "",
            branchDiff: ch.isrepo ? branchDiffOf(br) : undefined,
        });
    } catch {
        if (current.id === id) {
            globalStore.set(railStateAtom, { ...EMPTY, cwd });
        }
    }
}

// a branch read is a branch view only when it found a base and the branch is not that base itself
export function branchDiffOf(br: CommandGitChangesRtnData | null): BranchDiff | undefined {
    if (br == null || !br.isrepo || !br.basebranch || !br.ref) {
        return undefined;
    }
    if (br.basebranch.replace(/^origin\//, "") === br.branch) {
        return undefined;
    }
    return { base: br.basebranch, ref: br.ref, changes: parseGitChanges(br.statusz, br.numstat) };
}
