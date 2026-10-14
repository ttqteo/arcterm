// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a plan-review attention item opens: the agent that works the initiative while one is still open, else the
// initiative. One resolver, so the Needs you strip, the Brief's queue, the palette and Sprout's peek all land the
// same place. Pure: no React, no Wave runtime imports.

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { openAgentFor } from "./initiativework";

/** Pure: the live agent a plan-review item is about, or undefined for any other kind, an item that names no
 *  initiative, or an initiative no agent is open on. "The session on this initiative" is openAgentFor's rule: a run's
 *  agents and plain terminals are not it, and among the rest the one that needs you, then the busy one, then the most
 *  recently idle wins, so with several open the newest is the one that opens. */
export function planReviewAgent(item: AttentionItem, roster: ReadonlyArray<AgentVM>): AgentVM | undefined {
    if (item?.kind !== "plan-review" || !item.effortoid) {
        return undefined;
    }
    return openAgentFor(item.effortoid, [...roster]);
}

/** Pure: the oref a plan-review item opens: `agent:<id>` when its agent is still open, else the item's own (the
 *  initiative). */
export function planReviewORef(item: AttentionItem, roster: ReadonlyArray<AgentVM>): string {
    const agent = planReviewAgent(item, roster);
    return agent != null ? `agent:${agent.id}` : (item.oref ?? "");
}
