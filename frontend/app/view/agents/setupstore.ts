// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup surface state and its agentsync loaders. Module-level atoms because every surface but Agent
// unmounts on a switch: the shared-doc draft must survive one, and the rest is cheap to keep.

import { pushToast } from "@/app/cockpit/notificationstore";
import { openFileInCode } from "@/app/cockpit/openfilestore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import type { LearnedEntry } from "./learnedmodel";
import {
    editorDiscard,
    editorLoaded,
    editorReload,
    editorSaved,
    editorTyped,
    EMPTY_EDITOR,
    saveBaseMtime,
    syncPlan,
    type DocEditor,
    type SyncPlan,
} from "./setupmodel";
import { adoptKeep, adoptResultText, adoptSkip, KEEP_LEAVE, type SkillKeep } from "./skillsmatrix";
import type { ToolForm } from "./toolslibrarymodel";
import { failedAtom, installingAtom } from "./toolsstore";

export type SetupTab = "instructions" | "skills" | "tools" | "learned" | "memory" | "project";

// local filesystem reads behind an rpc with no default timeout: a stalled backend must reject rather
// than leave the pane on "Reading…" forever
const READ_TIMEOUT_MS = 5000;

export const setupTabAtom = atom<SetupTab>("instructions") as PrimitiveAtom<SetupTab>;
export const setupStatusAtom = atom<CommandAgentSyncStatusRtnData | null>(
    null
) as PrimitiveAtom<CommandAgentSyncStatusRtnData | null>;
export const setupSharedPathAtom = atom<string>("") as PrimitiveAtom<string>;
export const setupSharedAtom = atom<DocEditor>(EMPTY_EDITOR) as PrimitiveAtom<DocEditor>;
export const setupSkillsAtom = atom<CommandAgentSyncSkillsRtnData | null>(
    null
) as PrimitiveAtom<CommandAgentSyncSkillsRtnData | null>;
export const setupSkillKeepAtom = atom<SkillKeep>({}) as PrimitiveAtom<SkillKeep>;
export const setupSkillSelectedAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// one editor per vault skill being edited in the rail, keyed by name: a skill is in edit mode while it has one, and
// its draft survives a surface switch or picking another skill
export const setupSkillEditorsAtom = atom<Record<string, DocEditor>>({}) as PrimitiveAtom<Record<string, DocEditor>>;
// the New skill form in the rail; null when it is closed
export interface NewSkillForm {
    name: string;
    description: string;
}
export const setupNewSkillAtom = atom<NewSkillForm | null>(null) as PrimitiveAtom<NewSkillForm | null>;
export const setupBusyAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
export const setupErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// Sync now: the plan its dry run reported, while the write runs and after it. Null before the first one and
// after the next read of Setup.
export interface SyncResult {
    phase: "writing" | "done";
    plan: SyncPlan;
}
export const setupSyncAtom = atom<SyncResult | null>(null) as PrimitiveAtom<SyncResult | null>;
// The shared doc as it is on disk after a save found it changed, for the conflict notice to list what the outside
// edit did. null: no conflict read; text null: the read failed (Reload and Overwrite stay the way out). Only
// meaningful while the shared editor has a conflict.
export const setupSharedDiskAtom = atom<{ text: string | null } | null>(null) as PrimitiveAtom<{
    text: string | null;
} | null>;
// the harness whose file the Instructions center previews read-only; null shows the shared editor
export const setupHarnessPreviewAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

async function busy(fn: () => Promise<void>): Promise<void> {
    globalStore.set(setupBusyAtom, true);
    globalStore.set(setupErrorAtom, null);
    try {
        await fn();
    } catch (e) {
        globalStore.set(setupErrorAtom, errText(e));
    } finally {
        globalStore.set(setupBusyAtom, false);
    }
}

// Status gives the rows, their order, and each harness file's state against the shared doc.
async function load(): Promise<void> {
    const [status, steering] = await Promise.all([
        RpcApi.AgentSyncStatusCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS }),
        RpcApi.AgentSyncSteeringReadCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS }),
    ]);
    globalStore.set(setupStatusAtom, status);
    globalStore.set(setupSharedPathAtom, steering.path ?? status.steeringdoc ?? "");
    globalStore.set(
        setupSharedAtom,
        editorLoaded(globalStore.get(setupSharedAtom), steering.content ?? "", steering.mtime ?? 0)
    );
}

export async function loadSetup(): Promise<void> {
    // a Sync now result belongs to the visit it ran in
    globalStore.set(setupSyncAtom, null);
    try {
        await load();
    } catch (e) {
        globalStore.set(setupErrorAtom, errText(e));
    }
}

// ---- shared doc ----

export function typeShared(draft: string): void {
    globalStore.set(setupSharedAtom, editorTyped(globalStore.get(setupSharedAtom), draft));
}

export function discardShared(): void {
    globalStore.set(setupSharedAtom, editorDiscard(globalStore.get(setupSharedAtom)));
    globalStore.set(setupSharedDiskAtom, null);
}

export function reloadShared(): Promise<void> {
    return busy(async () => {
        const r = await RpcApi.AgentSyncSteeringReadCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS });
        globalStore.set(setupSharedAtom, editorReload(r.content ?? "", r.mtime ?? 0));
        globalStore.set(setupSharedDiskAtom, null);
    });
}

// The doc as it is on disk, for the conflict notice to list what the outside edit changed. A failed read
// leaves text null, which the notice says, so Reload and Overwrite stay the way out.
async function readDiskAfterConflict(): Promise<void> {
    try {
        const r = await RpcApi.AgentSyncSteeringReadCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS });
        globalStore.set(setupSharedDiskAtom, { text: r.content ?? "" });
    } catch (e) {
        console.error("reading the shared doc after a save conflict:", e);
        globalStore.set(setupSharedDiskAtom, { text: null });
    }
}

// Write, then project at once: a doc the harnesses have not received is the stale state this exists to
// remove. A conflict stops before the apply and leaves the draft for Reload or Overwrite.
export function saveShared(overwrite: boolean): Promise<void> {
    return busy(async () => {
        const ed = globalStore.get(setupSharedAtom);
        const written = ed.draft;
        const res = await RpcApi.AgentSyncSteeringWriteCommand(TabRpcClient, {
            content: written,
            basemtime: saveBaseMtime(ed, overwrite),
        });
        globalStore.set(setupSharedAtom, editorSaved(globalStore.get(setupSharedAtom), written, res));
        globalStore.set(setupSharedDiskAtom, null);
        if (res.conflict) {
            await readDiskAfterConflict();
            return;
        }
        await RpcApi.AgentSyncApplyCommand(TabRpcClient, {});
        await load();
    });
}

// Projects the saved doc into every harness without a save: the way to bring a stale or unwritten harness up to
// date when there is nothing to edit. A dry run goes first, so the counts the person sees are what the apply
// reports it will write, not a guess from the rows. A failed write still reads the rows again: part of it may
// have landed.
export function syncNow(): Promise<void> {
    return busy(async () => {
        const dry = await RpcApi.AgentSyncApplyCommand(TabRpcClient, { dryrun: true });
        const plan = syncPlan(dry?.actions ?? []);
        globalStore.set(setupSyncAtom, { phase: "writing", plan });
        try {
            await RpcApi.AgentSyncApplyCommand(TabRpcClient, { dryrun: false });
        } catch (e) {
            globalStore.set(setupSyncAtom, null);
            await load().catch(() => {});
            throw e;
        }
        await load();
        globalStore.set(setupSyncAtom, { phase: "done", plan });
    });
}

// ---- skills ----

export async function loadSkills(): Promise<void> {
    try {
        globalStore.set(
            setupSkillsAtom,
            await RpcApi.AgentSyncSkillsCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS })
        );
        // a read that failed on an earlier visit must not leave its banner over fresh data
        globalStore.set(setupErrorAtom, null);
    } catch (e) {
        globalStore.set(setupErrorAtom, errText(e));
    }
}

// Picking a skill closes the New skill form: the rail shows one thing at a time.
export function selectSkill(name: string): void {
    globalStore.set(setupNewSkillAtom, null);
    globalStore.set(setupSkillSelectedAtom, name);
}

export function setSkillKeep(name: string, runtime: string | null): void {
    const { [name]: _, ...rest } = globalStore.get(setupSkillKeepAtom);
    globalStore.set(setupSkillKeepAtom, runtime == null ? rest : { ...rest, [name]: runtime });
}

// Moves every adoptable skill into the vault; an undecided one without a keep stays where it is.
export function adoptSkills(): Promise<void> {
    return busy(async () => {
        const data = globalStore.get(setupSkillsAtom);
        if (data == null) {
            return;
        }
        const choices = globalStore.get(setupSkillKeepAtom);
        const keep = adoptKeep(data, choices);
        const skip = adoptSkip(data, choices);
        // a failed adopt may have moved some skills already, so the matrix is re-read either way
        try {
            const rtn = await RpcApi.AgentSyncAdoptCommand(TabRpcClient, {
                apply: true,
                keep,
                ...(skip.length > 0 ? { skip } : {}),
            });
            // the toast counts what the reply says happened, not what the matrix showed before the click
            pushToast({ title: adoptResultText(rtn ?? {}, { keep, skip }), message: "", level: "info" });
            // a snapshot moved nothing, so every choice still stands; otherwise only "leave it" outlives the move
            if (!rtn?.dryrun) {
                globalStore.set(
                    setupSkillKeepAtom,
                    Object.fromEntries(Object.entries(choices).filter(([, c]) => c === KEEP_LEAVE))
                );
            }
        } finally {
            await loadSkills();
        }
    });
}

export function openSkillFile(model: AgentsViewModel, path: string): Promise<void> {
    return busy(() => openFileInCode(model, path));
}

// ---- learned ----

// every line the user accepted (skill additions and learned memories); null until the first read
export const setupLearnedAtom = atom<CommandLearnAcceptedRtnData | null>(
    null
) as PrimitiveAtom<CommandLearnAcceptedRtnData | null>;

export async function loadLearned(): Promise<void> {
    try {
        globalStore.set(
            setupLearnedAtom,
            await RpcApi.LearnAcceptedCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS })
        );
        globalStore.set(setupErrorAtom, null);
    } catch (e) {
        globalStore.set(setupErrorAtom, errText(e));
    }
}

// Edit a line's text or remove it (a removal also mutes the key). A skill line changes what every harness
// reads, so the skills list is re-read with the learned one, whether or not the change went through: a
// removal that failed after the line was gone would otherwise leave the rail showing it.
export function amendLearned(
    line: Pick<LearnedEntry, "skill" | "dir" | "key">,
    change: { text: string } | { remove: true }
): Promise<void> {
    return busy(async () => {
        try {
            await RpcApi.LearnAmendCommand(TabRpcClient, {
                skill: line.skill,
                dir: line.dir,
                key: line.key,
                text: "text" in change ? change.text : undefined,
                remove: "remove" in change,
            });
        } finally {
            await Promise.all([loadLearned(), loadSkills()]);
        }
    });
}

function setSkillEditor(name: string, ed: DocEditor | null): void {
    const { [name]: _, ...rest } = globalStore.get(setupSkillEditorsAtom);
    globalStore.set(setupSkillEditorsAtom, ed == null ? rest : { ...rest, [name]: ed });
}

// Opens a vault skill's SKILL.md in the rail's editor. A skill already being edited keeps its draft.
export function editSkill(name: string): Promise<void> {
    if (globalStore.get(setupSkillEditorsAtom)[name] != null) {
        return Promise.resolve();
    }
    return busy(async () => {
        const doc = await RpcApi.AgentSyncSkillReadCommand(TabRpcClient, { name }, { timeout: READ_TIMEOUT_MS });
        setSkillEditor(name, editorReload(doc.content ?? "", doc.mtime ?? 0));
    });
}

export function typeSkill(name: string, draft: string): void {
    const ed = globalStore.get(setupSkillEditorsAtom)[name];
    if (ed != null) {
        setSkillEditor(name, editorTyped(ed, draft));
    }
}

// Leaves edit mode and drops the draft.
export function closeSkillEditor(name: string): void {
    setSkillEditor(name, null);
}

export function reloadSkill(name: string): Promise<void> {
    return busy(async () => {
        const doc = await RpcApi.AgentSyncSkillReadCommand(TabRpcClient, { name }, { timeout: READ_TIMEOUT_MS });
        setSkillEditor(name, editorReload(doc.content ?? "", doc.mtime ?? 0));
    });
}

// Writes the draft into the vault, then copies it into every harness at once, as the shared doc does. Returns the
// saved text, or null when nothing landed (a conflict keeps the editor open with the draft).
export async function saveSkill(name: string, overwrite: boolean): Promise<string | null> {
    let saved: string | null = null;
    await busy(async () => {
        const ed = globalStore.get(setupSkillEditorsAtom)[name];
        if (ed == null) {
            return;
        }
        const written = ed.draft;
        const res = await RpcApi.AgentSyncSkillWriteCommand(TabRpcClient, {
            name,
            content: written,
            basemtime: saveBaseMtime(ed, overwrite),
        });
        if (res.conflict) {
            setSkillEditor(name, editorSaved(ed, written, res));
            return;
        }
        saved = written;
        // typing that landed while the write was in flight stays a draft, and the editor with it
        const now = globalStore.get(setupSkillEditorsAtom)[name];
        setSkillEditor(name, now != null && now.draft !== written ? editorSaved(now, written, res) : null);
        await RpcApi.AgentSyncApplyCommand(TabRpcClient, {});
        await loadSkills();
    });
    return saved;
}

export function openNewSkill(): void {
    globalStore.set(setupNewSkillAtom, { name: "", description: "" });
}

export function typeNewSkill(form: NewSkillForm): void {
    globalStore.set(setupNewSkillAtom, form);
}

export function closeNewSkill(): void {
    globalStore.set(setupNewSkillAtom, null);
}

// Creates the skill in the vault, copies it into every harness, selects it and opens it in the editor.
export function createSkill(): Promise<void> {
    return busy(async () => {
        const form = globalStore.get(setupNewSkillAtom);
        if (form == null) {
            return;
        }
        const name = form.name.trim();
        const doc = await RpcApi.AgentSyncSkillCreateCommand(TabRpcClient, {
            name,
            description: form.description.trim(),
        });
        // the skill exists once create returns, so a failed copy into the harnesses still opens it: a retry would only
        // find the name taken. The form gives way once the matrix has the new row, so the rail never flashes another.
        try {
            await RpcApi.AgentSyncApplyCommand(TabRpcClient, {});
        } finally {
            await loadSkills();
            setSkillEditor(name, editorReload(doc.content ?? "", doc.mtime ?? 0));
            globalStore.set(setupSkillSelectedAtom, name);
            globalStore.set(setupNewSkillAtom, null);
        }
    });
}

// ---- project ----

// the project Setup → Project shows (null: contextProject picks), what was read for it, and the file the rail reads
export interface ClaudeContextLoad {
    project: string;
    path: string;
    files: ClaudeContextFile[];
    error: string | null;
}
export const setupContextProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const setupContextAtom = atom<ClaudeContextLoad | null>(null) as PrimitiveAtom<ClaudeContextLoad | null>;
export const setupContextSelectedAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// each load takes the next number, so a slow answer for a project left behind cannot land after the newer one
let contextLoadSeq = 0;

export async function loadClaudeContext(project: string, path: string): Promise<void> {
    const seq = ++contextLoadSeq;
    try {
        const r = await RpcApi.ClaudeContextCommand(TabRpcClient, { path }, { timeout: READ_TIMEOUT_MS });
        if (seq === contextLoadSeq) {
            globalStore.set(setupContextAtom, { project, path, files: r.files ?? [], error: null });
        }
    } catch (e) {
        if (seq === contextLoadSeq) {
            globalStore.set(setupContextAtom, { project, path, files: [], error: errText(e) });
        }
    }
}

// re-reads the project on screen: an agent may have written memory or settings since
export function reloadClaudeContext(): Promise<void> {
    const cur = globalStore.get(setupContextAtom);
    return cur == null ? Promise.resolve() : loadClaudeContext(cur.project, cur.path);
}

export function selectContextProject(name: string): void {
    globalStore.set(setupContextProjectAtom, name);
    globalStore.set(setupContextSelectedAtom, null);
}

export function selectContextFile(path: string): void {
    globalStore.set(setupContextSelectedAtom, path);
}

// Moves a memory file to the trash (ClaudeMemoryDeleteCommand drops its MEMORY.md line too), then reads the project
// again with the rail on next (the neighbouring memory; null falls back to the tab's first file). Returns the error,
// or null when it went. The list is read again either way: a failure part way can still have moved the file.
export async function deleteContextMemory(path: string, next: string | null): Promise<string | null> {
    let err: string | null = null;
    try {
        await RpcApi.ClaudeMemoryDeleteCommand(TabRpcClient, { path });
        globalStore.set(setupContextSelectedAtom, next);
    } catch (e) {
        err = errText(e);
    }
    await reloadClaudeContext();
    return err;
}

// ---- tools ----

// the tool the library's detail shows (null: the first in the list), and what is typed in its search
export const selectedToolAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const toolsSearchAtom = atom<string>("") as PrimitiveAtom<string>;
// the add / edit form while it is open; null shows the selected tool's detail
export const toolFormAtom = atom<ToolForm | null>(null) as PrimitiveAtom<ToolForm | null>;
// tools an install terminal ended on without failing, this session: one still not found after it needs a restart
export const installEndedAtom = atom<string[]>([]) as PrimitiveAtom<string[]>;

// Opens Setup → Tools on one tool (Edit in the picker lands here).
export function openSetupTool(model: Pick<AgentsViewModel, "surfaceAtom">, toolId: string): void {
    globalStore.set(toolFormAtom, null);
    globalStore.set(selectedToolAtom, toolId);
    globalStore.set(toolsSearchAtom, "");
    globalStore.set(setupTabAtom, "tools");
    globalStore.set(model.surfaceAtom, "setup");
}

let watchingInstalls = false;

// Once: notes each tool whose install terminal ends without a failure. Started wherever an install starts, since the
// terminal can end after the library is left. A failure sets failedAtom in the same turn that clears installingAtom, so
// the check waits a microtask for both.
export function watchInstallEnds(): void {
    if (watchingInstalls) {
        return;
    }
    watchingInstalls = true;
    let prev = globalStore.get(installingAtom);
    globalStore.sub(installingAtom, () => {
        const next = globalStore.get(installingAtom);
        const gone = Object.keys(prev).filter((id) => next[id] == null);
        prev = next;
        if (gone.length === 0) {
            return;
        }
        queueMicrotask(() => {
            const failed = globalStore.get(failedAtom);
            const ended = gone.filter((id) => failed[id] == null);
            if (ended.length > 0) {
                globalStore.set(installEndedAtom, [...new Set([...globalStore.get(installEndedAtom), ...ended])]);
            }
        });
    });
}
