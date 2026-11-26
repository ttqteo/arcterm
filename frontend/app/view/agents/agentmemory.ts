// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The last value each agent's read produced, kept by agent id across focus changes. The rail's focused-agent stores
// (git state, session usage, cache status) show an agent's remembered value at once when it is focused again and
// re-read in the background, instead of blanking to a skeleton on every switch. Nothing renders from it, so it is a
// plain map, not an atom. retainAgentMemories drops what belongs to agents that left the roster.

export interface AgentMemory<T> {
    get(id: string): T | undefined;
    set(id: string, value: T): void;
    delete(id: string): void;
}

const memories: Map<string, unknown>[] = [];

export function agentMemory<T>(): AgentMemory<T> {
    const m = new Map<string, T>();
    memories.push(m);
    return {
        get: (id) => m.get(id),
        set: (id, value) => void m.set(id, value),
        delete: (id) => void m.delete(id),
    };
}

// Keeps only the entries of live agents (and of keys derived from one, `sub:<id>` for a subagent interior, which go
// with any roster change). An empty roster is the boot window before the roster loads, not every agent gone.
export function retainAgentMemories(liveIds: ReadonlySet<string>): void {
    if (liveIds.size === 0) {
        return;
    }
    for (const m of memories) {
        for (const id of m.keys()) {
            if (!liveIds.has(id)) {
                m.delete(id);
            }
        }
    }
}
