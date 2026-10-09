// frontend/app/view/agents/commitstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Commit tab's state and its one write. Everything is keyed by the worktree's cwd, so it survives the surface
// unmounting (the Diff surface drops its local state on every switch) and one worktree's draft never lands in another's
// box. The list is read live, with no ref: an agent scope's filesStateAtom is anchored at the session start, which would
// list committed work as if it were still to commit. The ticks, the amend flag and the failure all live here; the rules
// about them (defaults, pruning, the button, Amend's enablement) are commitselection.ts's.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import {
    amendAllowed,
    canCommit,
    committable,
    isTicked,
    NO_TICKS,
    pruneTicks,
    setManyTicked,
    setTicked,
    tickedCount,
    tickedPaths,
    type CommitTicks,
} from "./commitselection";
import { panelFoldedAtom, panelTabAtom } from "./difflayout";
import { FILES_POLL_MS, reloadChanges } from "./filesstore";
import { buildFileTree, collapsedDirsAtom, treeModeAtom } from "./filetree";
import { refreshHistory, selectCommit } from "./githistorystore";
import { parseGitChanges, type GitChange, type GitChanges } from "./gitstatus";
import { agentsWorkingIn } from "./syncstate";

export interface CommitList {
    // the working tree against HEAD; a repository with a clean tree holds an empty list
    changes: GitChanges;
    // HEAD (full sha, "" before the first commit) and its upstream, which decide whether Amend is safe
    head: string;
    upstream: string;
    upstreamAhead: number;
}

export interface CommitRun {
    running: boolean;
    failure: GitFailure | null;
}

const IDLE: CommitRun = { running: false, failure: null };

type ByCwd<T> = Record<string, T>;

// undefined until the first read of a worktree lands (the tab draws its skeleton)
export const commitListAtom = atom<ByCwd<CommitList | undefined>>({}) as PrimitiveAtom<ByCwd<CommitList | undefined>>;
export const commitTicksAtom = atom<ByCwd<CommitTicks>>({}) as PrimitiveAtom<ByCwd<CommitTicks>>;
export const commitDraftAtom = atom<ByCwd<string>>({}) as PrimitiveAtom<ByCwd<string>>;
export const commitAmendAtom = atom<ByCwd<boolean>>({}) as PrimitiveAtom<ByCwd<boolean>>;
// the file whose diff the pane shows while the Commit tab is open
export const commitSelectedAtom = atom<ByCwd<string | null>>({}) as PrimitiveAtom<ByCwd<string | null>>;
export const commitRunAtom = atom<ByCwd<CommitRun>>({}) as PrimitiveAtom<ByCwd<CommitRun>>;
// the Unversioned group is folded until the person opens it, and stays as they left it
export const unversionedOpenAtom = atom(false) as PrimitiveAtom<boolean>;

export function commitRunOf(runs: ByCwd<CommitRun>, cwd: string | undefined): CommitRun {
    return (cwd && runs[cwd]) || IDLE;
}

function put<T>(a: PrimitiveAtom<ByCwd<T>>, cwd: string, value: T): void {
    globalStore.set(a, (prev) => ({ ...prev, [cwd]: value }));
}

// Pure: the list's two groups. Changes holds what git tracks (M, A, D, R, C), Unversioned what it has not met.
export function splitChanges(files: GitChange[]): { tracked: GitChange[]; unversioned: GitChange[] } {
    return { tracked: files.filter((f) => f.status !== "?"), unversioned: files.filter((f) => f.status === "?") };
}

// One drawn row of a group: a directory (tree mode) holding `under`, or a file. `dir` is the muted parent a flat row
// shows before its name.
export interface CommitRow {
    kind: "dir" | "file";
    id: string; // the directory path, or the file path
    label: string;
    dir: string;
    depth: number;
    change?: GitChange;
    under?: GitChange[];
}

function flatRow(f: GitChange): CommitRow {
    // a nested repository is listed with a trailing slash; its name is the last segment before it
    const bare = f.path.endsWith("/") ? f.path.slice(0, -1) : f.path;
    const at = bare.lastIndexOf("/");
    return { kind: "file", id: f.path, label: f.path.slice(at + 1), dir: f.path.slice(0, at + 1), depth: 0, change: f };
}

// Pure: a group's rows in draw order. The tree is filetree.ts's; a nested repository ("vendor/tool/") would read as a
// folder holding a file with no name there, so it is drawn as a top-level row, after the tree, under its whole path.
export function commitRows(files: GitChange[], tree: boolean, collapsed: Set<string>): CommitRow[] {
    if (!tree) {
        return files.map(flatRow);
    }
    const repos = files.filter((f) => f.path.endsWith("/"));
    const plain = files.filter((f) => !f.path.endsWith("/"));
    const rows: CommitRow[] = buildFileTree(plain, collapsed).map((r) =>
        r.kind === "dir"
            ? {
                  kind: "dir",
                  id: r.id,
                  label: r.label,
                  dir: "",
                  depth: r.depth,
                  under: plain.filter((f) => f.path.startsWith(`${r.id}/`)),
              }
            : { kind: "file", id: r.id, label: r.label, dir: "", depth: r.depth, change: r.change }
    );
    return [
        ...rows,
        ...repos.map((f): CommitRow => ({ kind: "file", id: f.path, label: f.path, dir: "", depth: 0, change: f })),
    ];
}

export function rowPaths(rows: CommitRow[]): string[] {
    return rows.filter((r) => r.kind === "file").map((r) => r.id);
}

// The paths the open groups draw, top to bottom: Changes, then Unversioned when it is open. ↑/↓ walk this order.
export function commitShownPaths(
    files: GitChange[],
    tree: boolean,
    collapsed: Set<string>,
    unversionedOpen: boolean
): string[] {
    const g = splitChanges(files);
    return [
        ...rowPaths(commitRows(g.tracked, tree, collapsed)),
        ...(unversionedOpen ? rowPaths(commitRows(g.unversioned, tree, collapsed)) : []),
    ];
}

// The file a fresh list opens on: the top row of Changes as drawn, else (a tree with nothing but untracked files, or every
// folder folded) the first file that exists, so the diff is never empty while the list has files.
function firstCommitPath(files: GitChange[]): string | null {
    const tree = globalStore.get(treeModeAtom);
    const collapsed = globalStore.get(collapsedDirsAtom);
    const g = splitChanges(files);
    return (
        rowPaths(commitRows(g.tracked, tree, collapsed))[0] ??
        rowPaths(commitRows(g.tracked, tree, new Set()))[0] ??
        rowPaths(commitRows(g.unversioned, tree, new Set()))[0] ??
        null
    );
}

// a newer read of one worktree's list supersedes an older one still in flight
const loadSeq = new Map<string, number>();

// Reads the working tree against HEAD, whatever the surface's scope is anchored at. Always stores a new entry, so a
// view over it re-renders on every read, changed or not.
export async function loadCommitList(cwd: string): Promise<void> {
    const seq = (loadSeq.get(cwd) ?? 0) + 1;
    loadSeq.set(cwd, seq);
    try {
        const ch = await RpcApi.GitChangesCommand(TabRpcClient, { cwd });
        if (loadSeq.get(cwd) !== seq) {
            return;
        }
        const changes = ch.isrepo ? parseGitChanges(ch.statusz, ch.numstat) : { files: [], adds: 0, dels: 0 };
        put(commitListAtom, cwd, {
            changes,
            head: ch.head ?? "",
            upstream: ch.upstream ?? "",
            upstreamAhead: ch.upstreamahead ?? 0,
        });
        const ticks = globalStore.get(commitTicksAtom)[cwd];
        if (ticks != null) {
            const pruned = pruneTicks(ticks, changes.files);
            if (pruned.off.length !== ticks.off.length || pruned.on.length !== ticks.on.length) {
                put(commitTicksAtom, cwd, pruned);
            }
        }
        // the quick look: a list always has a file open, and a file that left it (committed, reverted) hands the diff to
        // the top row instead of leaving it on a path that is gone
        const selected = globalStore.get(commitSelectedAtom)[cwd] ?? null;
        if (selected == null || !changes.files.some((f) => f.path === selected)) {
            put(commitSelectedAtom, cwd, firstCommitPath(changes.files));
        }
    } catch {
        // keep what is on screen: the next tick reads again
    }
}

// Reads the list now and then on the change poll's cadence, for as long as the tab is on screen.
export function startCommitPoll(cwd: string, intervalMs: number = FILES_POLL_MS): () => void {
    void loadCommitList(cwd);
    const t = setInterval(() => void loadCommitList(cwd), intervalMs);
    return () => clearInterval(t);
}

export function toggleTick(cwd: string, change: GitChange, on: boolean): void {
    put(commitTicksAtom, cwd, setTicked(globalStore.get(commitTicksAtom)[cwd] ?? NO_TICKS, change, on));
}

// Space: the open file's tick, flipped. A row git cannot commit has no tick to flip.
export function toggleSelectedTick(cwd: string): void {
    const selected = globalStore.get(commitSelectedAtom)[cwd];
    const change = globalStore.get(commitListAtom)[cwd]?.changes.files.find((f) => f.path === selected);
    if (change != null && committable(change)) {
        toggleTick(cwd, change, !isTicked(globalStore.get(commitTicksAtom)[cwd] ?? NO_TICKS, change));
    }
}

export function setAllTicked(cwd: string, files: GitChange[], on: boolean): void {
    put(commitTicksAtom, cwd, setManyTicked(globalStore.get(commitTicksAtom)[cwd] ?? NO_TICKS, files, on));
}

export function setDraft(cwd: string, text: string): void {
    put(commitDraftAtom, cwd, text);
}

export function selectCommitTabFile(cwd: string, path: string): void {
    put(commitSelectedAtom, cwd, path);
}

// HEAD's message as Amend loaded it (trimmed), per worktree: how an untick tells the box it filled from one the person edited
const amendHeadMessage = new Map<string, string>();

// Amend loads HEAD's message into the box; unticking it empties the box again unless the person has edited what it loaded.
export async function setAmend(cwd: string, on: boolean): Promise<void> {
    if (!on) {
        const draft = globalStore.get(commitDraftAtom)[cwd] ?? "";
        const head = amendHeadMessage.get(cwd);
        amendHeadMessage.delete(cwd);
        put(commitAmendAtom, cwd, false);
        if (head != null && draft.trim() === head) {
            setDraft(cwd, "");
        }
        return;
    }
    put(commitAmendAtom, cwd, true);
    try {
        const r = await RpcApi.GitCommitMessageCommand(TabRpcClient, { cwd, ref: "" });
        if (!globalStore.get(commitAmendAtom)[cwd]) {
            return; // unticked while the message was being read
        }
        const head = r.message.trim();
        amendHeadMessage.set(cwd, head);
        setDraft(cwd, head);
    } catch {
        put(commitAmendAtom, cwd, false);
        put(commitRunAtom, cwd, {
            running: false,
            failure: { command: "git log -1", exitcode: -1, stderr: "HEAD's message could not be read" },
        });
    }
}

// Opens a commit in the Log tab, selected with its first file open. `hash` is the full sha the history rows are keyed by.
function showInLog(cwd: string, hash: string): void {
    globalStore.set(panelTabAtom, "log");
    globalStore.set(panelFoldedAtom, false);
    void selectCommit(cwd, hash);
}

// The commit. A refusal (a hook, a lock, nothing to commit) arrives as data and leaves the message and the ticks where they
// were, so fixing the cause and pressing the button again is the whole recovery. The client budget sits past gitinfo's own
// 60s, so git's answer arrives before the call is cancelled underneath it.
export async function commitNow(cwd: string): Promise<void> {
    const entry = globalStore.get(commitListAtom)[cwd];
    const files = entry?.changes.files ?? [];
    const ticks = globalStore.get(commitTicksAtom)[cwd] ?? NO_TICKS;
    const message = globalStore.get(commitDraftAtom)[cwd] ?? "";
    const amend = globalStore.get(commitAmendAtom)[cwd] === true;
    const n = tickedCount(ticks, files);
    if (entry == null || commitRunOf(globalStore.get(commitRunAtom), cwd).running || !canCommit(message, n)) {
        return;
    }
    if (amend && !amendAllowed(entry)) {
        put(commitRunAtom, cwd, {
            running: false,
            failure: {
                command: "git commit --amend",
                exitcode: -1,
                stderr: "HEAD is already pushed: amending would need a force push",
            },
        });
        return;
    }
    put(commitRunAtom, cwd, { running: true, failure: null });
    try {
        const r = await RpcApi.GitCommitCommand(
            TabRpcClient,
            { cwd, message, paths: tickedPaths(ticks, files), ...(amend ? { amend: true } : {}) },
            { timeout: 65000 }
        );
        if (r.failure != null || !r.hash) {
            put(commitRunAtom, cwd, {
                running: false,
                failure: r.failure ?? { command: "git commit", exitcode: -1, stderr: "git reported no commit" },
            });
            return;
        }
        const short = r.hash;
        amendHeadMessage.delete(cwd);
        put(commitDraftAtom, cwd, "");
        put(commitAmendAtom, cwd, false);
        put(commitTicksAtom, cwd, NO_TICKS);
        put(commitRunAtom, cwd, IDLE);
        await loadCommitList(cwd);
        await reloadChanges(cwd);
        refreshHistory();
        // the history rows are keyed by the full sha, and the commit just made is HEAD in the list just read
        const head = globalStore.get(commitListAtom)[cwd]?.head ?? "";
        const full = head.startsWith(short) ? head : short;
        pushToast({
            title: `Committed ${short}`,
            message: `${n} ${n === 1 ? "file" : "files"}`,
            level: "info",
            onOpen: () => showInLog(cwd, full),
        });
    } catch {
        put(commitRunAtom, cwd, {
            running: false,
            failure: { command: "git commit", exitcode: -1, stderr: "the commit did not complete" },
        });
    }
}

export function dismissCommitFailure(cwd: string): void {
    put(commitRunAtom, cwd, IDLE);
}

declare global {
    interface Window {
        // DEV: the agents "running here", by name, in place of the ones computed from the roster. The CDP scenarios need an
        // agent working in a temp repo, and the live roster has none.
        __syncWorkingAgents?: string[];
    }
}

// The agents a commit or a pull here would share the worktree with (syncstate.ts finds them); the DEV override replaces them.
export function workingAgents(
    cwd: string,
    agents: { id: string; name: string; state: string }[],
    agentCwds: Record<string, string | null>
): string[] {
    if (import.meta.env.DEV && typeof window !== "undefined" && window.__syncWorkingAgents != null) {
        return window.__syncWorkingAgents;
    }
    return agentsWorkingIn(cwd, agents, agentCwds);
}
