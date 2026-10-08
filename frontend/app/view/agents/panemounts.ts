// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which terminal panes the Agent surface mounts, as pure data. Mounting a pane builds its xterm, fetches the block's
// stored output and replays it, so mounting every agent and terminal the app loads with at once stalled the first
// load. A pane the surface first sees (the app's agents and terminals) mounts the first time it shows: a grid cell or
// the dock. A pane that opens after that (a launch, a new terminal, `wsh run`) mounts at once, shown or not, as every
// pane used to, so its shell's marks (busy, last command) and its scrollback for `wsh termscrollback` keep working
// while it is hidden. Either way a mounted pane stays mounted until its terminal closes: a pane is never remounted,
// which would replay its TUI. No React and no atoms: agentsurface.tsx keeps the value and draws it.

export interface PaneMounts {
    // the ids whose pane is mounted
    readonly mounted: ReadonlySet<string>;
    // the ids with a pane as of the last render, so an id missing from it is one that just opened
    readonly seen: ReadonlySet<string>;
    // a render with the roster seeded has been taken in: the panes after it are not the first load's
    readonly settled: boolean;
}

export const NO_PANES: PaneMounts = { mounted: new Set(), seen: new Set(), settled: false };

// The mounts after one render: `live` is every id with a pane to mount (an agent or terminal with a block), `shown`
// the ids the surface draws (shown ids with no pane are skipped), `seeded` whether the roster's first load is done.
// Returns `prev` itself when nothing changed, so the surface can store the result during render without looping.
export function nextPaneMounts(
    prev: PaneMounts,
    input: { live: readonly string[]; shown: readonly string[]; seeded: boolean }
): PaneMounts {
    const live = new Set(input.live);
    const mounted = new Set<string>();
    for (const id of prev.mounted) {
        if (live.has(id)) {
            mounted.add(id);
        }
    }
    for (const id of input.shown) {
        if (live.has(id)) {
            mounted.add(id);
        }
    }
    if (prev.settled) {
        for (const id of live) {
            if (!prev.seen.has(id)) {
                mounted.add(id);
            }
        }
    }
    const settled = prev.settled || input.seeded;
    if (settled === prev.settled && sameSet(mounted, prev.mounted) && sameSet(live, prev.seen)) {
        return prev;
    }
    return { mounted, seen: live, settled };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const id of a) {
        if (!b.has(id)) {
            return false;
        }
    }
    return true;
}
