// frontend/app/view/agents/syncstate.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the Diff surface's sync bar (Fetch, Pull, Push) draws and says. The upstream and its
// counts come from GetChanges; this file only turns them, a detached HEAD and the running action into
// button states, words a failure in the user's terms, and finds the agents a Pull would disturb. No
// React, no Wave imports beyond the path normalizer.

import { normalizeRepoPath } from "@/util/paths";

export type SyncKind = "fetch" | "pull" | "push";

export type SyncInput = {
    branch: string;
    // "origin/main", or "" when the branch tracks nothing.
    upstream: string;
    ahead: number;
    behind: number;
    // The action in flight, or null.
    running: SyncKind | null;
    // "3m" and the like; "" when this session has not fetched yet.
    fetchedAgo: string;
};

export type SyncButton = {
    label: string;
    title: string;
    disabled: boolean;
    spinning: boolean;
};

export type SyncViewModel = {
    counts: string;
    countsTitle: string;
    fetch: SyncButton;
    pull: SyncButton;
    push: SyncButton;
};

function detached(branch: string): boolean {
    return branch === "" || branch === "HEAD";
}

export function syncView(input: SyncInput): SyncViewModel {
    const { branch, upstream, ahead, behind, running, fetchedAgo } = input;
    const noBranch = detached(branch);
    const hasUpstream = upstream !== "";
    // The action in flight holds the other two; a detached HEAD holds all three.
    const held = (kind: SyncKind) => noBranch || (running !== null && running !== kind);
    const spinning = (kind: SyncKind) => running === kind;

    let counts = `↑${ahead} ↓${behind}`;
    let countsTitle = `Against ${upstream}`;
    if (noBranch) {
        counts = "detached";
        countsTitle = "HEAD is detached; there is no branch to sync";
    } else if (!hasUpstream) {
        counts = "no upstream";
        countsTitle = `${branch} tracks no upstream`;
    }

    return {
        counts,
        countsTitle,
        fetch: {
            label: "Fetch",
            title: fetchedAgo ? `Fetch origin · fetched ${fetchedAgo} ago` : "Fetch origin",
            disabled: held("fetch"),
            spinning: spinning("fetch"),
        },
        pull: {
            label: "Pull",
            title: noBranch
                ? "HEAD is detached; there is no branch to pull into"
                : hasUpstream
                  ? "Pull (fast-forward only)"
                  : `${branch} has no upstream to pull from`,
            disabled: held("pull") || !hasUpstream,
            spinning: spinning("pull"),
        },
        push: {
            label: !noBranch && !hasUpstream ? "Publish" : "Push",
            title: noBranch
                ? "HEAD is detached; there is no branch to push"
                : hasUpstream
                  ? `Push to ${upstream}`
                  : `Push and set origin/${branch} as upstream`,
            disabled: held("push"),
            spinning: spinning("push"),
        },
    };
}

// A sentence for the two failures a user can act on; "" for anything else, which the GitFailure panel
// shows in git's own words (an authentication error, a hook, a network drop).
export function explainSyncFailure(kind: SyncKind, failure: GitFailure, branch: string, upstream: string): string {
    const err = failure.stderr;
    if (kind === "pull" && /not possible to fast-forward|diverging branches/i.test(err)) {
        return `${branch} and ${upstream} have diverged. Pull here only fast-forwards; merge or rebase in a terminal.`;
    }
    if (
        kind === "push" &&
        /\[rejected\]|\(fetch first\)|non-fast-forward|tip of your current branch is behind/i.test(err)
    ) {
        return `${upstream} has commits you lack. Pull first, then push.`;
    }
    return "";
}

// The names of the agents a Pull into `cwd` would change files under: those whose own directory is the
// worktree or inside it, and that are not idle. Compared by path segment, so `repo-two` is not in `repo`.
export function agentsWorkingIn(
    cwd: string,
    agents: { id: string; name: string; state: string }[],
    agentCwds: Record<string, string>
): string[] {
    const root = normalizeRepoPath(cwd);
    if (root === "") {
        return [];
    }
    const names: string[] = [];
    for (const agent of agents) {
        const dir = agentCwds[agent.id];
        if (!dir || agent.state === "idle") {
            continue;
        }
        const here = normalizeRepoPath(dir);
        if (here === root || here.startsWith(root + "/")) {
            names.push(agent.name);
        }
    }
    return names;
}
