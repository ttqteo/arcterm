// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: how many turns each agent finished while you were not looking, for the Agent surface's nav badge and the
// count on a sidebar row. Each move from working to idle out of view adds one, so an agent that goes back to work
// unseen keeps its count and the next finish adds to it. It is read once it is in view (viewingIds), or once it asks,
// which the Cockpit's attention badge already counts. An agent that left the roster is dropped. A run's workers and
// stage sessions never count: they report to their lead, so their turns are the lead's business, not yours. Nor does
// a lead once its plan is running: the engine wakes it, and those turns are the engine's business.
// No React, no store.

import type { CenterMode } from "./agentcenter";
import type { GridState } from "./agentgrid";
import type { AgentState } from "./agentsviewmodel";
import type { Lineage } from "./runlineage";

export interface UnreadAgent {
    id: string;
    state: AgentState;
}

/** Pure: the agents whose turns never count: a run's workers and stage sessions, and a lead once its run has a dag.
 *  From then on the engine wakes the lead for each task, merge and question, and what it needs from you arrives as an
 *  ask; before it, a lead from a goal is still talking its spec and plan through with you. */
export function nestedIds(lineage: Lineage): Set<string> {
    const out = new Set<string>();
    for (const [id, role] of Object.entries(lineage.roles)) {
        if (role.kind === "worker" || role.kind === "stage" || lineage.runs[role.runId]?.dag != null) {
            out.add(id);
        }
    }
    return out;
}

/** Pure: the unread counts after one roster snapshot, `prevStates` being each agent's state in the snapshot before.
 *  `nested` (nestedIds) are skipped. Only agents with a count are in the map. */
export function nextUnread(
    prev: ReadonlyMap<string, number>,
    prevStates: ReadonlyMap<string, AgentState>,
    agents: readonly UnreadAgent[],
    viewing: ReadonlySet<string>,
    nested: ReadonlySet<string> = new Set()
): Map<string, number> {
    const out = new Map<string, number>();
    for (const a of agents) {
        if (viewing.has(a.id) || a.state === "asking" || nested.has(a.id)) {
            continue;
        }
        const finished = a.state === "idle" && prevStates.get(a.id) === "working" ? 1 : 0;
        const n = (prev.get(a.id) ?? 0) + finished;
        if (n > 0) {
            out.set(a.id, n);
        }
    }
    return out;
}

/** Pure: the unread agent the Agent badge jumps to, the one that finished last (latest `idleSince`; one without it
 *  ranks oldest, and a tie keeps roster order). Undefined when no agent in the roster is unread. */
export function latestUnreadId(
    unread: ReadonlyMap<string, number>,
    agents: readonly { id: string; idleSince?: number }[]
): string | undefined {
    let best: { id: string; idleSince?: number } | undefined;
    for (const a of agents) {
        if (!unread.has(a.id)) {
            continue;
        }
        if (best == null || (a.idleSince ?? 0) > (best.idleSince ?? 0)) {
            best = a;
        }
    }
    return best?.id;
}

/** Pure: a count as a badge shows it, capped so the badge stays one small circle. */
export function unreadLabel(n: number): string {
    return n > 9 ? "9+" : String(n);
}

/** Pure: the agents whose terminal is on screen. Nothing while the window is not focused (arcterm behind another app
 *  shows you nothing); otherwise only on the Agent surface with its terminal centre: the focused agent, and every cell
 *  of the grid when the focused agent is one of them (the grid then shows them all). */
export function viewingIds(
    windowFocused: boolean,
    onAgentSurface: boolean,
    center: CenterMode,
    focusId: string | undefined,
    grid: GridState
): Set<string> {
    if (!windowFocused || !onAgentSurface || center !== "terminal" || focusId == null) {
        return new Set();
    }
    return grid.ids.includes(focusId) ? new Set(grid.ids) : new Set([focusId]);
}

/** Pure: two unread maps hold the same ids with the same counts. */
export function sameCounts(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [id, n] of a) {
        if (b.get(id) !== n) {
            return false;
        }
    }
    return true;
}
