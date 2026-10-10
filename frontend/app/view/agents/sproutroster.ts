// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agents Sprout's two lists show (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2): the float's tabs,
// on the ledge under the terminal, and the folded Sprout's hover list. Pure.

import type { AgentState, AgentVM } from "./agentsviewmodel";

export interface RosterCut {
    shown: AgentVM[];
    // how many there are past the cut ("+N")
    more: number;
}

// tabs, not dots: past five the names get too short to read in a float
export const FLOAT_TAB_MAX = 5;
export const FOLDED_LIST_MAX = 4;

// the agents, led by the terminal in view when a terminal is what floats
function roster(agents: readonly AgentVM[], terminals: readonly AgentVM[], focusId: string | null): AgentVM[] {
    const term = focusId == null ? undefined : terminals.find((t) => t.id === focusId);
    return term != null && !agents.some((x) => x.id === term.id) ? [term, ...agents] : [...agents];
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

// every agent in roster order, which stays put as states change so a tab stays where it was, then every plain terminal
function floatTabOrder(agents: readonly AgentVM[], terminals: readonly AgentVM[]): AgentVM[] {
    const seen = new Set(agents.map((x) => x.id));
    return [...agents, ...terminals.filter((t) => !seen.has(t.id))];
}

/** The float's tabs: what Float can switch to, the plain terminals included, cut at FLOAT_TAB_MAX with the one in view
 *  always among those shown; none when there is nothing to switch to. */
export function floatTabs(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    max = FLOAT_TAB_MAX
): FloatTabs {
    const order = floatTabOrder(agents, terminals);
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
    delta: 1 | -1
): string | null {
    const ids = floatTabOrder(agents, terminals).map((x) => x.id);
    if (ids.length < 2) {
        return null;
    }
    const at = focusId == null ? -1 : ids.indexOf(focusId);
    return ids[(at + delta + ids.length) % ids.length];
}

const URGENCY: Record<AgentState, number> = { asking: 0, working: 1, idle: 2 };

/** The folded Sprout's list: what needs you first, then what works, then the rest, each in roster order, cut at four so
 *  nothing that waits on you hides behind "+N". */
export function foldedList(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    max = FOLDED_LIST_MAX
): RosterCut {
    const ranked = roster(agents, terminals, focusId)
        .map((agent, i) => ({ agent, i }))
        .sort((p, q) => URGENCY[p.agent.state] - URGENCY[q.agent.state] || p.i - q.i)
        .map((r) => r.agent);
    return cut(ranked, max, null);
}

/** How many agents are working now: the count beside Sprout's "…" in Float and folded. */
export function workingCount(agents: readonly AgentVM[]): number {
    return agents.reduce((n, a) => (a.state === "working" ? n + 1 : n), 0);
}
