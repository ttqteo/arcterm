// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which recent sessions the New launcher offers to resume, and how a picked one launches
// (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Pure; launcherresume.test.ts covers it.

import { composeStartupCommand, type Runtime } from "./launch";

// the Session column scrolls and filters, so it can offer more than fit at once
export const RESUME_LIST_MAX = 30;

export const UNTITLED_SESSION = "(untitled session)";

// a path as the comparison sees it: Windows paths reach the roster and the transcripts written two ways
function normPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function resumeChoices(sessions: SessionInfo[] | null, runtime: Runtime, projectPath: string): SessionInfo[] {
    if (sessions == null || runtime === "terminal" || !projectPath) {
        return [];
    }
    const want = normPath(projectPath);
    return sessions
        .filter((x) => x.runtime === runtime && normPath(x.projectpath) === want)
        .sort((a, b) => b.lastactivets - a.lastactivets)
        .slice(0, RESUME_LIST_MAX);
}

// The store resets the pick on a runtime or project switch; this guard keeps a pick that is no longer on offer (a
// rescan dropped it) from launching.
export function pickedResume(choices: SessionInfo[], id: string | null): SessionInfo | null {
    return id == null ? null : (choices.find((x) => x.id === id) ?? null);
}

export interface ResumeLaunch {
    startupCommand: string;
    startupArgs?: string[];
    resumePath?: string;
}

export function resumeLaunchSpec(session: SessionInfo, runtime: Runtime, flags: Record<string, boolean>): ResumeLaunch {
    if (runtime === "pi" && session.resumeargs?.length) {
        // pi's --session takes a path that can hold spaces: its argv is used verbatim, never re-split
        return {
            startupCommand: session.resumecommand,
            startupArgs: session.resumeargs,
            resumePath: session.transcriptpath,
        };
    }
    // the catalog's continue flag resumes the last session, which may not be the picked one
    return { startupCommand: composeStartupCommand(session.resumecommand, runtime, { ...flags, continue: false }) };
}

export function sessionTitle(session: SessionInfo): string {
    return session.task || UNTITLED_SESSION;
}

export function filterSessions(choices: SessionInfo[], query: string): SessionInfo[] {
    const q = query.trim().toLowerCase();
    return q === "" ? choices : choices.filter((x) => sessionTitle(x).toLowerCase().includes(q));
}

export type ResumeListAction =
    | { kind: "none" }
    | { kind: "pick"; index: number }
    | { kind: "move"; delta: 1 | -1 }
    | { kind: "filter"; next: string }
    | { kind: "back" };

// What a key does in the Session column, the Project column's rules over its own rows: a digit picks the nth visible
// row (1 is New session), letters filter, ← steps back to Project. "none" leaves the key to the dialog (Enter launches,
// Escape with no filter closes).
export function resumeListKey(
    k: { key: string; mod: boolean },
    ctx: { rows: number; filter: string }
): ResumeListAction {
    if (k.mod) {
        return { kind: "none" };
    }
    if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        return { kind: "move", delta: k.key === "ArrowDown" ? 1 : -1 };
    }
    if (k.key === "ArrowLeft") {
        return { kind: "back" };
    }
    if (/^[1-9]$/.test(k.key)) {
        const index = Number(k.key) - 1;
        return index < ctx.rows ? { kind: "pick", index } : { kind: "none" };
    }
    if (k.key === "Escape" || k.key === "Backspace") {
        if (ctx.filter === "") {
            return { kind: "none" };
        }
        return { kind: "filter", next: k.key === "Escape" ? "" : ctx.filter.slice(0, -1) };
    }
    // a space only extends a filter already started; a named key ("Process", "Dead") is not a letter
    if (k.key.length === 1 && !/[0-9]/.test(k.key) && (k.key !== " " || ctx.filter !== "")) {
        return { kind: "filter", next: ctx.filter + k.key };
    }
    return { kind: "none" };
}
