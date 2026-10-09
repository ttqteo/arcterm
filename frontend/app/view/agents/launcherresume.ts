// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which recent sessions the New launcher offers to resume, and how a picked one launches
// (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Pure; launcherresume.test.ts covers it.

import { composeStartupCommand, type Runtime } from "./launch";

export const RESUME_LIST_MAX = 5;

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
