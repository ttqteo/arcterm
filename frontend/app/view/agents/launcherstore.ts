// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's state (docs/superpowers/specs/2026-10-08-new-launcher-design.md, "Open, close and draft"). The
// dialog renders its body only while open, so what a close must keep lives here: the pick, the project and everything
// typed. In memory only, as New agent's state was: a draft outlives a close and a surface switch, not an app restart.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { prefillToLaunch, type NewRunPrefill } from "@/app/view/jarvis/newrun";
import { createTempFileFromBlob, createTempFileFromFile } from "@/app/view/term/termutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { Runtime } from "./launch";
import { draftShown, type LauncherKind } from "./launcher";
import { imageRoom, type TaskImage } from "./launcherimages";
import { appendPage, RESUME_PAGE, resumeScopeKey } from "./launcherresume";
import { planPathAtom, setRunShape, setStart } from "./runconfigstore";

export const launcherKindAtom = atom<LauncherKind>("agent") as PrimitiveAtom<LauncherKind>;
// the agent row; null until the first open defaults it from the harness preference
export const launcherRuntimeAtom = atom<Runtime | null>(null) as PrimitiveAtom<Runtime | null>;
// the Tool row's pick, by tool id; null until one is picked (launcher.ts pickedTool falls back to the first listed)
export const launcherToolAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// "" means the first project in recent-first order
export const launcherProjectAtom = atom("") as PrimitiveAtom<string>;
export const launcherTaskAtom = atom("") as PrimitiveAtom<string>;
export const launcherGoalAtom = atom("") as PrimitiveAtom<string>;
// a canvas's board, from Build this…; it only rides an orchestrator run
export const launcherPrototypeAtom = atom("") as PrimitiveAtom<string>;
// a hand-edited command per runtime; a runtime with no entry runs its default
export const launcherCommandAtom = atom<Partial<Record<Runtime, string>>>({}) as PrimitiveAtom<
    Partial<Record<Runtime, string>>
>;
export const launcherWorktreeAtom = atom(false) as PrimitiveAtom<boolean>;
// null follows the project's checked-out branch
export const launcherBranchAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// The agent row's two popovers. They live here, not in the fields' state, so the dialog's one key handler can close
// the open one on Escape wherever focus is (the flag menu opens while focus sits in the Task box).
export const launcherFlagMenuAtom = atom(false) as PrimitiveAtom<boolean>;
export const launcherBranchListAtom = atom(false) as PrimitiveAtom<boolean>;
// the recent sessions the agent half offers to resume; null until this open's load lands
export const launcherSessionsAtom = atom<SessionInfo[] | null>(null) as PrimitiveAtom<SessionInfo[] | null>;
// The Resume list's paging: the scope (launcherresume.ts resumeScopeKey) the list was last loaded for, the cursor of
// the next older page ("" once there is none), and whether a request is in flight.
export const launcherPageAtom = atom({ key: "", cursor: "", loading: false }) as PrimitiveAtom<{
    key: string;
    cursor: string;
    loading: boolean;
}>;
// what the backend found for the text typed in the Resume list, in the scope it was asked in
export const launcherFoundAtom = atom<{ key: string; query: string; sessions: SessionInfo[] } | null>(
    null
) as PrimitiveAtom<{ key: string; query: string; sessions: SessionInfo[] } | null>;
// the session to resume, by id; honored only while it is among the choices (launcherresume.ts pickedResume)
export const launcherResumeAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// the images pasted or dropped into the Task box, each with its temp file once written (launcherimages.ts)
export const launcherImagesAtom = atom<TaskImage[]>([]) as PrimitiveAtom<TaskImage[]>;
// this open showed a draft a close had kept
export const launcherRestoredAtom = atom(false) as PrimitiveAtom<boolean>;
export const launcherBusyAtom = atom(false) as PrimitiveAtom<boolean>;
// what the next open fills in, read by the dialog once the project list is in
export const launcherPrefillAtom = atom<NewRunPrefill | null>(null) as PrimitiveAtom<NewRunPrefill | null>;
// What the prefill's caller (a brainstorm's Approve) wants told when the run the dialog starts exists (the prefill's
// onStarted). The prefill itself is cleared when the dialog takes it, so this is kept from then until the run starts
// (takeLauncherOnStarted) or the dialog closes.
export const launcherOnStartedAtom = atom<((runId: string) => void) | null>(null) as PrimitiveAtom<
    ((runId: string) => void) | null
>;
// The project this open names for itself (a project Overview's New agent and Run); null on every other open. The dialog
// starts on it, and the focused row's project does not take its place (launchermodal.tsx), as a prefill's does not.
export const launcherOwnProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export type LauncherModel = { launcherAtom: PrimitiveAtom<LauncherKind | null> };

function keptDraft() {
    return {
        task: globalStore.get(launcherTaskAtom),
        goal: globalStore.get(launcherGoalAtom),
        planPath: globalStore.get(planPathAtom),
        prototype: globalStore.get(launcherPrototypeAtom),
        images: globalStore.get(launcherImagesAtom).length,
    };
}

// A resume pick outlives a close only this long: enough to reopen after a stray click outside, short enough that a
// later New is not a resume the person forgot they picked. One click picks it again; typed text is kept.
export const RESUME_PICK_KEEP_MS = 2 * 60 * 1000;
let closedAt: number | null = null;

// Every way in. A door picks its own half of the Start list; the agent row and the run shape inside it stay as the
// last open left them. A prefill always opens on the run half. A `project` is the registered project the open picks for
// itself, which the focused agent's project does not override.
export function openLauncher(
    model: LauncherModel,
    door: LauncherKind,
    prefill?: NewRunPrefill,
    project?: string
): void {
    if (closedAt != null && Date.now() - closedAt > RESUME_PICK_KEEP_MS) {
        globalStore.set(launcherResumeAtom, null);
    }
    closedAt = null;
    const kind: LauncherKind = prefill != null ? "run" : door;
    globalStore.set(launcherKindAtom, kind);
    globalStore.set(launcherRestoredAtom, prefill == null && draftShown(keptDraft()));
    globalStore.set(launcherPrefillAtom, prefill ?? null);
    // the dialog takes a new prefill's handback when it applies it; an earlier open's is no longer this one's
    globalStore.set(launcherOnStartedAtom, null);
    globalStore.set(launcherOwnProjectAtom, project ?? null);
    if (project != null) {
        pickLauncherProject(project, globalStore.get(launcherProjectAtom));
    }
    globalStore.set(model.launcherAtom, door);
}

// The app bar's one New button: no door of its own, so it opens on whichever half the last open left picked.
export function reopenLauncher(model: LauncherModel): void {
    openLauncher(model, globalStore.get(launcherKindAtom));
}

// Every way out keeps the draft; that is what lets a click outside close the dialog. An open popover is not draft, the
// resume pick is kept only for RESUME_PICK_KEEP_MS, and a prefill's handback goes: the next New is no caller's run.
export function closeLauncher(model: LauncherModel): void {
    closedAt = Date.now();
    globalStore.set(launcherFlagMenuAtom, false);
    globalStore.set(launcherBranchListAtom, false);
    globalStore.set(launcherOnStartedAtom, null);
    globalStore.set(model.launcherAtom, null);
}

// The header's Clear: what a close kept goes; the pick, the project and the commands stay. The plan path is set
// directly, not through setPlanPath, which would mark the run config as touched by hand.
export function clearLauncherDraft(): void {
    globalStore.set(launcherTaskAtom, "");
    globalStore.set(launcherGoalAtom, "");
    globalStore.set(planPathAtom, "");
    globalStore.set(launcherPrototypeAtom, "");
    globalStore.set(launcherWorktreeAtom, false);
    globalStore.set(launcherBranchAtom, null);
    globalStore.set(launcherResumeAtom, null);
    for (const img of globalStore.get(launcherImagesAtom)) {
        URL.revokeObjectURL(img.previewUrl);
    }
    globalStore.set(launcherImagesAtom, []);
    globalStore.set(launcherRestoredAtom, false);
}

function patchImage(id: string, patch: Partial<TaskImage>): void {
    globalStore.set(launcherImagesAtom, (prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

// A paste is a bare blob (createTempFileFromBlob names it); a drop keeps its file name (createTempFileFromFile). Both are
// kept (~/.arc/attachments), not temp: the task names the file, and the transcript shows it from there long after a
// temp sweep would have removed it.
export function addTaskImages(files: File[], from: "paste" | "drop"): void {
    const room = imageRoom(globalStore.get(launcherImagesAtom).length, files.length);
    for (const f of files.slice(0, room)) {
        const id = crypto.randomUUID();
        globalStore.set(launcherImagesAtom, (prev) => [...prev, { id, previewUrl: URL.createObjectURL(f) }]);
        const write = from === "paste" ? createTempFileFromBlob(f, true) : createTempFileFromFile(f, true);
        write.then(
            (path) => patchImage(id, { path }),
            (e) => patchImage(id, { error: String(e?.message ?? e) })
        );
    }
}

export function removeTaskImage(id: string): void {
    const img = globalStore.get(launcherImagesAtom).find((i) => i.id === id);
    if (img != null) {
        URL.revokeObjectURL(img.previewUrl);
    }
    globalStore.set(launcherImagesAtom, (prev) => prev.filter((i) => i.id !== id));
}

// A launch consumed the draft. Hand-edited commands go with it; the pick, the project and the flags stay.
export function endLauncherDraft(): void {
    clearLauncherDraft();
    globalStore.set(launcherCommandAtom, {});
}

// A different project re-defaults the worktree branch to that project's checked-out one: a branch typed for one repo
// means nothing in another. `current` is the project on show, which "" in the atom also names.
export function pickLauncherProject(name: string, current: string): void {
    if (name === current) {
        return;
    }
    globalStore.set(launcherProjectAtom, name);
    globalStore.set(launcherBranchAtom, null);
    // a session belongs to one project: coming back to this one starts on "New session"
    globalStore.set(launcherResumeAtom, null);
}

// Another runtime offers other sessions, so the resume pick goes with the switch. The runtime already on show keeps it.
export function pickLauncherRuntime(runtime: Runtime): void {
    if (runtime === globalStore.get(launcherRuntimeAtom)) {
        return;
    }
    globalStore.set(launcherRuntimeAtom, runtime);
    globalStore.set(launcherResumeAtom, null);
}

// The last tool picked is remembered for the next open, as the agent row is.
export function pickLauncherTool(id: string): void {
    globalStore.set(launcherToolAtom, id);
}

// What the Resume list is loaded for. A load or a search answered after another load began is not this list's, so each
// answer is checked against these before it lands.
let pageScope = { runtime: "" as Runtime | "", projectPath: "" };
let loadSeq = 0;
let findSeq = 0;

// The first page of one runtime's sessions in one project, replacing the list: a scan of transcripts on disk is read
// once per open and per switch, and a stale list offers a session that has moved on.
export async function loadLauncherSessions(runtime: Runtime, projectPath: string): Promise<void> {
    const key = resumeScopeKey(runtime, projectPath);
    const seq = ++loadSeq;
    findSeq++;
    pageScope = { runtime, projectPath };
    globalStore.set(launcherFoundAtom, null);
    if (key === "") {
        globalStore.set(launcherPageAtom, { key, cursor: "", loading: false });
        return;
    }
    globalStore.set(launcherPageAtom, { key, cursor: "", loading: true });
    try {
        const rtn = await RpcApi.GetRecentSessionsCommand(TabRpcClient, {
            runtime,
            projectpath: projectPath,
            limit: RESUME_PAGE,
        });
        if (seq !== loadSeq) {
            return;
        }
        globalStore.set(launcherSessionsAtom, rtn.sessions ?? []);
        globalStore.set(launcherPageAtom, { key, cursor: rtn.nextcursor ?? "", loading: false });
    } catch {
        // a failed scan offers no resume, never breaks the dialog
        if (seq === loadSeq) {
            globalStore.set(launcherSessionsAtom, []);
            globalStore.set(launcherPageAtom, { key, cursor: "", loading: false });
        }
    }
}

// The next older page, appended. One request at a time; nothing once the cursor is "".
export async function loadMoreLauncherSessions(): Promise<void> {
    const page = globalStore.get(launcherPageAtom);
    if (page.loading || page.cursor === "" || page.key === "") {
        return;
    }
    const seq = loadSeq;
    globalStore.set(launcherPageAtom, { ...page, loading: true });
    try {
        const rtn = await RpcApi.GetRecentSessionsCommand(TabRpcClient, {
            runtime: pageScope.runtime,
            projectpath: pageScope.projectPath,
            limit: RESUME_PAGE,
            cursor: page.cursor,
        });
        if (seq !== loadSeq) {
            return;
        }
        globalStore.set(launcherSessionsAtom, (prev) => appendPage(prev ?? [], rtn.sessions ?? []));
        globalStore.set(launcherPageAtom, { key: page.key, cursor: rtn.nextcursor ?? "", loading: false });
    } catch {
        // an error ends the loading: a retry on every scroll would loop
        if (seq === loadSeq) {
            globalStore.set(launcherPageAtom, { key: page.key, cursor: "", loading: false });
        }
    }
}

// One page of the sessions in the current scope whose title holds `query`, which reaches the pages not loaded yet. The
// answer is kept until the scope changes, so a row picked from it stays resumable once the filter is gone.
export async function findLauncherSessions(query: string): Promise<void> {
    const key = globalStore.get(launcherPageAtom).key;
    const q = query.trim();
    const seq = ++findSeq;
    if (key === "" || q === "") {
        return;
    }
    try {
        const rtn = await RpcApi.GetRecentSessionsCommand(TabRpcClient, {
            runtime: pageScope.runtime,
            projectpath: pageScope.projectPath,
            limit: RESUME_PAGE,
            query: q,
        });
        if (seq === findSeq) {
            globalStore.set(launcherFoundAtom, { key, query: q, sessions: rtn.sessions ?? [] });
        }
    } catch {
        // the rows already loaded still filter
    }
}

// A prefill waits for the project list: read too early, its project would not be found and would be dropped for good.
export function applyLauncherPrefill(projectNames: string[]): boolean {
    const prefill = globalStore.get(launcherPrefillAtom);
    if (prefill == null || projectNames.length === 0) {
        return false;
    }
    globalStore.set(launcherPrefillAtom, null);
    // a function handed to set is read as an updater, so the handback goes in as the updater's result
    const onStarted = prefill.onStarted;
    globalStore.set(launcherOnStartedAtom, onStarted != null ? () => onStarted : null);
    const p = prefillToLaunch(prefill, projectNames);
    if (p.picked != null) {
        pickLauncherProject(p.picked, globalStore.get(launcherProjectAtom));
    }
    setRunShape(p.shape);
    setStart(p.start);
    globalStore.set(launcherGoalAtom, p.goal);
    globalStore.set(launcherPrototypeAtom, p.prototype);
    return true;
}

// The prefill's handback, once, when the run it was for has started: a later start from the same dialog is no one's.
export function takeLauncherOnStarted(): ((runId: string) => void) | null {
    const onStarted = globalStore.get(launcherOnStartedAtom);
    globalStore.set(launcherOnStartedAtom, null);
    return onStarted;
}

// One launch at a time: a held Enter repeats the keydown, and each would start another agent.
export function beginLauncherLaunch(): boolean {
    if (globalStore.get(launcherBusyAtom)) {
        return false;
    }
    globalStore.set(launcherBusyAtom, true);
    return true;
}

export function endLauncherLaunch(): void {
    globalStore.set(launcherBusyAtom, false);
}
