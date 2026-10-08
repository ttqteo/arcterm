// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the Consumers panel's rows. Joins a GetConsumersCommand reading with the roster, sorts by RAM or by tokens of
// the window, groups a run's workers under their run, and marks what to warn about and which actions a row offers.
// consumerspanel.tsx draws it. No React, no store.

import type { AgentState, AgentVM } from "./agentsviewmodel";
import { fmtClock } from "./runcompletion";
import { aggregateSessionUsage, type SessionUsage } from "./sessionusage";
import { formatGB } from "./workercapacity";

export type ConsumersSort = "ram" | "tokens";

// past this many tokens in the window (cache reads left out), the busiest agent gets the burn warning
export const BURN_WARN_TOKENS = 500_000;

// The panel's token count: every class but cache reads, which re-read the same context at a tenth of input's price
// and would put nearly every working agent past BURN_WARN_TOKENS (spec decision 3). The cost still prices them.
function countedTokens(u: SessionUsage): number {
    return u.classes.reduce((n, c) => (c.cls === "cacheRead" ? n : n + c.tokens), 0);
}

// the roster's state dots (runstrip.ts SEG_FILL's colors)
export const STATE_DOT: Record<AgentState, string> = {
    working: "bg-accent",
    asking: "bg-warning",
    idle: "bg-muted",
};

export interface ConsumerRow {
    id: string; // tab id
    name: string;
    project?: string;
    state: AgentState;
    model?: string; // short family label ("opus")
    ramBytes?: number;
    tokens?: number; // tokens of the window, cache reads left out (countedTokens)
    spendUsd?: number; // their client-side cost estimate, as the rail prices it
    opus: boolean; // a Claude agent on Opus
    burn: boolean; // the busiest agent, past BURN_WARN_TOKENS
    canSonnet: boolean;
    dag?: ConsumerDag; // a run worker's task, for Stop
    vm: AgentVM;
}

export interface ConsumerGroup {
    key: string; // the owner run id, or "agents" for the agents you opened
    label?: string; // "Run 85548d0b"
    rows: ConsumerRow[];
}

export interface OwnUsage {
    label: "Interface" | "Server" | "Host" | "Terminals";
    bytes?: number;
}

export interface ConsumersView {
    freeBytes: number;
    totalBytes: number;
    groups: ConsumerGroup[];
    own: OwnUsage[];
    appBytes?: number; // the whole app: its own processes and every agent; absent while nothing is read
}

// what the reading counted, or undefined when it counted nothing
function sumRead(values: (number | undefined)[]): number | undefined {
    const read = values.filter((v): v is number => v !== undefined);
    return read.length === 0 ? undefined : read.reduce((a, b) => a + b, 0);
}

function weight(r: ConsumerRow, sort: ConsumersSort): number | undefined {
    return sort === "ram" ? r.ramBytes : r.tokens;
}

// heaviest first; an unread value after every read one; ties by name
function byWeight(sort: ConsumersSort) {
    return (a: ConsumerRow, b: ConsumerRow): number => {
        const wa = weight(a, sort);
        const wb = weight(b, sort);
        if (wa === undefined || wb === undefined) {
            if (wa !== wb) {
                return wa === undefined ? 1 : -1;
            }
        } else if (wa !== wb) {
            return wb - wa;
        }
        return a.name.localeCompare(b.name);
    };
}

export function buildConsumers(
    data: CommandGetConsumersRtnData,
    agents: AgentVM[],
    sort: ConsumersSort
): ConsumersView {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const rows: ConsumerRow[] = [];
    for (const c of data.agents ?? []) {
        const vm = byId.get(c.tabid);
        if (vm == null) {
            continue; // the roster has not seen it yet: nothing to name it by or open
        }
        const usage = c.tokensread ? aggregateSessionUsage(c.tokens ?? []) : undefined;
        const opus = vm.agent === "claude" && vm.model === "opus";
        rows.push({
            id: vm.id,
            name: vm.name,
            project: vm.project,
            state: vm.state,
            model: vm.model,
            ramBytes: c.rambytes,
            tokens: usage === undefined ? undefined : countedTokens(usage),
            spendUsd: usage?.totalSpendUsd,
            opus,
            burn: false,
            canSonnet: opus,
            dag: c.dag,
            vm,
        });
    }
    const busiest = [...rows].filter((r) => r.tokens !== undefined).sort(byWeight("tokens"))[0];
    if (busiest != null && (busiest.tokens ?? 0) > BURN_WARN_TOKENS) {
        busiest.burn = true;
    }
    const groups = new Map<string, ConsumerGroup>();
    for (const r of rows) {
        const key = r.dag?.runid ?? "agents";
        const g = groups.get(key) ?? { key, label: r.dag ? `Run ${r.dag.runid.slice(0, 8)}` : undefined, rows: [] };
        g.rows.push(r);
        groups.set(key, g);
    }
    const ordered = [...groups.values()];
    for (const g of ordered) {
        g.rows.sort(byWeight(sort));
    }
    ordered.sort((a, b) => byWeight(sort)(a.rows[0], b.rows[0]));
    const own: OwnUsage[] = [
        { label: "Interface", bytes: data.interfacebytes },
        { label: "Server", bytes: data.serverbytes },
        { label: "Host", bytes: data.hostbytes },
        { label: "Terminals", bytes: data.terminalsbytes },
    ];
    return {
        freeBytes: data.availablebytes,
        totalBytes: data.totalbytes,
        groups: ordered,
        own,
        // Own leaves the agents out (Terminals is wavesrv's tree minus them), so they are added back, one the roster
        // has not seen yet included: it is still RAM the app holds
        appBytes: sumRead([...own.map((o) => o.bytes), ...(data.agents ?? []).map((c) => c.rambytes)]),
    };
}

/** Keeps the rows where they were while the panel stays open: a new reading does not move a row. `held` is the row
 * ids in the order the panel first drew them (null on open: the view's own ranking is kept). A row not in `held` (an
 * agent that started since) goes after the held ones of its group, a new group after the held groups, both in the
 * view's ranking. Returns the view in that order and the order to hold next. */
export function holdOrder(view: ConsumersView, held: string[] | null): { view: ConsumersView; order: string[] } {
    const flat = (groups: ConsumerGroup[]) => groups.flatMap((g) => g.rows.map((r) => r.id));
    if (held == null) {
        return { view, order: flat(view.groups) };
    }
    const at = new Map(held.map((id, i) => [id, i]));
    // a stable sort keeps the view's ranking among the rows `held` does not know
    const pos = (id: string) => at.get(id) ?? Infinity;
    const byHeld = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
    const groups = view.groups.map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => byHeld(pos(a.id), pos(b.id))) }));
    const first = (g: ConsumerGroup) => Math.min(...g.rows.map((r) => pos(r.id)));
    groups.sort((a, b) => byHeld(first(a), first(b)));
    return { view: { ...view, groups }, order: flat(groups) };
}

/** "300 MB" under a gigabyte, "2.5 GB" above. */
export interface Box {
    top: number;
    bottom: number;
    right: number;
}

export interface Placement {
    right: number;
    top?: number;
    bottom?: number;
    origin: "top right" | "bottom right";
}

export const PANEL_WIDTH = 580;
const PANEL_GAP = 6; // between the opener and the panel
const PANEL_MARGIN = 8; // the nearest it comes to the window's edge

/** Where the panel hangs: its right edge on its opener's right edge, above an opener in the window's lower half (the
 * footer) and below one in the upper half, kept inside the window. No opener (opened from code) keeps the footer's
 * right end. */
export function panelPlacement(opener: Box | null, view: { width: number; height: number }): Placement {
    if (opener == null) {
        return { right: 16, bottom: 42, origin: "bottom right" };
    }
    const widest = Math.max(PANEL_MARGIN, view.width - PANEL_WIDTH - PANEL_MARGIN);
    const right = Math.min(Math.max(view.width - opener.right, PANEL_MARGIN), widest);
    return opener.top > view.height / 2
        ? { right, bottom: view.height - opener.top + PANEL_GAP, origin: "bottom right" }
        : { right, top: opener.bottom + PANEL_GAP, origin: "top right" };
}

export function ramLabel(bytes: number): string {
    return bytes < 2 ** 30 ? `${Math.round(bytes / 2 ** 20)} MB` : formatGB(bytes);
}

/** The confirm a worker's Stop asks (spec decision 8). Only called for a row with a dag: a worker's tab is named for
 * its project, so the task id is what tells two workers apart. */
export function stopWorkerMessage(row: ConsumerRow): string {
    const dag = row.dag as ConsumerDag;
    return `Stop worker ${dag.taskid} of run ${dag.runid.slice(0, 8)}? Its task stops and is not retried; tasks after it wait until you Retry or Skip it in the run.`;
}

/** The toast after → Sonnet: the switch lands now unless the session was mid-turn and /model waits for the turn. */
export function switchToastText(name: string, midTurn: boolean, appliesMidTurn: boolean): string {
    return midTurn && !appliesMidTurn ? `${name} switches to Sonnet from its next turn` : `${name} switched to Sonnet`;
}

/** The line over a dimmed panel whose last poll failed. */
export function staleLine(lastOkMs: number | null): string {
    return lastOkMs == null ? "Couldn't read usage" : `Couldn't read usage · last at ${fmtClock(lastOkMs)}`;
}
