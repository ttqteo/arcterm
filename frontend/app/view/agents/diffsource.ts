// frontend/app/view/agents/diffsource.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: which worktree the Diff surface is pointed at, and when the focused agent is allowed to move
// it. This is the run-beats-project-beats-agent precedence, which used to live inside two effects in
// the surface where it could only be read by tracing early returns. Stated here as two questions
// with answers, so it can be tested without mounting anything.

import type { DiffScope } from "./diffscope";

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
