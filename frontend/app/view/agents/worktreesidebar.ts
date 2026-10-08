// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the rows of the Diff surface's worktree sidebar. Every registered project is a group holding its
// checkouts (main first, then linked worktrees in `git worktree list` order), each agent sits under the checkout
// it runs in, and the agents no listed checkout holds trail under Other agents. No React.

import { normalizeRepoPath, sameRepoPath } from "@/util/paths";
import { containingWorktree, worktreeRelPath } from "./agentrailmodel";
import type { DiffOrigin } from "./diffscope";
import type { FilesProject } from "./filesstore";

export { worktreeRelPath };

export interface SidebarAgent {
    id: string;
    name: string;
    state: string;
}

export type SidebarRow =
    | { kind: "group"; project: string; path: string; expanded: boolean; error?: string }
    | { kind: "worktree"; project: string; wt: GitWorktree; label: string; current: boolean }
    | { kind: "agent"; agent: SidebarAgent; current: boolean }
    | { kind: "other-agents" };

export interface SidebarInput {
    projects: FilesProject[];
    worktrees: Record<string, GitWorktree[] | undefined>; // by project name; undefined = not loaded
    errors: Record<string, string | undefined>; // by project name; the group's last load rejected with this
    agentCwds: Record<string, string | null>; // by agent id; null = did not resolve, absent = not resolved yet
    agents: SidebarAgent[];
    expanded: Set<string>;
    current: { origin?: DiffOrigin; cwd?: string | null };
    query: string;
}

export const NOT_A_REPO_LABEL = "not a repository";

// worktreeLabel is a checkout's branch, or the commit a detached checkout sits on.
export function worktreeLabel(wt: GitWorktree): string {
    if (wt.branch) {
        return wt.branch;
    }
    return wt.head ? `detached ${wt.head}` : "detached";
}

interface Checkout {
    project: string;
    path: string;
    wt: GitWorktree;
    label: string;
    agents: SidebarAgent[];
}

// A group whose worktrees are not loaded, or whose load failed, still offers its main checkout from the project
// path, so the project stays pickable; a load that listed nothing is not a repository.
function checkoutsOf(p: FilesProject, worktrees: GitWorktree[] | undefined, error: string | undefined): Checkout[] {
    const one = (label: string): Checkout[] => [
        { project: p.name, path: p.path, wt: { path: p.path, ismain: true }, label, agents: [] },
    ];
    if (error || worktrees == null) {
        return one(p.name);
    }
    if (worktrees.length === 0) {
        return one(NOT_A_REPO_LABEL);
    }
    return worktrees.map((wt) => ({ project: p.name, path: wt.path, wt, label: worktreeLabel(wt), agents: [] }));
}

// A project or worktree origin marks its own checkout; a run marks the checkout its resolved cwd is.
function isCurrentCheckout(c: Checkout, current: SidebarInput["current"]): boolean {
    const o = current.origin;
    switch (o?.kind) {
        case "project":
            return c.project === o.name && !!c.wt.ismain;
        case "worktree":
            return c.project === o.project && sameRepoPath(c.path, o.path);
        case "run":
            return sameRepoPath(c.path, current.cwd || o.cwd);
        default:
            return false;
    }
}

// Every group's checkouts with each agent under the checkout it runs in, and the agents no checkout holds.
function placeAgents(input: SidebarInput): {
    groups: { project: FilesProject; checkouts: Checkout[] }[];
    other: SidebarAgent[];
} {
    const groups = input.projects.map((p) => ({
        project: p,
        checkouts: checkoutsOf(p, input.worktrees[p.name], input.errors[p.name]),
    }));
    const other: SidebarAgent[] = [];
    const all = groups.flatMap((g) => g.checkouts);
    for (const a of input.agents) {
        const cwd = input.agentCwds[a.id];
        const home = cwd ? containingWorktree(cwd, all) : undefined;
        (home?.agents ?? other).push(a);
    }
    return { groups, other };
}

function isCurrentAgent(a: SidebarAgent, current: SidebarInput["current"]): boolean {
    return current.origin?.kind === "agent" && current.origin.id === a.id;
}

// currentProject names the group holding the current source, which the view expands on a scope change. Expansion
// itself is only the user's set, so the group holding the current source can still be collapsed.
export function currentProject(input: SidebarInput): string | undefined {
    const { current } = input;
    return placeAgents(input).groups.find((g) =>
        g.checkouts.some((c) => isCurrentCheckout(c, current) || c.agents.some((a) => isCurrentAgent(a, current)))
    )?.project.name;
}

export function sidebarRows(input: SidebarInput): SidebarRow[] {
    const { current } = input;
    const { groups, other } = placeAgents(input);

    const q = input.query.trim().toLowerCase();
    const hit = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
    const pathHit = (p: string) => normalizeRepoPath(p).includes(normalizeRepoPath(q) || q);

    const rows: SidebarRow[] = [];
    for (const g of groups) {
        const name = g.project.name;
        const projectHit = !q || hit(name);
        // with a query, a checkout shows when it matches or holds a matching agent, and shows only those agents
        const shown = g.checkouts
            .map((c) => {
                const agents = projectHit ? c.agents : c.agents.filter((a) => hit(a.name));
                const matches = projectHit || hit(c.wt.branch) || pathHit(c.path);
                return matches || agents.length > 0 ? { c, agents } : null;
            })
            .filter((s) => s != null);
        if (shown.length === 0) {
            continue;
        }
        // a query shows every group it matches; that is not the user's expanded set
        const expanded = !!q || input.expanded.has(name);
        const error = input.errors[name];
        rows.push({ kind: "group", project: name, path: g.project.path, expanded, ...(error ? { error } : {}) });
        if (!expanded) {
            continue;
        }
        for (const { c, agents } of shown) {
            rows.push({
                kind: "worktree",
                project: name,
                wt: c.wt,
                label: c.label,
                current: isCurrentCheckout(c, current),
            });
            for (const a of agents) {
                rows.push({ kind: "agent", agent: a, current: isCurrentAgent(a, current) });
            }
        }
    }

    const others = q ? other.filter((a) => hit(a.name)) : other;
    if (others.length > 0) {
        rows.push({ kind: "other-agents" });
        for (const a of others) {
            rows.push({ kind: "agent", agent: a, current: isCurrentAgent(a, current) });
        }
    }
    return rows;
}
