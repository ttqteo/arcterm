// frontend/app/view/code/codestore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Code-surface state + loaders. Every atom is module-scoped for the same reason filesstore.ts does
// it: the surface unmounts on nav switch, so component state would silently drop the whole session
// (selected project, expanded tree, history) every time you looked at something else.

import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { parseGitChanges } from "@/app/view/agents/gitstatus";
import { buildProjectList, projectsAtom } from "@/app/view/agents/projectsstore";
import { joinRepoPath, repoBasename, sameRepoPath } from "@/util/paths";
import { base64ToString, fireAndForget, stringToBase64 } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { debounce } from "throttle-debounce";
import { classifyFile, hasNulByte, MAX_VIEW_BYTES } from "./codeclassify";
import {
    conflictMessage,
    conflictOf,
    nextDrafts,
    parseStoredDrafts,
    renameDraftKeys,
    storedDraftsJson,
    withoutDraft,
    type Draft,
    type FileBase,
} from "./codedraft";
import {
    back,
    canBack,
    canForward,
    currentEntry,
    EMPTY_HISTORY,
    forward,
    push,
    withLine,
    type History,
} from "./codehistory";
import { deleteWarning, renamedPath, targetDir } from "./codemutate";
import { cleanPathInput, pathErrorMessage, statPathError, validatePathInput } from "./codepathinput";
import { pruneRecent, pushRecent } from "./coderecents";
import { resetSearch } from "./codesearchstore";
import { changedDirs, statusByPath, type CodeStatus } from "./codestatus";
import { ancestorsOf, buildTree, visibleRows } from "./codetree";

export interface CodeProject {
    name: string;
    path: string;
}

export interface CodeIndex {
    paths: string[];
    isRepo: boolean;
    truncated: boolean;
}

// One union rather than parallel loading/error/tooLarge booleans, so the viewer renders an
// exhaustive switch and cannot land in a contradictory pair of states. Only the text variant is
// editable, and it carries the size/modtime it was read at so a save can detect a disk change.
export type CodeFile =
    | { kind: "none" }
    | { kind: "loading"; path: string }
    | { kind: "text"; path: string; text: string; size: number; modtime: number }
    | { kind: "binary"; path: string; size: number }
    | { kind: "toolarge"; path: string; size: number }
    | { kind: "missing"; path: string }
    | { kind: "error"; path: string; message: string };

// Save is a separate axis from CodeFile: the file can be a perfectly good text buffer while the last
// write is still in flight, or refused, or failed.
export type SaveState =
    | { kind: "idle" }
    | { kind: "saving"; path: string }
    | { kind: "saved"; path: string }
    | { kind: "conflict"; path: string; message: string }
    | { kind: "error"; path: string; message: string };

export const codeProjectAtom = atom<CodeProject | null>(null) as PrimitiveAtom<CodeProject | null>;
// The last browsed project, persisted across launches so a restart lands on the same repo the way a
// nav switch already does. getOnInit: without it the stored value arrives one render after the first
// read, so the surface flashes "No project selected" before the restore lands. Only a real selection
// writes it — never the null reset.
export const lastCodeProjectAtom = atomWithStorage<CodeProject | null>("code.project.last", null, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<CodeProject | null>;
export const codeIndexAtom = atom<CodeIndex | null>(null) as PrimitiveAtom<CodeIndex | null>;
export const codeIndexErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const codeExpandedAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;
export const codeFileAtom = atom<CodeFile>({ kind: "none" }) as PrimitiveAtom<CodeFile>;
export const codeHistoryAtom = atom<History>(EMPTY_HISTORY) as PrimitiveAtom<History>;
// every checkout of the selected project's repository, main first; empty until loaded
export const codeWorktreesAtom = atom<GitWorktree[]>([]) as PrimitiveAtom<GitWorktree[]>;
// persisted, so a worktree or a directory reached by path stays one click away after a restart
export const codeRecentsAtom = atomWithStorage<CodeProject[]>("code.project.recents", [], undefined, {
    getOnInit: true,
}) as PrimitiveAtom<CodeProject[]>;
export const codePickerErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
const DRAFTS_STORAGE_KEY = "code.drafts";
// JSON characters: a conservative slice of the origin's localStorage quota, which the rest of the app
// shares. A draft that does not fit stays in memory only.
const DRAFTS_STORAGE_BUDGET = 2_000_000;
// a keystroke must not re-serialize every draft, so the write trails the typing
const DRAFTS_PERSIST_MS = 500;

function readStoredDrafts(): Map<string, Draft> {
    try {
        return parseStoredDrafts(window.localStorage.getItem(DRAFTS_STORAGE_KEY));
    } catch {
        return new Map<string, Draft>(); // no localStorage: a restricted webview, or vitest's node
    }
}

function writeStoredDrafts(drafts: Map<string, Draft>): void {
    try {
        window.localStorage.setItem(DRAFTS_STORAGE_KEY, storedDraftsJson(drafts, DRAFTS_STORAGE_BUDGET));
    } catch (e) {
        console.warn("[code] unsaved drafts were not persisted", e);
        // an older copy left behind would resurrect edits that have since been saved or reverted
        try {
            window.localStorage.removeItem(DRAFTS_STORAGE_KEY);
        } catch {
            // no storage at all, so there is no stale copy either
        }
    }
}

// Unsaved edits, keyed by ABSOLUTE path so two projects cannot collide, and deliberately not cleared
// on project switch — losing typed-but-unsaved work to a nav click would be the worst kind of bug.
// Persisted for the same reason, since a reload lost them just as surely. A restored draft keeps its
// pinned base, so a file that changed on disk in the meantime still refuses to save over.
export const codeDraftsAtom = atom<Map<string, Draft>>(readStoredDrafts()) as PrimitiveAtom<Map<string, Draft>>;
const persistDraftsSoon = debounce(DRAFTS_PERSIST_MS, () => writeStoredDrafts(globalStore.get(codeDraftsAtom)));
globalStore.sub(codeDraftsAtom, persistDraftsSoon);
// a reload inside the debounce window would otherwise drop the last burst of typing
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
        persistDraftsSoon.cancel();
        writeStoredDrafts(globalStore.get(codeDraftsAtom));
    });
}
export const codeSaveAtom = atom<SaveState>({ kind: "idle" }) as PrimitiveAtom<SaveState>;

// The tree's highlighted row — a file OR a directory. Deliberately separate from codeFileAtom: the
// cursor used to BE the open file, which is why the cursor could never rest on a directory.
export const codeCursorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// A line a jump wants revealed once the file's text is in place. The store never touches Monaco;
// codeviewer.tsx consumes this and clears it.
export const codePendingLineAtom = atom<number | null>(null) as PrimitiveAtom<number | null>;
// The viewer lends the store a reader for the caret's line, which history records as an entry is left.
// A reader rather than an atom: the caret moves on every keystroke and nothing needs to re-render.
let readCaretLine: () => number | null = () => null;
export function setCaretLineReader(read: () => number | null): void {
    readCaretLine = read;
}
// Whether the tree pane holds focus. An atom rather than a document.activeElement query because the
// keybinding `when` predicates are evaluated by store.test.ts in vitest's node environment, where
// there is no document — and because this codebase keeps DOM reads in `run`, never in `when`.
export const codeTreeFocusedAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

// Markdown files render as documents by default; Source switches to the editable Monaco view, and
// Diff shows the file against HEAD without leaving the editor. Ignored for non-markdown files,
// which are never Preview. Reset on project switch, but not on file switch — a reader who prefers
// source stays in source across files.
export const codeViewModeAtom = atom<"preview" | "source" | "diff">("preview") as PrimitiveAtom<
    "preview" | "source" | "diff"
>;

// The left-hand side of the diff. One union rather than parallel booleans, for the same reason
// CodeFile is one: the pane renders an exhaustive switch and cannot land in a contradictory pair.
export type HeadText =
    | { kind: "idle" }
    | { kind: "loading"; path: string }
    | { kind: "text"; path: string; text: string }
    | { kind: "absent"; path: string } // the file is new since HEAD, so the whole file reads as added
    | { kind: "error"; path: string; message: string };

export const codeHeadAtom = atom<HeadText>({ kind: "idle" }) as PrimitiveAtom<HeadText>;

// Set when the open file's bytes moved on disk since we read them. Never auto-reloads: the caret,
// the scroll offset and the selection would jump under a reader's eyes with no action of theirs.
export const codeStaleAtom = atom<{ path: string } | null>(null) as PrimitiveAtom<{ path: string } | null>;

// A mutation is a user-initiated action, so its failure gets a banner rather than a silent no-op.
export const codeMutateErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// The inline name input's whole state. There is no modal for create or rename: a modal to type
// eleven characters is friction, and the inline row shows WHERE the thing will land.
export type CodeEdit = { kind: "rename"; path: string } | { kind: "create"; dir: string; isDir: boolean } | null;
export const codeEditAtom = atom<CodeEdit>(null) as PrimitiveAtom<CodeEdit>;

// Working-tree status, keyed by repo-relative path. null = not loaded yet, which is a different
// thing from an empty map (a clean tree) and different again from a failed read.
export const codeStatusAtom = atom<Map<string, CodeStatus> | null>(null) as PrimitiveAtom<Map<
    string,
    CodeStatus
> | null>;
export const codeStatusErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// the collapsed-row marker: does anything under this directory have a status
export const codeStatusDirsAtom = atom((get) => changedDirs(get(codeStatusAtom)?.keys() ?? []));

// The rendered row list. Derived rather than memoized inside the pane, because the keyboard bindings
// have to agree with the pane about which rows exist and cannot see a component's useMemo.
export const codeRowsAtom = atom((get) =>
    visibleRows(buildTree(get(codeIndexAtom)?.paths ?? []), get(codeExpandedAtom))
);

// the absolute path is the draft key; every draft-facing helper goes through this
export function draftKey(project: CodeProject, rel: string): string {
    return joinRepoPath(project.path, rel);
}

// Returning to a project you already browsed should not re-shell out to git. Cleared per project
// by refreshIndex, which is the only way a new file appears (there is no watcher, by design).
const indexCache = new Map<string, CodeIndex>();

// guards a slow load against a newer one, same pattern as filesstore.ts
const current = { indexToken: "", fileToken: "", statusToken: "", headToken: "", worktreesToken: "" };

export async function selectProject(p: CodeProject | null): Promise<void> {
    globalStore.set(codeProjectAtom, p);
    // only a real selection is worth remembering; the null reset must not clobber the last good one
    if (p != null) {
        globalStore.set(lastCodeProjectAtom, p);
    }
    globalStore.set(codeExpandedAtom, new Set<string>());
    globalStore.set(codeHistoryAtom, EMPTY_HISTORY);
    globalStore.set(codeFileAtom, { kind: "none" });
    globalStore.set(codeIndexErrorAtom, null);
    globalStore.set(codeIndexAtom, null);
    globalStore.set(codeSaveAtom, { kind: "idle" });
    globalStore.set(codeCursorAtom, null);
    globalStore.set(codePendingLineAtom, null);
    globalStore.set(codeViewModeAtom, "preview");
    globalStore.set(codeStatusAtom, null);
    globalStore.set(codeStatusErrorAtom, null);
    globalStore.set(codeHeadAtom, { kind: "idle" });
    globalStore.set(codeStaleAtom, null);
    globalStore.set(codeWorktreesAtom, []);
    resetSearch(); // results belong to the repository they were found in
    // drafts survive on purpose — they are keyed by absolute path, so coming back to this project
    // brings your unsaved edits back with it
    if (p == null) {
        current.indexToken = "";
        return;
    }
    globalStore.set(codeRecentsAtom, pushRecent(globalStore.get(codeRecentsAtom), p));
    await loadIndex(p);
}

// A stored selection restores only while the registry still knows its path — a project that was
// renamed or removed must not silently reopen under a stale path (same rule as jarvis.subject.last).
export function canRestoreProject(stored: CodeProject | null, registry: Record<string, ProjectKeywords>): boolean {
    if (stored == null) {
        return false;
    }
    for (const v of Object.values(registry ?? {})) {
        if (v?.path != null && sameRepoPath(v.path, stored.path)) {
            return true;
        }
    }
    return false;
}

export type CodeBodyPhase = "no-projects" | "no-project" | "error" | "loading" | "not-repo" | "ready";

// What CodeBody shows. A stored project the restore effect is about to reopen is "loading": that effect
// runs after the first paint, and "No project selected" there is a false claim. More states than LoadPhase
// has, so this is Code's own union.
export function codeBodyPhase(p: {
    registry: Record<string, ProjectKeywords> | undefined;
    project: CodeProject | null;
    stored: CodeProject | null;
    index: CodeIndex | null;
    indexError: string | null;
}): CodeBodyPhase {
    if (Object.keys(p.registry ?? {}).length === 0) {
        return "no-projects";
    }
    if (p.project == null) {
        return canRestoreProject(p.stored, p.registry ?? {}) ? "loading" : "no-project";
    }
    if (p.indexError != null) {
        return "error";
    }
    if (p.index == null) {
        return "loading";
    }
    return p.index.isRepo ? "ready" : "not-repo";
}

// Code's view of the one project list: name and path only, because a pick is persisted (lastCodeProjectAtom)
export function registeredProjects(registry: Record<string, ProjectKeywords> | undefined): CodeProject[] {
    return buildProjectList(registry, null).map(({ name, path }) => ({ name, path }));
}

// Any project's file list, through the same cache Code browses with: the universal search's Files scope
// lists the active project's files off Code, and a later visit to Code then starts warm.
export async function loadFileIndex(path: string): Promise<CodeIndex> {
    const cached = indexCache.get(path);
    if (cached != null) {
        return cached;
    }
    const res = await RpcApi.GitListFilesCommand(TabRpcClient, { cwd: path });
    const idx: CodeIndex = { paths: res.files ?? [], isRepo: res.isrepo, truncated: res.truncated ?? false };
    indexCache.set(path, idx);
    return idx;
}

async function loadIndex(p: CodeProject): Promise<void> {
    const token = `index:${p.path}`;
    current.indexToken = token;
    void loadStatus(); // independent of ls-files, so it runs alongside rather than after
    void loadWorktrees();
    const cached = indexCache.get(p.path);
    if (cached != null) {
        globalStore.set(codeIndexAtom, cached);
        return;
    }
    try {
        const idx = await loadFileIndex(p.path);
        if (current.indexToken !== token) {
            return;
        }
        globalStore.set(codeIndexAtom, idx);
    } catch (e) {
        if (current.indexToken !== token) {
            return;
        }
        // a failed RPC is an error, not an empty repo — the Diff surface once conflated these
        globalStore.set(codeIndexErrorAtom, e instanceof Error ? e.message : String(e));
    }
}

export async function refreshIndex(): Promise<void> {
    const p = globalStore.get(codeProjectAtom);
    if (p == null) {
        return;
    }
    indexCache.delete(p.path);
    globalStore.set(codeIndexAtom, null);
    globalStore.set(codeIndexErrorAtom, null);
    await loadIndex(p);
}

// Returning to the surface is the other moment the cache is stale — an agent wrote while Code was
// off-screen — but unlike the explicit refresh this one must not blank the tree: the index already on
// screen stays until the refetch lands. Guarded against pile-up, since nav switching is a keystroke.
let revalidating = false;

export async function revalidateIndex(): Promise<void> {
    const p = globalStore.get(codeProjectAtom);
    if (p == null || revalidating) {
        return;
    }
    revalidating = true;
    try {
        indexCache.delete(p.path);
        globalStore.set(codeIndexErrorAtom, null);
        await loadIndex(p); // refetches ls-files and, alongside it, git status
    } finally {
        revalidating = false;
    }
}

// Status is decoration over the rows, so a failure degrades rather than blocks: the tree still
// renders, the Changed column says why it is empty, and the retry is one click.
export async function loadStatus(): Promise<void> {
    const p = globalStore.get(codeProjectAtom);
    if (p == null) {
        return;
    }
    const token = `status:${p.path}`;
    current.statusToken = token;
    try {
        const res = await RpcApi.GitChangesCommand(TabRpcClient, { cwd: p.path });
        if (current.statusToken !== token) {
            return;
        }
        globalStore.set(codeStatusAtom, statusByPath(parseGitChanges(res?.statusz ?? "", res?.numstat ?? "")));
        globalStore.set(codeStatusErrorAtom, null);
    } catch (e) {
        if (current.statusToken !== token) {
            return;
        }
        globalStore.set(codeStatusAtom, null);
        globalStore.set(codeStatusErrorAtom, e instanceof Error ? e.message : String(e));
    }
}

// The picker lists these. It is not something the surface depends on, so a failure leaves the list
// empty instead of raising a banner.
async function loadWorktrees(): Promise<void> {
    const p = globalStore.get(codeProjectAtom);
    if (p == null) {
        return;
    }
    const token = `worktrees:${p.path}`;
    current.worktreesToken = token;
    try {
        const res = await RpcApi.GitListWorktreesCommand(TabRpcClient, { cwd: p.path });
        if (current.worktreesToken === token) {
            globalStore.set(codeWorktreesAtom, res?.worktrees ?? []);
        }
    } catch (e) {
        console.error("listing worktrees failed", p.path, e);
        if (current.worktreesToken === token) {
            globalStore.set(codeWorktreesAtom, []);
        }
    }
}

// Binary and too-large are answers rather than failures, but from the diff's point of view both
// mean the same thing — there is nothing to render on the left — so they land in `error` with an
// honest message rather than earning their own variants.
export async function loadHead(rel: string): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    if (project == null) {
        return;
    }
    const token = `head:${rel}`;
    current.headToken = token;
    globalStore.set(codeHeadAtom, { kind: "loading", path: rel });
    try {
        const res = await RpcApi.GitFileAtRefCommand(TabRpcClient, {
            cwd: project.path,
            ref: "HEAD",
            path: rel,
            maxbytes: MAX_VIEW_BYTES,
        });
        if (current.headToken !== token) {
            return;
        }
        if (res?.missing) {
            globalStore.set(codeHeadAtom, { kind: "absent", path: rel });
            return;
        }
        if (res?.binary) {
            globalStore.set(codeHeadAtom, {
                kind: "error",
                path: rel,
                message: "The committed copy is a binary blob.",
            });
            return;
        }
        if (res?.toolarge) {
            globalStore.set(codeHeadAtom, {
                kind: "error",
                path: rel,
                message: "The committed copy is larger than the 2 MB view limit.",
            });
            return;
        }
        globalStore.set(codeHeadAtom, { kind: "text", path: rel, text: res?.content ?? "" });
    } catch (e) {
        if (current.headToken !== token) {
            return;
        }
        globalStore.set(codeHeadAtom, {
            kind: "error",
            path: rel,
            message: e instanceof Error ? e.message : String(e),
        });
    }
}

// A re-stat of the ONE open file, on window focus and on tree focus. No watcher, by design: a
// watcher means a backend subscription, debouncing, and reconciling against expand state, to catch
// the same case this catches — an agent wrote while you were looking at another window.
export async function checkStale(): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return;
    }
    const abs = draftKey(project, file.path);
    const draft = globalStore.get(codeDraftsAtom).get(abs);
    // with a draft, the pinned base is the truth about what we last read; without one, the buffer's
    // own size/modtime is
    const base: FileBase = draft?.base ?? { text: file.text, size: file.size, modtime: file.modtime };
    try {
        const latest = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        const now = globalStore.get(codeFileAtom);
        if (now.kind !== "text" || now.path !== file.path) {
            return; // the open file changed under a slow stat; only speak for the file we statted
        }
        globalStore.set(codeStaleAtom, conflictOf(base, latest) === "none" ? null : { path: file.path });
    } catch {
        // a failed stat is not evidence of a change, and crying wolf is worse than staying quiet
    }
}

export function startCreate(isDir: boolean): void {
    const dir = targetDir(globalStore.get(codeCursorAtom), globalStore.get(codeRowsAtom));
    if (dir !== "") {
        // the provisional row is the target directory's first child, so that directory has to be open
        const expanded = new Set(globalStore.get(codeExpandedAtom));
        for (const a of ancestorsOf(`${dir}/x`)) {
            expanded.add(a);
        }
        expanded.add(dir);
        globalStore.set(codeExpandedAtom, expanded);
    }
    globalStore.set(codeEditAtom, { kind: "create", dir, isDir });
}

export function startRename(path: string): void {
    globalStore.set(codeEditAtom, { kind: "rename", path });
}

export function cancelEdit(): void {
    globalStore.set(codeEditAtom, null);
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// Every mutation is RPC -> refreshIndex(), and refreshIndex reloads status too (see loadIndex).
// Nothing optimistically patches the tree: splicing a path into a cached array and hoping git
// agrees is exactly the drift the single-row-list rule exists to prevent. The index is refreshed
// even when the RPC failed, so the tree shows what is actually there rather than what we intended.
export async function createEntry(dir: string, name: string, isDir: boolean): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    if (project == null) {
        return;
    }
    const rel = dir === "" ? name : `${dir}/${name}`;
    const abs = joinRepoPath(project.path, rel);
    globalStore.set(codeMutateErrorAtom, null);
    globalStore.set(codeEditAtom, null);
    let ok = true;
    try {
        if (isDir) {
            await RpcApi.FileMkdirCommand(TabRpcClient, { info: { path: abs } });
        } else {
            await RpcApi.FileCreateCommand(TabRpcClient, { info: { path: abs } });
        }
    } catch (e) {
        ok = false;
        globalStore.set(codeMutateErrorAtom, `Could not create ${rel}: ${errorText(e)}`);
    }
    await refreshIndex();
    if (!ok) {
        return;
    }
    revealPath(rel);
    globalStore.set(codeCursorAtom, rel);
    if (!isDir) {
        // an empty directory is not in `git ls-files` output at all, so only a file has a row to open
        await openPath(rel);
    }
}

// Renaming the file you are reading and landing on a `missing` empty state would be a bug wearing a
// feature's clothes, so the open buffer, the cursor, the drafts and the history all come along.
export async function renamePath(rel: string, newName: string): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    if (project == null) {
        return;
    }
    const cut = rel.lastIndexOf("/");
    const next = cut === -1 ? newName : `${rel.slice(0, cut)}/${newName}`;
    globalStore.set(codeEditAtom, null);
    if (next === rel) {
        return;
    }
    globalStore.set(codeMutateErrorAtom, null);
    let ok = true;
    try {
        await RpcApi.FileMoveCommand(TabRpcClient, {
            srcuri: joinRepoPath(project.path, rel),
            desturi: joinRepoPath(project.path, next),
            opts: { recursive: true },
        });
    } catch (e) {
        ok = false;
        globalStore.set(codeMutateErrorAtom, `Could not rename ${rel}: ${errorText(e)}`);
    }
    if (ok) {
        carryRename(project, rel, next);
    }
    await refreshIndex();
}

function carryRename(project: CodeProject, rel: string, next: string): void {
    globalStore.set(codeDraftsAtom, (d) => renameDraftKeys(d, draftKey(project, rel), draftKey(project, next)));

    const file = globalStore.get(codeFileAtom);
    if (file.kind !== "none") {
        const p = renamedPath(file.path, rel, next);
        if (p !== file.path) {
            globalStore.set(codeFileAtom, { ...file, path: p });
        }
    }
    const cursor = globalStore.get(codeCursorAtom);
    if (cursor != null) {
        globalStore.set(codeCursorAtom, renamedPath(cursor, rel, next));
    }
    globalStore.set(codeHistoryAtom, (h) => ({
        stack: h.stack.map((e) => ({ ...e, path: renamedPath(e.path, rel, next) })),
        idx: h.idx,
    }));
    revealPath(next);
}

// FileDeleteCommand is a hard delete — no recycle bin, no trash, and deliberately no undo stack
// (holding deleted bytes in memory would be a second source of truth for a file's content). The
// confirm carries the recoverability instead; see confirmDelete.
export async function deletePath(rel: string, isDir: boolean): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    if (project == null) {
        return;
    }
    globalStore.set(codeMutateErrorAtom, null);
    try {
        await RpcApi.FileDeleteCommand(TabRpcClient, {
            path: joinRepoPath(project.path, rel),
            recursive: isDir,
        });
    } catch (e) {
        globalStore.set(codeMutateErrorAtom, `Could not delete ${rel}: ${errorText(e)}`);
    }
    const file = globalStore.get(codeFileAtom);
    if (file.kind !== "none" && underOrEqual(file.path, rel)) {
        // the buffer's file is gone; the DRAFT is not touched — it is keyed by absolute path and
        // throwing typed text away is never automatic here
        globalStore.set(codeFileAtom, { kind: "none" });
        globalStore.set(codeCursorAtom, null);
    }
    await refreshIndex();
}

function underOrEqual(path: string, dir: string): boolean {
    return path === dir || path.startsWith(`${dir}/`);
}

// Shared by the tree context menu and the Delete keybinding, the way memstore's confirmDeleteNote
// is shared by its list menu and its detail pane.
export function confirmDelete(rel: string, isDir: boolean): void {
    const paths = globalStore.get(codeIndexAtom)?.paths ?? [];
    const status = globalStore.get(codeStatusAtom);
    const under = isDir ? paths.filter((p) => p.startsWith(`${rel}/`)) : [rel];
    modalsModel.pushModal("ConfirmModal", {
        title: isDir ? "Delete folder" : "Delete file",
        message: deleteWarning(
            rel,
            under.map((p) => status?.get(p)),
            isDir
        ),
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => fireAndForget(() => deletePath(rel, isDir)),
    });
}

export function toggleDir(path: string): void {
    const next = new Set(globalStore.get(codeExpandedAtom));
    if (next.has(path)) {
        next.delete(path);
    } else {
        next.add(path);
    }
    globalStore.set(codeExpandedAtom, next);
}

// expand everything above `path` so a finder jump into a collapsed subtree shows where you landed
export function revealPath(path: string): void {
    const next = new Set(globalStore.get(codeExpandedAtom));
    for (const dir of ancestorsOf(path)) {
        next.add(dir);
    }
    globalStore.set(codeExpandedAtom, next);
}

export async function openPath(rel: string, opts?: { pushHistory?: boolean; line?: number | null }): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    if (project == null) {
        return;
    }
    if (opts?.pushHistory !== false) {
        globalStore.set(codeHistoryAtom, (h) => push(withLine(h, readCaretLine()), rel, opts?.line ?? null));
    }
    const token = `file:${rel}`;
    current.fileToken = token;
    globalStore.set(codeSaveAtom, { kind: "idle" });
    globalStore.set(codeStaleAtom, null);
    const abs = joinRepoPath(project.path, rel);

    // A file you have unsaved edits in is restored from its pinned base rather than re-read. Re-reading
    // would silently re-point the base at whatever is on disk NOW, which is exactly the state the
    // conflict guard exists to notice — a reopen would launder someone else's write into "no conflict".
    const draft = globalStore.get(codeDraftsAtom).get(abs);
    if (draft != null) {
        globalStore.set(codeFileAtom, {
            kind: "text",
            path: rel,
            text: draft.base.text,
            size: draft.base.size,
            modtime: draft.base.modtime,
        });
        return;
    }

    globalStore.set(codeFileAtom, { kind: "loading", path: rel });
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        if (current.fileToken !== token) {
            return;
        }
        if (info?.notfound) {
            // the index is a snapshot; this is the visible consequence of having no watcher
            globalStore.set(codeFileAtom, { kind: "missing", path: rel });
            return;
        }
        const size = info?.size ?? 0;
        const klass = classifyFile(size, info?.mimetype ?? "");
        if (klass === "toolarge") {
            globalStore.set(codeFileAtom, { kind: "toolarge", path: rel, size });
            return;
        }
        if (klass === "binary") {
            globalStore.set(codeFileAtom, { kind: "binary", path: rel, size });
            return;
        }
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: abs } });
        if (current.fileToken !== token) {
            return;
        }
        const text = base64ToString(data?.data64 ?? "");
        if (hasNulByte(text)) {
            globalStore.set(codeFileAtom, { kind: "binary", path: rel, size });
            return;
        }
        globalStore.set(codeFileAtom, { kind: "text", path: rel, text, size, modtime: info?.modtime ?? 0 });
    } catch (e) {
        if (current.fileToken !== token) {
            return;
        }
        globalStore.set(codeFileAtom, {
            kind: "error",
            path: rel,
            message: e instanceof Error ? e.message : String(e),
        });
    }
}

export function editDraft(text: string): void {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return; // binary/toolarge/missing are not editable, so there is nothing to draft
    }
    const key = draftKey(project, file.path);
    const base: FileBase = { text: file.text, size: file.size, modtime: file.modtime };
    globalStore.set(codeDraftsAtom, (d) => nextDrafts(d, key, base, text));
    // a fresh keystroke invalidates whatever the last save attempt said
    const save = globalStore.get(codeSaveAtom);
    if (save.kind !== "idle" && save.path === file.path) {
        globalStore.set(codeSaveAtom, { kind: "idle" });
    }
}

export function revertDraft(): void {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return;
    }
    globalStore.set(codeDraftsAtom, (d) => withoutDraft(d, draftKey(project, file.path)));
    globalStore.set(codeSaveAtom, { kind: "idle" });
}

// Stat, compare against the base the draft pinned, and only then write. The stat is not belt-and-
// braces: agents run against this same working tree, so "changed since you opened it" is the normal
// case, not the exotic one. On conflict we refuse and keep the draft — the user's text is never the
// thing we throw away.
export async function saveCurrent(): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return;
    }
    const rel = file.path;
    const abs = draftKey(project, rel);
    const draft = globalStore.get(codeDraftsAtom).get(abs);
    if (draft == null) {
        return; // nothing unsaved
    }
    globalStore.set(codeSaveAtom, { kind: "saving", path: rel });
    try {
        const latest = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        const conflict = conflictOf(draft.base, latest);
        if (conflict !== "none") {
            globalStore.set(codeSaveAtom, { kind: "conflict", path: rel, message: conflictMessage(conflict) });
            return;
        }
        await RpcApi.FileWriteCommand(TabRpcClient, { info: { path: abs }, data64: stringToBase64(draft.text) });
        // re-stat so a second save compares against what we just wrote rather than the pre-save state
        const after = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        globalStore.set(codeFileAtom, {
            kind: "text",
            path: rel,
            text: draft.text,
            size: after?.size ?? draft.text.length,
            modtime: after?.modtime ?? 0,
        });
        globalStore.set(codeDraftsAtom, (d) => withoutDraft(d, abs));
        globalStore.set(codeSaveAtom, { kind: "saved", path: rel });
        void loadStatus(); // a write is exactly what turns an unchanged file into a modified one
        globalStore.set(codeStaleAtom, null); // we just wrote it, so the disk copy is ours again
    } catch (e) {
        globalStore.set(codeSaveAtom, {
            kind: "error",
            path: rel,
            message: e instanceof Error ? e.message : String(e),
        });
    }
}

// Discard the pinned base and take what is on disk now, abandoning the draft. The escape hatch from a
// conflict, and the only path that intentionally destroys typed text — so it is never automatic.
export async function reloadFromDisk(): Promise<void> {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return;
    }
    globalStore.set(codeDraftsAtom, (d) => withoutDraft(d, draftKey(project, file.path)));
    globalStore.set(codeSaveAtom, { kind: "idle" });
    await openPath(file.path, { pushHistory: false });
}

// back/forward re-read from disk rather than replaying cached text: simpler, and it shows the file
// as it is now rather than as it was when you first opened it. The entry's line rides the same
// pending-line reveal a jump uses.
export async function goBack(): Promise<void> {
    const h = globalStore.get(codeHistoryAtom);
    if (canBack(h)) {
        await walkTo(back(withLine(h, readCaretLine())));
    }
}

export async function goForward(): Promise<void> {
    const h = globalStore.get(codeHistoryAtom);
    if (canForward(h)) {
        await walkTo(forward(withLine(h, readCaretLine())));
    }
}

async function walkTo(h: History): Promise<void> {
    globalStore.set(codeHistoryAtom, h);
    const entry = currentEntry(h);
    if (entry == null) {
        return;
    }
    globalStore.set(codePendingLineAtom, entry.line);
    await openPath(entry.path, { pushHistory: false });
}

// The one way into this surface from anywhere else: a content-search hit, a diff row, a Radar
// finding, a finder query with a line. Takes the view model because surfaceAtom lives on the
// AgentsViewModel instance rather than in a module — the same type-only seam bindings.ts uses.
// reach a directory by path, under its registered name when it has one
export async function selectPath(path: string): Promise<void> {
    await selectProject(resolveJumpProject(path));
}

// A typed path or a Recent row: either can name something that is not a directory (or no longer
// exists), so it is checked before the selection changes. Resolves false with the reason in
// codePickerErrorAtom; a gone directory also leaves the Recent list here.
export async function openPickedPath(raw: string): Promise<boolean> {
    const path = cleanPathInput(raw);
    let error = validatePathInput(path);
    if (error == null) {
        try {
            error = statPathError(await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } }));
        } catch (e) {
            globalStore.set(
                codePickerErrorAtom,
                `Could not read ${path}: ${e instanceof Error ? e.message : String(e)}`
            );
            return false;
        }
    }
    if (error != null) {
        if (error === "notfound") {
            globalStore.set(codeRecentsAtom, pruneRecent(globalStore.get(codeRecentsAtom), path));
        }
        globalStore.set(codePickerErrorAtom, pathErrorMessage(error, path));
        return false;
    }
    globalStore.set(codePickerErrorAtom, null);
    await selectPath(path);
    return true;
}

export async function openInCode(
    model: AgentsViewModel,
    target: { projectPath: string; rel: string; line?: number }
): Promise<void> {
    const project = resolveJumpProject(target.projectPath);
    const cur = globalStore.get(codeProjectAtom);
    // switching resets expand state, history and the file; a jump within the repository you are
    // already reading must not throw that away
    if (cur == null || !sameRepoPath(cur.path, project.path)) {
        await selectProject(project);
    }
    revealPath(target.rel);
    globalStore.set(codeCursorAtom, target.rel);
    // set before the read: the viewer honors this the moment the text lands
    globalStore.set(codePendingLineAtom, target.line ?? null);
    globalStore.set(model.surfaceAtom, "code");
    await openPath(target.rel, { line: target.line ?? null });
}

function resolveJumpProject(projectPath: string): CodeProject {
    const registry = globalStore.get(projectsAtom) ?? {};
    for (const [name, v] of Object.entries(registry)) {
        if (v?.path && sameRepoPath(v.path, projectPath)) {
            return { name, path: v.path };
        }
    }
    // launchAgent creates worktrees, so a diff's cwd is frequently a repository the registry does
    // not know. git ls-files needs only a path, so browse it under its directory name rather than
    // refusing the jump — the header shows the full path, so nothing is hidden.
    return { name: repoBasename(projectPath), path: projectPath };
}
