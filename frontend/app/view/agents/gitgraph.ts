// frontend/app/view/agents/gitgraph.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Lane assignment for a commit graph. Pure: takes commits newest-first with parent SHAs and decides
// which vertical lane each one occupies. Geometry (coordinates, paths, folding) is gitgraphgeom.ts.

export interface GraphCommit {
    hash: string;
    parents: string[];
    // set on the synthetic uncommitted row, which sits above the tip with HEAD as its only parent
    workingTree?: boolean;
    // a labelled separator drawn below this row (agent session start, run base)
    divider?: string;
    // dimmed: context from before the scope's anchor
    before?: boolean;
    // the range's root on a scoped list (the rail's merge base or session start): not a commit of the range, drawn grey
    boundary?: boolean;
}

export interface LanedRow extends GraphCommit {
    lane: number;
    merge: boolean;
}

// A lane slot holds the hash it is waiting to draw next, or null when free. Reusing freed slots is
// what keeps a wide history from drifting rightwards forever.
type Slots = (string | null)[];

function claim(slots: Slots, hash: string): number {
    const existing = slots.indexOf(hash);
    if (existing !== -1) {
        return existing;
    }
    const free = slots.indexOf(null);
    if (free !== -1) {
        slots[free] = hash;
        return free;
    }
    slots.push(hash);
    return slots.length - 1;
}

// Generic in the commit type so callers that carry display fields (subject, author, refs) get them
// back on the laned rows instead of having them erased to GraphCommit.
export function assignLanes<T extends GraphCommit>(commits: T[]): (T & { lane: number; merge: boolean })[] {
    const slots: Slots = [];
    const rows: (T & { lane: number; merge: boolean })[] = [];
    for (const commit of commits) {
        let lane = slots.indexOf(commit.hash);
        if (lane === -1) {
            const free = slots.indexOf(null);
            lane = free !== -1 ? free : slots.length;
        }
        slots[lane] = commit.hash;
        // any lane further right waiting on this same commit merges into `lane` and frees up
        for (let i = lane + 1; i < slots.length; i++) {
            if (slots[i] === commit.hash) {
                slots[i] = null;
            }
        }
        rows.push({ ...commit, lane, merge: commit.parents.length > 1 });
        if (commit.parents.length === 0) {
            slots[lane] = null;
        } else {
            // the first parent continues down this lane; the rest take their own
            slots[lane] = commit.parents[0];
            for (let i = 1; i < commit.parents.length; i++) {
                claim(slots, commit.parents[i]);
            }
        }
        while (slots.length > 0 && slots[slots.length - 1] === null) {
            slots.pop();
        }
    }
    return rows;
}

export function laneCount(rows: LanedRow[]): number {
    return rows.reduce((max, r) => Math.max(max, r.lane + 1), 0);
}
