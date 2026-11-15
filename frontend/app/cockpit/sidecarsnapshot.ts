// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The roster → SidecarSnapshot rule (spec 2026-11-13-sidecar-design.md, sections 2 and 3). Pure: the bridge passes in
// what it read from the stores. The three signatures are the contract Tasks 4-7 build against; the bodies below are
// stubs, and Task 4 fills them.

import type { AgentEntry, AgentVM } from "@/app/view/agents/agentsviewmodel";
import type { SidecarMessage, SidecarSnapshot } from "./sidecartypes";

/** The rows of one tile from an agent's entries: each message with the tool it ran, at most `max`, newest last. TODO(Task 4). */
export function messageRows(entries: AgentEntry[], max: number): SidecarMessage[] {
    void entries;
    void max;
    return [];
}

/**
 * The snapshot of the whole roster: tiles in order (asking, working, review, idle, asleep), the title-bar counts, and
 * for an agent with no rows from its entries, the rows it last had (`kept`). TODO(Task 4).
 */
export function sidecarSnapshot(
    agents: AgentVM[],
    entriesById: Record<string, AgentEntry[]>,
    sentIds: ReadonlySet<string>,
    kept: Record<string, SidecarMessage[]>,
    now: number
): SidecarSnapshot {
    void agents;
    void entriesById;
    void sentIds;
    void kept;
    return { now, counts: { asking: 0, working: 0, idle: 0 }, tiles: [] };
}

/** The rows each tile of a snapshot shows, by agent id, for the bridge to keep; tiles with none are left out. TODO(Task 4). */
export function keptMessages(snap: SidecarSnapshot): Record<string, SidecarMessage[]> {
    void snap;
    return {};
}
