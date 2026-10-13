// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A terminal whose folder was removed: when an agent's branch lands its worktree goes, and a terminal that was running in
// it is left in a folder that no longer exists. Which terminals those are, where "Reopen" puts a new one, and when the
// folders are worth checking again. Pure: worktreegonestore.ts reads the folders, worktreegonecard.tsx draws the card.

import { normPath } from "./agentsidebarmodel";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { HOME_NAME, HOME_PICK } from "./launcher";

type Roots = ReadonlyMap<string, string>; // project name -> root path, as projectTree takes it

// A terminal in its project's root is not in a worktree: that folder going is the project's removal, which reopening in
// the same root would not mend. No cwd, nothing to check.
function checkable(terminal: AgentVM, roots: Roots): string | undefined {
    const cwd = terminal.cwd;
    if (!cwd) {
        return undefined;
    }
    const root = roots.get(projectOf(terminal));
    return root != null && normPath(cwd) === normPath(root) ? undefined : cwd;
}

/** Pure: the ids of the terminals whose folder is gone. `exists(cwd)` is what was last read of the folder: true, false
 *  once it was found missing, undefined while it has not been read (not gone: nothing says it is). A terminal in its
 *  project's root, or with no cwd, is never gone. A project with no registered root has no root to be in. */
export function goneTerminals(
    terminals: readonly AgentVM[],
    exists: (cwd: string) => boolean | undefined,
    roots: Roots = new Map()
): string[] {
    const out: string[] = [];
    for (const t of terminals) {
        const cwd = checkable(t, roots);
        if (cwd != null && exists(cwd) === false) {
            out.push(t.id);
        }
    }
    return out;
}

/** Pure: the folders worth reading: each terminal's cwd once, minus the ones goneTerminals never reports. */
export function cwdsToCheck(terminals: readonly AgentVM[], roots: Roots = new Map()): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of terminals) {
        const cwd = checkable(t, roots);
        if (cwd != null && !seen.has(normPath(cwd))) {
            seen.add(normPath(cwd));
            out.push(cwd);
        }
    }
    return out;
}

/** Pure: the path to ask the file system about for a terminal's cwd on `platform` (a NodeJS.Platform string), or undefined
 *  when it cannot be told. Git Bash reports its folder as /c/work (OSC 7 carries $PWD), which Windows reads as a folder on
 *  the current drive, so that form becomes C:/work; any other path with no drive on Windows (/home/me, /tmp) names no
 *  folder there, and a folder is never called gone on a guess. */
export function statPath(cwd: string, platform: string): string | undefined {
    if (platform !== "win32" || /^([a-zA-Z]:|\\\\|~)/.test(cwd)) {
        return cwd;
    }
    const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(cwd);
    return msys ? `${msys[1].toUpperCase()}:${msys[2] ?? "/"}` : undefined;
}

/** Pure: the last folder of a path: what a removed terminal's row and card call its folder when no project root says
 *  which part of it is the worktree (terminalPlace, which names it only against a root). */
export function folderName(path: string | undefined): string | undefined {
    return (
        path
            ?.replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() || undefined
    );
}

export interface ReopenTarget {
    project: string; // the name the new terminal is filed under
    path: string; // the folder it opens in: the project's root, or "~" for Home
    home: boolean;
}

/** Pure: where Reopen opens the replacement: the terminal's project root, or Home when the terminal has no project or its
 *  project has no registered root (the folder the terminal ran in is not an option: it is gone). */
export function reopenTarget(terminal: AgentVM, roots: Roots): ReopenTarget {
    const project = projectOf(terminal);
    const root = project ? roots.get(project) : undefined;
    return root ? { project, path: root, home: false } : { project: HOME_NAME, path: HOME_PICK, home: true };
}

/** Pure: the card's primary button. */
export function reopenLabel(target: ReopenTarget): string {
    return `Reopen in ${target.project}`;
}

/** Pure: a string that changes when a run has cleaned up a task's worktree, from the engine's digests (run id -> digest).
 *  The cleanup is what removes a worktree, so it is the moment a terminal in one is worth checking again. The same
 *  digests in any order give the same string. */
export function cleanupSignature(digests: Readonly<Record<string, DagStatusDigest>>): string {
    return Object.keys(digests)
        .sort()
        .map(
            (runId) => `${runId}:${(digests[runId]?.tasks ?? []).map((t) => `${t.taskid}=${t.cleanupstate}`).join(",")}`
        )
        .join(";");
}
