// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The order the Agent surface puts its cell wrappers in the DOM, as pure data. Where a cell shows is its inline
// gridRow / gridColumn, never its place among its siblings, so the order only has to stay put: a wrapper React moves
// (insertBefore) is taken out of the document and put back, and that resets every scroll box inside it to the top, a
// Chat being read and an xterm's viewport alike. Built from the roster as `[...agents, ...terminals]`, the order moved
// whenever a tab changed list: a launch is a terminal until its harness reports, then an agent, and if it sorts before
// the agent being read, React moved that agent's cell and its Chat jumped to the top. So a tab keeps its place for as
// long as it lives, and one that opens goes after the rest. No React and no atoms: agentsurface.tsx keeps the value.

// The order after one render: `prev` with the ids no longer live dropped, then the live ids it lacks, in `live`'s order.
// Returns `prev` itself when nothing changed, so the surface can store the result during render without looping.
export function nextCellOrder(prev: readonly string[], live: readonly string[]): readonly string[] {
    const liveSet = new Set(live);
    const kept = prev.filter((id) => liveSet.has(id));
    const keptSet = new Set(kept);
    const added = live.filter((id) => !keptSet.has(id));
    if (added.length === 0 && kept.length === prev.length) {
        return prev;
    }
    return [...kept, ...added];
}
