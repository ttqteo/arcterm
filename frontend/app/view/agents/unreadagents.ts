// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: how many turns each agent finished while you were not looking, for the Agent surface's nav badge and the
// count on a sidebar row. Each move from working to idle out of view adds one, so an agent that goes back to work
// unseen keeps its count and the next finish adds to it. It is read once it is in view (viewingIds), or once it asks,
// which the Cockpit's attention badge already counts. An agent that left the roster is dropped. No React, no store.

import type { CenterMode } from "./agentcenter";
import type { GridState } from "./agentgrid";
import type { AgentState } from "./agentsviewmodel";

export interface UnreadAgent {
    id: string;
    state: AgentState;
}

/** Pure: the unread counts after one roster snapshot, `prevStates` being each agent's state in the snapshot before.
 *  Only agents with a count are in the map. */
export function nextUnread(
    prev: ReadonlyMap<string, number>,
    prevStates: ReadonlyMap<string, AgentState>,
    agents: readonly UnreadAgent[],
    viewing: ReadonlySet<string>
): Map<string, number> {
    const out = new Map<string, number>();
    for (const a of agents) {
        if (viewing.has(a.id) || a.state === "asking") {
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

/** Pure: a count as a badge shows it, capped so the badge stays one small circle. */
export function unreadLabel(n: number): string {
    return n > 9 ? "9+" : String(n);
}

/** Pure: the agents whose terminal is on screen. Only on the Agent surface with its terminal centre: the focused
 *  agent, and every cell of the grid when the focused agent is one of them (the grid then shows them all). */
export function viewingIds(
    onAgentSurface: boolean,
    center: CenterMode,
    focusId: string | undefined,
    grid: GridState
): Set<string> {
    if (!onAgentSurface || center !== "terminal" || focusId == null) {
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
