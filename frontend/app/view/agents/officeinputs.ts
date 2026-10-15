// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Cockpit office draws (cockpit office spec, "Where it lives"): the grid's cards and the Idle section's
// agents, as the floor plan's input. Pure.

import { projectOf, type AgentVM } from "./agentsviewmodel";
import type { GridCard } from "./cardgridlayout";
import type { LeadCardVM } from "./leadcardmodel";
import type { PlanAgent, PlanRun } from "./officeplanmodel";
import { runFinished, taskAgentOf, type Lineage } from "./runlineage";

export function planAgent(a: AgentVM, finished: boolean): PlanAgent {
    return {
        id: a.id,
        name: a.name,
        project: projectOf(a) || undefined,
        state: a.state,
        idleSince: a.idleSince,
        finished,
        harness: a.agent,
    };
}

export function officeInputs(
    cards: GridCard[],
    parked: AgentVM[],
    leadVMs: Map<string, LeadCardVM>,
    roster: AgentVM[],
    lineage: Lineage
): { agents: PlanAgent[]; runs: PlanRun[] } {
    const agents: PlanAgent[] = [];
    const runs: PlanRun[] = [];
    for (const c of cards) {
        if (c.kind === "agent") {
            // an idle card is in the Finished window: past it the grid parks the agent in the Idle section
            agents.push(planAgent(c.agent, c.agent.state === "idle"));
            continue;
        }
        const vm = leadVMs.get(c.id);
        const rows = vm ? [...vm.rows, ...vm.waiting, ...vm.done] : [];
        runs.push({
            id: c.id,
            title: c.run.title,
            project: c.run.project || undefined,
            createdTs: c.run.createdTs,
            done: runFinished(c.run),
            leadAsking: c.lead?.state === "asking",
            tasks: (c.run.dag?.tasks ?? []).map((t) => {
                const worker = taskAgentOf(lineage, roster, c.run.runId, t.id);
                return {
                    id: t.id,
                    label: t.label || t.id,
                    state: t.state,
                    asking: worker?.state === "asking",
                    key: rows.find((r) => r.taskId === t.id)?.key,
                    workerId: worker?.id,
                };
            }),
        });
    }
    const shown = new Set(agents.map((a) => a.id));
    for (const a of parked) {
        if (!shown.has(a.id)) {
            agents.push(planAgent(a, false));
        }
    }
    return { agents, runs };
}
