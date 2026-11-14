// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agents Sprout's two lists show (docs/superpowers/specs/2026-10-10-jarvis-modes-design.md §2): the float's tabs,
// on the ledge under the terminal, with the ones the person pinned first, and the folded Sprout's hover list. Pure.

import type { AgentState, AgentVM } from "./agentsviewmodel";
import { NO_LINEAGE, type Lineage } from "./runlineage";

export interface RosterCut {
    shown: AgentVM[];
    // how many there are past the cut ("+N")
    more: number;
}

// tabs, not dots: past five the names get too short to read in a float
export const FLOAT_TAB_MAX = 5;
// a tab's least width, the gap between tabs and the tabs' inset on the ledge (float-ledge.tsx: min-w-[44px], gap-1,
// pl-1), and the most "+N" takes
const FLOAT_TAB_MIN = 44;
const FLOAT_TAB_GAP = 4;
const FLOAT_TAB_INSET = 4;
const FLOAT_TAB_MORE = 32;
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

/** One tab of the float's ledge: a row of the Agent tree's top level. A plain agent or terminal is its own tab; a run is
 *  one tab, its lead, or with no lead in the roster the worker that most needs you, named by the run; a brainstorm's
 *  builder check and judge sessions belong to the brainstorming agent's tab. `members` is every agent the tab stands
 *  for, so the tab shows pressed while any of them is in view; `key` is what a pin holds (a run with no lead is pinned
 *  by its run, since the worker standing for it changes). */
export interface FloatTab {
    key: string;
    agent: AgentVM;
    label: string;
    members: string[];
    pinned?: boolean;
}

export interface FloatTabs {
    shown: FloatTab[];
    // past the cut, for the +N menu
    rest: FloatTab[];
}

/** The ledge's tabs uncut and unpinned: the Agent tree's top level in roster order (agenttreemodel.ts buildAgentTree),
 *  which stays put as states change so a tab stays where it was, then every plain terminal (an agent's own terminal
 *  never). */
export function floatTabUnits(agents: readonly AgentVM[], terminals: readonly AgentVM[], lineage: Lineage): FloatTab[] {
    const units: FloatTab[] = [];
    // a run's agents, its lead's first: they all go to one tab, placed where the run's first agent stands
    const byRun = new Map<string, FloatTab>();
    const leadOf = new Map<string, AgentVM>();
    for (const a of agents) {
        const role = lineage.roles[a.id];
        if (role?.kind === "lead" && lineage.runs[role.runId] != null && !leadOf.has(role.runId)) {
            leadOf.set(role.runId, a);
        }
    }
    // a builder check's reviewer or a judge, by its run id: the brainstorming agent that recorded it
    const checkOwner = new Map<string, string>();
    for (const a of agents) {
        if (lineage.roles[a.id] != null) {
            continue;
        }
        for (const record of [a.builderCheck, a.brainstormJudge]) {
            if (record?.runId && !checkOwner.has(record.runId)) {
                checkOwner.set(record.runId, a.id);
            }
        }
    }
    const byAgent = new Map<string, FloatTab>();
    const pendingChecks: [string, AgentVM][] = [];
    for (const a of agents) {
        const role = lineage.roles[a.id];
        const runId = role == null ? undefined : role.kind === "lead" ? role.runId : role.leadRunId;
        if (runId != null && lineage.runs[runId] != null) {
            let unit = byRun.get(runId);
            if (unit == null) {
                const lead = leadOf.get(runId);
                unit =
                    lead != null
                        ? { key: lead.id, agent: lead, label: lead.name, members: [] }
                        : { key: `run:${runId}`, agent: a, label: lineage.runs[runId].title || a.name, members: [] };
                byRun.set(runId, unit);
                units.push(unit);
            }
            unit.members.push(a.id);
            if (leadOf.get(runId) == null && URGENCY[a.state] < URGENCY[unit.agent.state]) {
                unit.agent = a;
            }
            continue;
        }
        const owner = a.runId != null && role == null ? checkOwner.get(a.runId) : undefined;
        if (owner != null && owner !== a.id) {
            pendingChecks.push([owner, a]);
            continue;
        }
        const unit = { key: a.id, agent: a, label: a.name, members: [a.id] };
        byAgent.set(a.id, unit);
        units.push(unit);
    }
    for (const [owner, a] of pendingChecks) {
        const unit = byAgent.get(owner);
        if (unit != null) {
            unit.members.push(a.id);
        } else {
            units.push({ key: a.id, agent: a, label: a.name, members: [a.id] });
        }
    }
    const seen = new Set(agents.map((x) => x.id));
    for (const t of terminals) {
        if (!seen.has(t.id)) {
            units.push({ key: t.id, agent: t, label: t.name, members: [t.id] });
        }
    }
    return units;
}

/** What Ctrl+Tab switches between: the ledge's tabs, each as the agent it opens, with the one in view kept beside its
 *  tab when it is a run's worker or a check the tab stands for; the switcher (tabswitcher.ts) reorders them by recency. */
export function floatTabOrder(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    lineage: Lineage
): AgentVM[] {
    const byId = new Map([...agents, ...terminals].map((x) => [x.id, x] as const));
    const out: AgentVM[] = [];
    for (const unit of floatTabUnits(agents, terminals, lineage)) {
        out.push(unit.agent);
        if (focusId != null && focusId !== unit.agent.id && unit.members.includes(focusId)) {
            const focused = byId.get(focusId);
            if (focused != null) {
                out.push(focused);
            }
        }
    }
    return out;
}

/** The pinned tabs first, in the order they were pinned, then the rest in the ledge's order. */
export function pinFirst(units: readonly FloatTab[], pins: readonly string[]): FloatTab[] {
    const byKey = new Map(units.map((u) => [u.key, u] as const));
    const pinned = pins.flatMap((k) => {
        const u = byKey.get(k);
        return u == null ? [] : [{ ...u, pinned: true }];
    });
    const kept = new Set(pinned.map((u) => u.key));
    return [...pinned, ...units.filter((u) => !kept.has(u.key))];
}

/** A pin list with key pinned or unpinned; a pin whose tab is gone (its agent closed) drops off on any change. */
export function withTabPin(pins: readonly string[], key: string, on: boolean, live: readonly FloatTab[]): string[] {
    const alive = new Set(live.map((u) => u.key));
    const kept = pins.filter((k) => k !== key && alive.has(k));
    return on ? [...kept, key] : kept;
}

/** The stored pin list, or none when it does not parse. */
export function parseTabPins(raw: string | null): string[] {
    try {
        const v: unknown = JSON.parse(raw ?? "[]");
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

// how many of count tabs the ledge holds in room px: all of them when they fit, else as many as fit beside "+N", never
// more than FLOAT_TAB_MAX and never fewer than one, the one in view
function tabsThatFit(room: number, count: number): number {
    const width = (n: number) => FLOAT_TAB_INSET + n * FLOAT_TAB_MIN + (n - 1) * FLOAT_TAB_GAP;
    if (count <= FLOAT_TAB_MAX && width(count) <= room) {
        return count;
    }
    let n = Math.min(count, FLOAT_TAB_MAX);
    while (n > 1 && width(n) + FLOAT_TAB_GAP + FLOAT_TAB_MORE > room) {
        n--;
    }
    return n;
}

/** The float's tabs: the Agent tree's top level and the plain terminals (floatTabUnits), the pinned ones first, cut at
 *  what fits in room (the px the ledge leaves them; unmeasured, FLOAT_TAB_MAX). A pinned tab is never cut, however
 *  little room there is, and the tab of the one in view is always among those shown: past the cut it takes the last
 *  unpinned place, or comes after the pinned ones when they fill the ledge. None only when nothing at all floats. */
export function floatTabs(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    focusId: string | null,
    lineage: Lineage = NO_LINEAGE,
    room = Infinity,
    pins: readonly string[] = []
): FloatTabs {
    const order = pinFirst(floatTabUnits(agents, terminals, lineage), pins);
    if (order.length < 1) {
        return { shown: [], rest: [] };
    }
    const pinnedCount = order.filter((u) => u.pinned).length;
    const n = Math.max(tabsThatFit(room, order.length), pinnedCount);
    const shown = order.slice(0, n);
    const inView = focusId == null ? -1 : order.findIndex((u) => u.members.includes(focusId));
    if (inView >= n) {
        if (n > pinnedCount) {
            shown[n - 1] = order[inView];
        } else {
            shown.push(order[inView]);
        }
    }
    const kept = new Set(shown.map((u) => u.key));
    return { shown, rest: order.filter((u) => !kept.has(u.key)) };
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
