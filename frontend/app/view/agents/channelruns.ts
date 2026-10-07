// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The active channel's run list is kept by difference: the store sends the version it holds of each run and
// gets back the channel's run ids plus only the rows that are new or changed. These two functions are the
// two halves of that exchange.

// what the list holds, as the server compares it: run id -> row version
export function knownRunVersions(runs: Run[]): Record<string, number> {
    return Object.fromEntries(runs.map((r) => [r.id, r.version]));
}

// The list after a refresh: the runs still in the channel, each replaced by its changed row when one came
// back, in createdts order. Returns `current` itself when nothing moved, so an unchanged list does not
// re-render its readers.
export function mergeRunChanges(current: Run[], runIds: string[], changed: Run[]): Run[] {
    const members = new Set(runIds);
    if (changed.length === 0 && current.length === members.size && current.every((r) => members.has(r.id))) {
        return current;
    }
    const byId = new Map(current.map((r) => [r.id, r]));
    for (const r of changed) {
        byId.set(r.id, r);
    }
    return [...byId.values()].filter((r) => members.has(r.id)).sort((a, b) => a.createdts - b.createdts);
}
