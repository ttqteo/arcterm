// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure glue for CockpitSurface and the Agent surface: dismissal keying, the roster load phase, which agent the
// Agent surface shows, the recently-idle grace-window split, and a generic set toggle. Extracted so the
// surfaces' orchestration decisions are unit-testable without rendering the grid.

import { gridFallbackFocus, gridHold, pruneMissing, type GridState } from "./agentgrid";
import { isRecentlyIdle, type AgentVM } from "./agentsviewmodel";
import type { LoadPhase } from "./loadphase";
import { roleRunId, type Lineage } from "./runlineage";

// a just-finished agent's dismissal is keyed by idle episode (id:idleSince) so a later re-idle re-shows it.
export function dismissKey(agent: Pick<AgentVM, "id" | "idleSince">): string {
    return `${agent.id}:${agent.idleSince ?? ""}`;
}

// An empty roster is only "no agents" once it has been read; before that it is still loading. Agents that
// are already there always show, whatever the seed state.
export function rosterLoadPhase(seeded: boolean, agentCount: number): LoadPhase {
    if (agentCount > 0) {
        return "ready";
    }
    return seeded ? "empty" : "loading";
}

export interface ShownAgentInput<T extends { id: string }> {
    focused: T | undefined; // what focusIdAtom names: an agent, a terminal, or a done worker (undefined when nothing is)
    agents: readonly T[];
    terminals: readonly T[];
    firstInOrder: string | undefined; // the roster's first agent in display order (orderAtom)
    grid: GridState; // the saved grid, as stored
    eligible: ReadonlySet<string>; // live agents that have a terminal (gridstore eligibleIds)
    seeded: boolean; // the roster has been read once (rosterSeededAtom)
}

export interface ShownAgent<T> {
    agent: T | undefined;
    hold: boolean; // loading with a saved grid none of whose cells has arrived: show nothing yet
}

// The agent the Agent surface shows. The focused one wins. With nothing in focus (a launch, or the focused agent
// just exited) it is, in order: the grid's focused cell, else the grid's first live cell, then the roster's first
// agent in order, then agents[0], then terminals[0] (a plain terminal only when there is no agent). The grid comes
// before the roster so the surface resumes on a saved cell rather than on an agent the focus rule would then swap
// into one. Once the roster is read the grid is pruned first, so a cell whose agent exited hands over to its
// neighbour; before that the raw grid is used, since pruning it would drop cells that have not arrived yet.
export function resolveShownAgent<T extends { id: string }>(input: ShownAgentInput<T>): ShownAgent<T> {
    const { focused, agents, terminals, firstInOrder, grid, eligible, seeded } = input;
    if (focused != null) {
        return { agent: focused, hold: false };
    }
    if (gridHold(grid, eligible, seeded)) {
        return { agent: undefined, hold: true };
    }
    const fromGrid = gridFallbackFocus(seeded ? pruneMissing(grid, eligible) : grid, eligible);
    const agent =
        agents.find((a) => a.id === fromGrid) ?? agents.find((a) => a.id === firstInOrder) ?? agents[0] ?? terminals[0];
    return { agent, hold: false };
}

// within-grace idle agents keep their full row (recently); dismissed or aged-out ones park in the idle list.
export function splitRecentlyIdle(
    idle: AgentVM[],
    now: number,
    dismissed: Set<string>
): { recently: AgentVM[]; parked: AgentVM[] } {
    const recently = idle.filter((a) => isRecentlyIdle(a, now) && !dismissed.has(dismissKey(a)));
    const recentIds = new Set(recently.map((a) => a.id));
    const parked = idle.filter((a) => !recentIds.has(a.id));
    return { recently, parked };
}

// a card body shows the narration feed, an ask, or a working activity line. an agent with none of them (just
// launched and not yet prompted, or idle without ever writing a transcript entry) is an empty card, so it stays
// off the grid until one arrives; its terminal is still in the Agent surface.
export function cardHasContent(agent: AgentVM, hasEntries: boolean): boolean {
    return (
        hasEntries ||
        (agent.previousInfo?.length ?? 0) > 0 ||
        agent.state === "asking" ||
        (agent.state === "working" && !!agent.activity)
    );
}

// the plain agents the grid leaves off, which the counts skip too. a run's lead and workers are rows on the run
// card, so they are never hidden; the membership test is buildGridCards' own.
export function hiddenAgentIds(agents: AgentVM[], idsWithEntries: Set<string>, lineage: Lineage): Set<string> {
    const hidden = new Set<string>();
    for (const a of agents) {
        const role = lineage.roles[a.id];
        const inRun = role != null && lineage.runs[roleRunId(role)] != null;
        if (!inRun && !cardHasContent(a, idsWithEntries.has(a.id))) {
            hidden.add(a.id);
        }
    }
    return hidden;
}

export function toggleInSet(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    return next;
}
