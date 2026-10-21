// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent rail's Files tab, as loaded state (docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md): the
// listing of each worktree, the contents of the ignored directories opened in it, and each agent's expanded and
// selected rows (railtree.ts). Every atom is module-scoped: the rail unmounts with the Agent surface, and the tree must
// still be there, as it was left, when the surface comes back.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { buildTree, dirsToList, lazyDirs, type TreeNode } from "@/app/view/code/codetree";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { EMPTY_RAIL_TREE, pruneExpanded, type RailTreeState } from "./railtree";

export type RailListingStatus = "loading" | "ready" | "error" | "notrepo";

export interface RailListing {
    status: RailListingStatus;
    // tracked and untracked paths, and what .gitignore excludes (a wholly ignored directory is one entry ending in "/"),
    // as GitListFilesCommand returns them; both are kept while a reload is in flight
    files: string[];
    ignored: string[];
    truncated: boolean; // the server's cap cut the listing short
    error?: string; // set only with status "error"
    // the folder read level by level from the disk while git walks, before any listing of it was kept: its directories
    // end in "/" in `files` and are read as they open (listIgnoredDirs). Only ever with status "loading"
    partial?: true;
}

// the listing of a worktree nobody has loaded yet
const NO_ROWS: RailListing = { status: "loading", files: [], ignored: [], truncated: false };

type Listed = Readonly<Record<string, string[]>>;
const NO_LISTED: Listed = {};

// by cwd
export const railListingsAtom = atom<Record<string, RailListing>>({}) as PrimitiveAtom<Record<string, RailListing>>;
// by cwd, then by the ignored directory opened in it: that directory's entries (codestore.ts codeIgnoredListedAtom)
export const railIgnoredListedAtom = atom<Record<string, Listed>>({}) as PrimitiveAtom<Record<string, Listed>>;

export const railListingAtom = atomFamily((cwd: string) => atom((get) => get(railListingsAtom)[cwd]));
export const railListedAtom = atomFamily((cwd: string) => atom((get) => get(railIgnoredListedAtom)[cwd] ?? NO_LISTED));

// by agent id: switching agents or surfaces and coming back finds the tree as it was left
export const railTreeStateAtom = atomFamily(
    (_agentId: string) => atom<RailTreeState>(EMPTY_RAIL_TREE) as PrimitiveAtom<RailTreeState>
);

// The opened ignored directories the listing still leads to: one of its own entries ending in "/", or an entry of such a
// directory that is itself one. A reload that no longer ignores a directory whole retires what was listed under it.
export function reachableListed(ignored: readonly string[], listed: Listed): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const todo = [...lazyDirs(ignored)];
    for (let dir = todo.pop(); dir != null; dir = todo.pop()) {
        const entries = listed[dir];
        if (entries != null && out[dir] == null) {
            out[dir] = entries;
            todo.push(...lazyDirs(entries));
        }
    }
    return out;
}

export function railIgnoredEntries(ignored: readonly string[], listed: Listed): string[] {
    return [...ignored, ...Object.values(reachableListed(ignored, listed)).flat()];
}

export function railTree(listing: RailListing | undefined, listed: Listed): TreeNode[] {
    return listing == null ? [] : buildTree(listing.files, railIgnoredEntries(listing.ignored, listed));
}

// Same ceiling as codestore.ts: the RPC layer's own 5s binds the server-side context, and a cold first walk of a big
// working tree outlasts it, so gitinfo's listing limit is the one that has to decide.
const LIST_RPC_TIMEOUT_MS = 60_000;

// the newest load started for each cwd: an older reply finding another number here has lost
const loadSeq = new Map<string, number>();
// ignored directories being listed, as `${cwd}\n${dir}`
const listingDirs = new Set<string>();

function putListing(cwd: string, listing: RailListing): void {
    globalStore.set(railListingsAtom, (m) => ({ ...m, [cwd]: listing }));
}

function listedFor(cwd: string): Listed {
    return globalStore.get(railIgnoredListedAtom)[cwd] ?? NO_LISTED;
}

// Reads the worktree's files again for `agentId`'s Files tab. The rows already shown stay while the load is in flight,
// and a reply that a newer load for the same cwd has overtaken is dropped. A failure replaces the rows with its message
// (status "error"); it is never an empty tree. Afterwards the agent's expanded and selected rows that no longer exist
// are dropped. With no rows to show yet, the tree shows what is quicker than git meanwhile (showEarly).
export async function reloadTree(cwd: string, agentId: string): Promise<void> {
    const seq = (loadSeq.get(cwd) ?? 0) + 1;
    loadSeq.set(cwd, seq);
    const had = globalStore.get(railListingsAtom)[cwd];
    putListing(cwd, { ...(had ?? NO_ROWS), status: "loading", error: undefined });
    if (had == null || had.files.length === 0) {
        void showEarly(cwd, seq);
    }
    let res: CommandGitListFilesRtnData;
    try {
        res = await RpcApi.GitListFilesCommand(TabRpcClient, { cwd }, { timeout: LIST_RPC_TIMEOUT_MS });
    } catch (e) {
        if (loadSeq.get(cwd) === seq) {
            putListing(cwd, { ...NO_ROWS, status: "error", error: e instanceof Error ? e.message : String(e) });
        }
        return;
    }
    if (loadSeq.get(cwd) !== seq) {
        return;
    }
    if (!res.isrepo) {
        putListing(cwd, { ...NO_ROWS, status: "notrepo" });
        return;
    }
    putListing(cwd, {
        status: "ready",
        files: res.files ?? [],
        ignored: res.ignored ?? [],
        truncated: res.truncated ?? false,
    });
    pruneAgentTree(agentId, cwd);
    // the directories opened before may hold other files now; the old entries show until the new ones land
    await refreshListedDirs(cwd);
    pruneAgentTree(agentId, cwd);
}

// Git's walk of a folder takes 0.5s warm, and well over 10s on a cold disk cache or a busy machine, so a tree with
// nothing to show asks for two quicker answers at once: the listing wavesrv kept from the last walk (a memory or file
// read), and the folder's top level from the disk (one directory read). The top level shows until the kept listing
// lands; either gives way to git's. Neither replaces rows git or an error already put there.
async function showEarly(cwd: string, seq: number): Promise<void> {
    let keptShown = false;
    const waiting = () => loadSeq.get(cwd) === seq && globalStore.get(railListingsAtom)[cwd]?.status === "loading";
    const top = (async () => {
        let entries: string[];
        try {
            entries = (await RpcApi.GitListIgnoredDirCommand(TabRpcClient, { cwd, dir: "" })).entries ?? [];
        } catch {
            return; // git's answer will say why
        }
        if (!keptShown && waiting()) {
            putListing(cwd, { status: "loading", files: entries, ignored: [], truncated: false, partial: true });
        }
    })();
    const kept = (async () => {
        let res: CommandGitListFilesRtnData;
        try {
            res = await RpcApi.GitListFilesCommand(TabRpcClient, { cwd, cached: true });
        } catch {
            return;
        }
        if (res.cached && waiting()) {
            keptShown = true;
            putListing(cwd, {
                status: "loading",
                files: res.files ?? [],
                ignored: res.ignored ?? [],
                truncated: res.truncated ?? false,
            });
        }
    })();
    await Promise.all([top, kept]);
}

// While the tree is the partial top level, an opened directory is read the same way, one level, into `files`; git's
// listing then replaces it all.
async function listPartialDirs(cwd: string, expanded: readonly string[]): Promise<void> {
    const listing = globalStore.get(railListingsAtom)[cwd];
    if (!listing?.partial) {
        return;
    }
    const unread = expanded.filter(
        (d) => listing.files.includes(`${d}/`) && !listing.files.some((p) => p.startsWith(`${d}/`) && p !== `${d}/`)
    );
    await Promise.all(
        unread.map(async (dir) => {
            const key = `${cwd}\n${dir}`;
            if (listingDirs.has(key)) {
                return;
            }
            listingDirs.add(key);
            let entries: string[];
            try {
                entries = (await RpcApi.GitListIgnoredDirCommand(TabRpcClient, { cwd, dir: `${dir}/` })).entries ?? [];
            } catch {
                return;
            } finally {
                listingDirs.delete(key);
            }
            const now = globalStore.get(railListingsAtom)[cwd];
            if (now?.partial) {
                const have = new Set(now.files);
                putListing(cwd, { ...now, files: [...now.files, ...entries.filter((e) => !have.has(e))] });
            }
        })
    );
}

function pruneAgentTree(agentId: string, cwd: string): void {
    const listing = globalStore.get(railListingsAtom)[cwd];
    if (listing?.status !== "ready") {
        return; // a newer load is in flight, or failed: the rows it replaces are not the ones to measure against
    }
    const stateAtom = railTreeStateAtom(agentId);
    const state = globalStore.get(stateAtom);
    const pruned = pruneExpanded(state, railTree(listing, listedFor(cwd)));
    if (pruned !== state) {
        globalStore.set(stateAtom, pruned);
    }
}

async function refreshListedDirs(cwd: string): Promise<void> {
    const listing = globalStore.get(railListingsAtom)[cwd];
    if (listing == null) {
        return;
    }
    const kept = reachableListed(listing.ignored, listedFor(cwd));
    globalStore.set(railIgnoredListedAtom, (m) => ({ ...m, [cwd]: kept }));
    await Promise.all(Object.keys(kept).map((dir) => listIgnoredDir(cwd, dir)));
}

async function listIgnoredDir(cwd: string, dir: string): Promise<void> {
    const key = `${cwd}\n${dir}`;
    if (listingDirs.has(key)) {
        return;
    }
    listingDirs.add(key);
    let entries: string[];
    try {
        entries = (await RpcApi.GitListIgnoredDirCommand(TabRpcClient, { cwd, dir })).entries ?? [];
    } catch (e) {
        console.warn("[rail tree] could not list the ignored directory", dir, e);
        // an unreadable directory opens empty rather than retrying on every render; a refresh keeps what it had
        entries = listedFor(cwd)[dir] ?? [];
    } finally {
        listingDirs.delete(key);
    }
    const listing = globalStore.get(railListingsAtom)[cwd];
    if (listing == null || !lazyDirs(railIgnoredEntries(listing.ignored, listedFor(cwd))).has(dir)) {
        return; // a reload since then no longer ignores this directory whole
    }
    globalStore.set(railIgnoredListedAtom, (m) => ({ ...m, [cwd]: { ...m[cwd], [dir]: entries } }));
}

// Lists the expanded ignored directories nobody has listed yet. The tree pane runs it whenever the expanded rows or the
// listing change, so every way a directory opens (click, keys) is covered.
export async function listIgnoredDirs(cwd: string, expanded: readonly string[]): Promise<void> {
    const listing = globalStore.get(railListingsAtom)[cwd];
    if (listing == null) {
        return;
    }
    if (listing.partial) {
        await listPartialDirs(cwd, expanded);
        return;
    }
    const listed = listedFor(cwd);
    const lazy = lazyDirs(railIgnoredEntries(listing.ignored, listed));
    const todo = dirsToList(new Set(expanded), lazy, new Set(Object.keys(listed)));
    await Promise.all(todo.map((dir) => listIgnoredDir(cwd, dir)));
}
