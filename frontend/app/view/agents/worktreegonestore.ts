// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which terminals run in a folder that was removed (worktreegone.ts has the rules), and the card's two actions. Module-
// level atoms: the terminal rows in the tree and the panes in the grid read them, and every surface but Agent unmounts
// on a switch. A folder is read with the file-info RPC (a missing one comes back notfound; an error leaves what was
// known), when the terminal list or a run's cleanup changes (useWorktreeGoneChecks), when a terminal's pane is shown and
// when the window is focused, so a folder deleted outside arcterm is caught too.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceService } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { PLATFORM } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { normPath } from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { liveTerminalsAtom } from "./liveagents";
import { projectsAtom } from "./projectsstore";
import { runDigestsAtom } from "./runlineagestore";
import { loadTools, openTool, toolsStatusAtom } from "./toolsstore";
import { cleanupSignature, cwdsToCheck, goneTerminals, reopenTarget, statPath } from "./worktreegone";

// project name -> root path, for the projects that have one (projectTree's `roots`)
export const projectRootsAtom: Atom<Map<string, string>> = atom((get) => {
    const out = new Map<string, string>();
    for (const [name, project] of Object.entries(get(projectsAtom))) {
        if (project?.path) {
            out.set(name, project.path);
        }
    }
    return out;
});

// normPath(cwd) -> whether the folder was there when last read. No entry: not read yet, or not readable (a folder the
// file system cannot be asked about, statPath), and neither is gone.
const folderExistsAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;

let lastGone: string[] = [];

// The ids of the terminals whose folder is gone. The same array while it holds the same ids, so a reader does not repaint
// every time the terminal list ticks.
export const goneTerminalIdsAtom: Atom<string[]> = atom((get) => {
    const exists = get(folderExistsAtom);
    const next = goneTerminals(get(liveTerminalsAtom), (cwd) => exists[normPath(cwd)], get(projectRootsAtom));
    if (next.length === lastGone.length && next.every((id, i) => id === lastGone[i])) {
        return lastGone;
    }
    lastGone = next;
    return next;
});

const reading = new Set<string>();

// A terminal on another machine has no folder here to ask about (its cmd:cwd is the remote's)
function isLocal(terminal: AgentVM): boolean {
    const conn =
        terminal.blockId != null
            ? WOS.getObjectValue<Block>(WOS.makeORef("block", terminal.blockId))?.meta?.connection
            : undefined;
    return typeof conn !== "string" || conn === "" || conn === "local";
}

// Reads each folder, once at a time: a read asked for while one of the same folder is under way is dropped. A folder the
// RPC could not read keeps what was known of it.
export async function checkFolders(cwds: readonly string[]): Promise<void> {
    const todo = cwds.filter((cwd) => !reading.has(normPath(cwd)) && statPath(cwd, PLATFORM) != null);
    for (const cwd of todo) {
        reading.add(normPath(cwd));
    }
    const found = await Promise.all(
        todo.map(async (cwd): Promise<[string, boolean] | null> => {
            try {
                const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: statPath(cwd, PLATFORM)! } });
                return [normPath(cwd), !info.notfound];
            } catch {
                return null;
            } finally {
                reading.delete(normPath(cwd));
            }
        })
    );
    const known = globalStore.get(folderExistsAtom);
    const changed = found.filter((f): f is [string, boolean] => f != null && known[f[0]] !== f[1]);
    if (changed.length > 0) {
        globalStore.set(folderExistsAtom, { ...known, ...Object.fromEntries(changed) });
    }
}

function localTerminals(): AgentVM[] {
    return globalStore.get(liveTerminalsAtom).filter(isLocal);
}

// Mounted once by the Agent surface. `shown` is the ids of the panes on screen (the grid's cells and the panel): a pane
// is read as it is shown. Every terminal is read when the list or a run's cleanup changes and when the window is focused.
export function useWorktreeGoneChecks(shown: readonly string[]): void {
    const terminals = useAtomValue(liveTerminalsAtom);
    const roots = useAtomValue(projectRootsAtom);
    const cleanup = cleanupSignature(useAtomValue(runDigestsAtom));
    const folders = cwdsToCheck(terminals.filter(isLocal), roots).join("\n");
    useEffect(() => {
        void checkFolders(folders === "" ? [] : folders.split("\n"));
    }, [folders, cleanup]);
    const shownKey = shown.join(",");
    useEffect(() => {
        const ids = new Set(shownKey.split(","));
        void checkFolders(
            cwdsToCheck(
                localTerminals().filter((t) => ids.has(t.id)),
                globalStore.get(projectRootsAtom)
            )
        );
    }, [shownKey]);
    useEffect(() => {
        const onFocus = () => void checkFolders(cwdsToCheck(localTerminals(), globalStore.get(projectRootsAtom)));
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, []);
}

export type ReopenResult = { ok: true } | { ok: false; reason: string };

function closeTab(id: string): void {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid != null) {
        fireAndForget(() => WorkspaceService.CloseTab(ws.oid, id));
    }
}

// "Close terminal" on the card: the terminal has nothing left to run in, so it closes without asking.
export function closeGoneTerminal(terminal: AgentVM): void {
    closeTab(terminal.id);
}

// "Reopen in <project>": a new terminal in the project's root (Home without one) in the centre, running the same tool
// when the terminal was opened from the library (openTool, which refuses a tool no longer on PATH: nothing is closed
// then, and the reason is returned), else a plain shell; then the old terminal closes.
export async function reopenTerminal(model: AgentsViewModel, terminal: AgentVM): Promise<ReopenResult> {
    const target = reopenTarget(terminal, globalStore.get(projectRootsAtom));
    try {
        if (terminal.toolId && globalStore.get(toolsStatusAtom) == null) {
            await loadTools();
        }
        const tool = terminal.toolId
            ? globalStore.get(toolsStatusAtom)?.find((t) => t.id === terminal.toolId)
            : undefined;
        if (tool != null) {
            const opened = await openTool(model, tool, { project: target.project, place: "centre" });
            if (!opened.ok) {
                return opened;
            }
        } else {
            await launchAgent(model, {
                runtime: "terminal",
                startupCommand: "",
                task: "",
                projectPath: target.path,
                projectName: target.project,
                focus: true,
            });
        }
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    closeTab(terminal.id);
    return { ok: true };
}
