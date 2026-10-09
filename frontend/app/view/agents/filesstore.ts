// frontend/app/view/agents/filesstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Files-surface state + loaders for the focused agent. Mirrors liveagents.ts/previousinfo.ts:
// module-level atoms written by an async loader via globalStore. cwd is read from the agent's
// transcript (zero git); branch + changes + per-file diff come from the git RPCs.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { resolveCwd } from "./agentcwdresolve";
import { ensureSessionStart } from "./agentsessionstore";
import { originCwd, scopeKey, type DiffOrigin, type DiffRange, type DiffScope } from "./diffscope";
import { firstShownPath } from "./filestep";
import { parseGitChanges, type GitChanges } from "./gitstatus";

export interface FilesState {
    cwd: string | null;
    branch: string;
    isRepo: boolean;
    changes: GitChanges | null;
    ref: string; // base commit to diff against; "" = live working-tree-vs-HEAD
    // The commit HEAD points at when this read was taken, "" in a repository with no commits. It costs
    // nothing (GetChanges already resolves HEAD) and it is what lets the Diff surface notice a commit
    // landing under it: the poll below re-reads the change list on a timer, and the surface compares
    // this against the sha its commit column was built from.
    head: string;
    // HEAD's upstream ("origin/main") and how many commits HEAD is ahead of / behind it. "" and 0/0 when the
    // branch has no upstream or HEAD is detached. The sync bar reads these off this poll, so no second
    // timer reads the repository.
    upstream: string;
    upstreamAhead: number;
    upstreamBehind: number;
}

// A registered project the Diff surface can scope to, resolved from the config registry (name -> path).
export interface FilesProject {
    name: string;
    path: string;
}

export const filesStateAtom = atom<FilesState | null>(null) as PrimitiveAtom<FilesState | null>;
export const filesSelectedPathAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// true = the git load failed (distinct from "not a repo" — a failed RPC used to masquerade as isRepo:false).
export const filesErrorAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

// guards against a stale load overwriting a newer one; the token is scopeKey(scope), so switching
// either the repository or the range cancels the in-flight load.
const current = { token: "" };

const EMPTY: FilesState = {
    cwd: null,
    branch: "",
    isRepo: false,
    changes: null,
    ref: "",
    head: "",
    upstream: "",
    upstreamAhead: 0,
    upstreamBehind: 0,
};

// How to anchor the diff: an explicit base commit (runs), or a session-start unix-seconds timestamp
// (interactive agents) that the backend resolves to the session-start commit and echoes back so
// committed work still shows. Neither set = live working-tree-vs-HEAD (project view). sessionStartTs
// wins if both are set.
interface LoadOpts {
    ref?: string;
    sessionStartTs?: number;
}

// Core: fetch branch + changes for a resolved cwd. The caller owns the guard token (set before any
// await) so a newer load short-circuits this one's writes. isInitial distinguishes a fresh scope load
// (beginLoad already cleared the selection, so pick the first file) from a refresh of the same scope
// (leave the user's selection alone; just resync its diff if it's still in the change set).
async function loadChangesForCwd(token: string, cwd: string | null, opts: LoadOpts, isInitial: boolean): Promise<void> {
    if (!cwd) {
        if (current.token === token) {
            globalStore.set(filesStateAtom, EMPTY);
        }
        return;
    }
    try {
        const ch = await RpcApi.GitChangesCommand(TabRpcClient, {
            cwd,
            ...(opts.ref ? { ref: opts.ref } : {}),
            ...(opts.sessionStartTs ? { sessionstartts: opts.sessionStartTs } : {}),
        });
        if (current.token !== token) {
            return;
        }
        // sessionStartTs mode: the backend resolved + echoed the concrete base — thread it into per-file
        // diffs so they match the list. Otherwise use the ref we sent ("" = live).
        const ref = opts.sessionStartTs ? (ch.ref ?? "") : (opts.ref ?? "");
        const changes = ch.isrepo ? parseGitChanges(ch.statusz, ch.numstat) : null;
        globalStore.set(filesStateAtom, {
            cwd,
            branch: ch.branch,
            isRepo: ch.isrepo,
            changes,
            ref,
            head: ch.head ?? "",
            upstream: ch.upstream ?? "",
            upstreamAhead: ch.upstreamahead ?? 0,
            upstreamBehind: ch.upstreambehind ?? 0,
        });
        globalStore.set(filesErrorAtom, false);
        if (isInitial) {
            // Deliberately always the first file: a deep link is claimed by the history store, which owns
            // the *visible* selection. Honouring it here as well would load one file's diff and then have
            // the history load pick another, so the pane showed whichever RPC landed last.
            const first = changes ? firstShownPath(changes.files) : undefined;
            if (first) {
                selectFile(first);
            }
        }
        // A refresh deliberately does nothing to the selection: never move it out from under the user.
        // The open file's content is re-read by the surface, which keys off this state's identity.
    } catch {
        if (current.token === token) {
            // a failed git RPC is an error, not a clean "not a repo" — flag it so the surface says so.
            globalStore.set(filesErrorAtom, true);
            globalStore.set(filesStateAtom, { ...EMPTY, cwd });
        }
    }
}

// Re-fetch changes for the surface's active source, reusing the live guard token so the writes
// aren't short-circuited (used after a Review apply mutates the tree). No-op if nothing is loaded.
export async function reloadChanges(cwd: string | null): Promise<void> {
    if (!current.token) return;
    // reuse the already-resolved concrete base (a sha for worktree/run modes, "" for live) so the
    // reload stays anchored to the same point the initial load picked.
    const ref = globalStore.get(filesStateAtom)?.ref ?? "";
    await loadChangesForCwd(current.token, cwd, { ref }, false);
}

// The Diff surface reads its change list once on mount and otherwise has no way to learn a file was
// touched — there is no git file-watch event to subscribe to. Polling is the mechanism: while the
// surface is on screen, re-fetch on a fixed cadence. Reads the cwd fresh on every tick rather than
// closing over it, so a source/range switch mid-interval polls the new subject; reloadChanges no-ops
// until something has loaded, so a tick before the first load is harmless.
export const FILES_POLL_MS = 10_000;

export function startChangesPoll(intervalMs: number = FILES_POLL_MS): () => void {
    const t = setInterval(() => void reloadChanges(globalStore.get(filesStateAtom)?.cwd ?? null), intervalMs);
    return () => clearInterval(t);
}

function beginLoad(token: string): void {
    current.token = token;
    globalStore.set(filesStateAtom, null);
    globalStore.set(filesSelectedPathAtom, null);
    globalStore.set(filesErrorAtom, false);
}

export interface ScopeAgent {
    transcriptPath?: string;
    blockId?: string;
}

// One load for every subject the surface can have. Which range is active decides the anchor and
// nothing else; the directory comes from the origin, resolved from the transcript only for an agent.
export async function loadFilesForScope(scope: DiffScope, agent?: ScopeAgent): Promise<void> {
    const token = scopeKey(scope);
    beginLoad(token);
    const cwd = await resolveScopeCwd(scope.repo.origin, agent);
    if (current.token !== token) {
        return;
    }
    const opts = await resolveRangeOpts(scope.range, agent?.transcriptPath);
    if (current.token !== token) {
        return;
    }
    await loadChangesForCwd(token, cwd, opts, true);
}

async function resolveScopeCwd(origin: DiffOrigin, agent?: ScopeAgent): Promise<string | null> {
    const known = originCwd(origin);
    if (known != null) {
        return known;
    }
    return (await resolveCwd(agent?.transcriptPath, agent?.blockId)) || null;
}

// The one place a range becomes RPC arguments. Not in diffscope.ts with the other derivations,
// because the session anchor is an async transcript read rather than a pure function of the range.
async function resolveRangeOpts(range: DiffRange, transcriptPath?: string): Promise<LoadOpts> {
    switch (range.kind) {
        case "run":
            return { ref: range.baseCommit };
        case "session":
            // anchor on the session-start commit so committed work stays visible (a plain vs-HEAD
            // diff would collapse to nothing after the agent commits). Null degrades to the live diff.
            return { sessionStartTs: (await ensureSessionStart(transcriptPath)) ?? undefined };
        // Neither anchors. Comparison drives panes 1 and 2 from comparestore; this load only supplies
        // cwd, branch and whether the directory is a repository at all.
        case "working":
        case "compare":
            return {};
    }
}

// A caller elsewhere in the app — a sealed run's evidence card, an agent's changed-file rail — names
// the file it wants before the Diff surface has mounted. Held here rather than in an atom, and read by
// the history store, which owns the *visible* selection: writing filesSelectedPathAtom would not move
// the pane, because since the git-review rewrite panes 2 and 3 render whatever the history pane's
// selected row is.
//
// Keyed by scopeKey (diffscope.ts) rather than by run id, so every subject the surface can be scoped
// to links the same way, and the link and the load that must claim it are built by the same function.
// The agent rail used to have a separate mechanism that wrote an atom nothing renders, which is why
// clicking a file there landed on the scope's first file.
//
// One-shot on purpose. The history pane deliberately remembers where you were so a nav switch does not
// throw you back to row zero; a deep link has to beat that once, then stop, or every return to the
// surface would drag you back to the linked file.
const pendingFileLink = { scope: "", path: "" };

export function requestFileLink(scope: string, path: string): void {
    pendingFileLink.scope = scope;
    pendingFileLink.path = path;
}

// Consumed only when `available` (the scope's loaded change set) actually holds the path. The Diff
// surface fires one history read per mount against the state captured in that render, which on a
// remount is still the outgoing scope's — a request eaten by that read would never reach the load that
// can honour it, and selecting a file the pane does not list would leave it blank.
export function consumeFileLink(scope: string, available: string[]): string | undefined {
    if (!scope || pendingFileLink.scope !== scope || !pendingFileLink.path) {
        return undefined;
    }
    if (!available.includes(pendingFileLink.path)) {
        return undefined;
    }
    const path = pendingFileLink.path;
    pendingFileLink.scope = "";
    pendingFileLink.path = "";
    return path;
}

// Selection only. The diff pane reads the file's two sides itself (diffcontentstore), keyed off this
// path and the state's ref, so there is no patch to fetch here — and so no cwd is needed.
export function selectFile(path: string): void {
    globalStore.set(filesSelectedPathAtom, path);
}
