// frontend/app/view/agents/diffsource.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: which worktree the Diff surface is pointed at, and when the focused agent is allowed to move
// it. This is the run-beats-project-beats-agent precedence, which used to live inside two effects in
// the surface where it could only be read by tracing early returns. Stated here as two questions
// with answers, so it can be tested without mounting anything.

import { normalizeRepoPath, repoBasename } from "@/util/paths";
import { defaultRangeFor, type DiffOrigin, type DiffScope } from "./diffscope";

// the surface needs no more of an agent than this
export interface SourceAgent {
    id: string;
    name: string;
}

// The agent the surface should re-scope to when focus moves, or null to stay put. Focus only moves a
// surface that is already showing an agent (or showing nothing yet): pinning a project or a worktree,
// or arriving from a run, outranks it, which is the whole precedence in one guard.
export function focusFollowAgent(
    scope: DiffScope | null,
    focusId: string | undefined,
    agents: SourceAgent[]
): SourceAgent | null {
    const origin = scope?.repo.origin;
    if (origin != null && origin.kind !== "agent") {
        return null;
    }
    if (!focusId) {
        return null;
    }
    if (origin?.kind === "agent" && origin.id === focusId) {
        return null; // already showing it
    }
    // an ended agent's scope stays until a source is picked: when it leaves, the Agent surface moves focus to
    // the first agent, and following that would replace the ended state before anyone could read it
    if (origin?.kind === "agent" && !agents.some((a) => a.id === origin.id)) {
        return null;
    }
    return agents.find((a) => a.id === focusId) ?? null;
}

// Opening the surface with nothing scoped and nothing focused would show a dead "select a source"
// screen, so the first agent is adopted instead.
export function defaultFocusId(
    scope: DiffScope | null,
    focusId: string | undefined,
    agents: SourceAgent[]
): string | null {
    return scope == null && !focusId && agents.length > 0 ? agents[0].id : null;
}

// What the surface's body draws for its subject. `ended` is an agent scope whose agent has left the roster: its
// folder is still worth reviewing, so it is told apart from having nothing to show.
export type SubjectState = "empty" | "pick" | "ended" | "ready";

export function subjectState(
    scope: DiffScope | null,
    agents: SourceAgent[],
    projects: { name: string }[]
): SubjectState {
    if (scope == null) {
        return agents.length > 0 || projects.length > 0 ? "pick" : "empty";
    }
    const origin = scope.repo.origin;
    if (origin.kind === "agent" && !agents.some((a) => a.id === origin.id)) {
        return "ended";
    }
    return "ready";
}

// Where an ended agent's changes can still be read: the registered project at its folder, else the folder itself
// as an unregistered project. Built here rather than through agentdiffnav so this file stays free of stores.
export function endedAgentScope(cwd: string | undefined, projects: { name: string; path: string }[]): DiffScope | null {
    if (!cwd) {
        return null;
    }
    const own = normalizeRepoPath(cwd);
    const registered = projects.find((p) => normalizeRepoPath(p.path) === own);
    const name = registered?.name ?? repoBasename(cwd);
    const origin: DiffOrigin = { kind: "project", name, path: registered?.path ?? cwd };
    return { repo: { origin, label: name }, range: defaultRangeFor(origin) };
}
