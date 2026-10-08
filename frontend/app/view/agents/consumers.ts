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
    return {
        freeBytes: data.availablebytes,
        totalBytes: data.totalbytes,
        groups: ordered,
        own: [
            { label: "Interface", bytes: data.interfacebytes },
            { label: "Server", bytes: data.serverbytes },
            { label: "Host", bytes: data.hostbytes },
            { label: "Terminals", bytes: data.terminalsbytes },
        ],
    };
}

/** "300 MB" under a gigabyte, "2.5 GB" above. */
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
