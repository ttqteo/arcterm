// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agents Sprout's two lists show (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2): the float bar's
// switcher, one dot an agent, and the folded Sprout's hover list. Pure.

import type { AgentState, AgentVM } from "./agentsviewmodel";

export interface RosterCut {
    shown: AgentVM[];
    // how many there are past the cut ("+N")
    more: number;
}

export const SWITCHER_MAX = 6;
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

/** The float bar's switcher: roster order, which stays put as states change, so a dot stays where it was; the agent in
 *  view is always among the dots. */
export function switcherAgents(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    max = SWITCHER_MAX
): RosterCut {
    return cut(roster(agents, terminals, focusId), max, focusId);
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
