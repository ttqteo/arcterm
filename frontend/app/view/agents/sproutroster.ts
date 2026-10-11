// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agents Sprout's two lists show (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2): the float's tabs,
// on the ledge under the terminal, and the folded Sprout's hover list. Pure.

import type { AgentState, AgentVM } from "./agentsviewmodel";
import { NO_LINEAGE, type Lineage } from "./runlineage";

export interface RosterCut {
    shown: AgentVM[];
    // how many there are past the cut ("+N")
    more: number;
}

// tabs, not dots: past five the names get too short to read in a float
export const FLOAT_TAB_MAX = 5;
export const FOLDED_LIST_MAX = 4;

// a run's workers and stage sessions, which the Agent tree nests under the run's lead (agenttreemodel.ts buildAgentTree)
function nestedInRun(a: AgentVM, lineage: Lineage): boolean {
    const role = lineage.roles[a.id];
    return (role?.kind === "worker" || role?.kind === "stage") && lineage.runs[role.leadRunId] != null;
}

// the agents the lists name: the tree's top level, so a run shows as its lead rather than as every session it spawned,
// and the one in view (keepId) whatever it is
function topLevel(agents: readonly AgentVM[], lineage: Lineage, keepId: string | null): AgentVM[] {
    return agents.filter((a) => a.id === keepId || !nestedInRun(a, lineage));
}

// the top-level agents, led by the terminal in view when a terminal is what floats
function roster(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    lineage: Lineage
): AgentVM[] {
    const term = focusId == null ? undefined : terminals.find((t) => t.id === focusId);
    const top = topLevel(agents, lineage, focusId);
    return term != null && !agents.some((x) => x.id === term.id) ? [term, ...top] : top;
}

// cut at max, keeping keepId among those shown: past the cut, it takes the last place
function cut(list: AgentVM[], max: number, keepId: string | null): RosterCut {
    if (list.length <= max) {
        return { shown: list, more: 0 };
    }
    const shown = list.slice(0, max);
    const kept = keepId == null ? -1 : list.findIndex((x) => x.id === keepId);
    if (kept >= max) {
        shown[max - 1] = list[kept];
    }
    return { shown, more: list.length - max };
}

export interface FloatTabs {
    shown: AgentVM[];
    // past the cut, for the +N menu
    rest: AgentVM[];
}

// every top-level agent in roster order, which stays put as states change so a tab stays where it was, then every
// plain terminal (an agent's own terminal never, nested or not)
function floatTabOrder(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    lineage: Lineage
): AgentVM[] {
    const seen = new Set(agents.map((x) => x.id));
    return [...topLevel(agents, lineage, focusId), ...terminals.filter((t) => !seen.has(t.id))];
}

/** The float's tabs: what Float can switch to, the plain terminals included and a run as its lead, cut at
 *  FLOAT_TAB_MAX with the one in view always among those shown; none when there is nothing to switch to. */
export function floatTabs(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    lineage: Lineage = NO_LINEAGE,
    max = FLOAT_TAB_MAX
): FloatTabs {
    const order = floatTabOrder(agents, terminals, focusId, lineage);
    if (order.length < 2) {
        return { shown: [], rest: [] };
    }
    const { shown } = cut(order, max, focusId);
    const kept = new Set(shown.map((x) => x.id));
    return { shown, rest: order.filter((x) => !kept.has(x.id)) };
}

/** Ctrl+Tab (delta 1) or Ctrl+Shift+Tab (-1) in a float: the tab beside the one in view, wrapping at the ends and
 *  reaching past the cut; null with nowhere else to go. */
export function stepFloatTab(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    delta: 1 | -1,
    lineage: Lineage = NO_LINEAGE
): string | null {
    const ids = floatTabOrder(agents, terminals, focusId, lineage).map((x) => x.id);
    if (ids.length < 2) {
        return null;
    }
    const at = focusId == null ? -1 : ids.indexOf(focusId);
    return ids[(at + delta + ids.length) % ids.length];
}

const URGENCY: Record<AgentState, number> = { asking: 0, working: 1, idle: 2 };

/** The folded Sprout's list: what needs you first, then what works, then the rest, each in roster order, a run as its
 *  lead, cut at four so nothing that waits on you hides behind "+N". */
export function foldedList(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    lineage: Lineage = NO_LINEAGE,
    max = FOLDED_LIST_MAX
): RosterCut {
    const ranked = roster(agents, terminals, focusId, lineage)
        .map((agent, i) => ({ agent, i }))
        .sort((p, q) => URGENCY[p.agent.state] - URGENCY[q.agent.state] || p.i - q.i)
        .map((r) => r.agent);
    return cut(ranked, max, null);
}

/** How many agents are working now: the count beside Sprout's "…" in Float and folded. */
export function workingCount(agents: readonly AgentVM[]): number {
    return agents.reduce((n, a) => (a.state === "working" ? n + 1 : n), 0);
}
