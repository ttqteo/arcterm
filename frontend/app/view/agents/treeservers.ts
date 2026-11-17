// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: which listening servers (the footer's Servers poll) the Agent tree shows on which row, so you can tell which
// project has a server up without opening Servers. A row shows the servers it holds; a project's folder shows the ones
// in its repo that no row shows, and, folded, every one in its repo.

/** What the tree needs of a server row (DevServerRow fits). */
export type TreeServer = {
    pid: number;
    createms: number;
    ports: number[];
    repo?: string;
    owner?: { kind: string; tabid?: string };
};

function key(s: TreeServer): string {
    return `${s.pid}:${s.createms}`;
}

/** Pure: the servers a tree row holds: the ones whose owner is its tab (its shell's, or what it ran with `wsh detach`)
 *  and the ones a running background task of it launched (`launched`, bgactivity.ts), each once, by port. */
export function rowServers<S extends TreeServer>(
    servers: readonly S[] | null,
    tabId: string,
    launched: readonly S[]
): S[] {
    const out = new Map<string, S>();
    for (const s of launched) {
        out.set(key(s), s);
    }
    for (const s of servers ?? []) {
        if (s.owner?.tabid === tabId && (s.owner.kind === "agent" || s.owner.kind === "terminal")) {
            out.set(key(s), s);
        }
    }
    return [...out.values()].sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0));
}

// "D:\Work\Portal\" and "d:/work/portal" are one folder
function samePath(a: string, b: string): boolean {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    return norm(a) === norm(b);
}

/** Pure: the servers a project's folder shows: those in its repo (`path`) that no row of the tree holds (`rowIds`: the
 *  tree's agent and terminal ids), or, while the folder is folded and its rows hidden, every one in its repo. None
 *  without a path. */
export function folderServers<S extends TreeServer>(
    servers: readonly S[] | null,
    path: string | undefined,
    open: boolean,
    rowIds: ReadonlySet<string>
): S[] {
    if (!path) {
        return [];
    }
    return (servers ?? [])
        .filter((s) => s.repo != null && samePath(s.repo, path))
        .filter((s) => !open || s.owner?.tabid == null || !rowIds.has(s.owner.tabid))
        .sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0));
}
