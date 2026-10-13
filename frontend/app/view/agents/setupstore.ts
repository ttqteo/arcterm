// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup surface state and its agentsync loaders. Module-level atoms because every surface but Agent
// unmounts on a switch: the shared-doc draft must survive one, and the rest is cheap to keep.

import { openFileInCode } from "@/app/cockpit/openfilestore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";
import {
    editorDiscard,
    editorLoaded,
    editorReload,
    editorSaved,
    editorTyped,
    EMPTY_EDITOR,
    saveBaseMtime,
    type DocEditor,
} from "./setupmodel";
import { adoptKeep, type SkillKeep } from "./skillsmatrix";
import type { ToolForm } from "./toolslibrarymodel";
import { failedAtom, installingAtom } from "./toolsstore";

export type SetupTab = "instructions" | "skills" | "tools";

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
export const setupBusyAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
export const setupErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

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
}

export function reloadShared(): Promise<void> {
    return busy(async () => {
        const r = await RpcApi.AgentSyncSteeringReadCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS });
        globalStore.set(setupSharedAtom, editorReload(r.content ?? "", r.mtime ?? 0));
    });
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
        if (res.conflict) {
            return;
        }
        await RpcApi.AgentSyncApplyCommand(TabRpcClient, {});
        await load();
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

export function selectSkill(name: string): void {
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
        const keep = adoptKeep(data, globalStore.get(setupSkillKeepAtom));
        // a failed adopt may have moved some skills already, so the matrix is re-read either way
        try {
            await RpcApi.AgentSyncAdoptCommand(TabRpcClient, { apply: true, keep });
            globalStore.set(setupSkillKeepAtom, {});
        } finally {
            await loadSkills();
        }
    });
}

export function openSkillFile(model: AgentsViewModel, path: string): Promise<void> {
    return busy(() => openFileInCode(model, path));
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
