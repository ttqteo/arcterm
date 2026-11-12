// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the RAM an agent row in the sidebar shows (Settings → Appearance → Agent sidebar → RAM). Where the Resource
// Manager runs (Windows) it is the agent's job in its 2-second snapshot: the agent, its plumbing and every command it
// runs. Elsewhere it is the Consumers reading's figure for its block, which agentramstore.ts polls while the field is on.
// agentramstore.ts feeds it; agenttree.tsx draws it.

import { fmtMem } from "@/app/cockpit/resmon";

// the Resource Manager's own group (arcterm's processes), never an agent's
const ARC_KEY = "arc";

/** The bytes an agent's processes hold, or null when no reading names it (no process yet, asleep, not measured). */
export function agentRamBytes(
    blockId: string | undefined,
    snap: ResMonSnapshotData | null,
    consumers: CommandGetConsumersRtnData | null
): number | null {
    if (blockId == null || blockId === "") {
        return null;
    }
    if (snap?.supported) {
        const g = snap.groups.find((x) => x.key !== ARC_KEY && x.ownerid === blockId);
        return g != null && g.mem >= 0 ? g.mem : null;
    }
    const c = consumers?.agents?.find((a) => a.blockid === blockId);
    return c?.rambytes != null && c.rambytes >= 0 ? c.rambytes : null;
}

/** The row's words for it: "412 MB", "1.3 GB", or null for nothing to show. */
export function agentRamLabel(
    blockId: string | undefined,
    snap: ResMonSnapshotData | null,
    consumers: CommandGetConsumersRtnData | null
): string | null {
    const bytes = agentRamBytes(blockId, snap, consumers);
    return bytes == null ? null : fmtMem(bytes);
}

/** A run's words for the RAM all its tabs hold (its lead, workers, reviewers and stage sessions): the sum of the
 * figures the readings name, or null when they name none of them. A tab no reading names adds nothing. */
export function runRamLabel(
    blockIds: string[],
    snap: ResMonSnapshotData | null,
    consumers: CommandGetConsumersRtnData | null
): string | null {
    let sum: number | null = null;
    for (const id of blockIds) {
        const bytes = agentRamBytes(id, snap, consumers);
        if (bytes != null) {
            sum = (sum ?? 0) + bytes;
        }
    }
    return sum == null ? null : fmtMem(sum);
}

/** Whether the rows need the Consumers reading polled: the field is on and the snapshot says the Resource Manager does
 * not run here. Before the first snapshot it is not known yet, so nothing polls. */
export function needsConsumersPoll(ramOn: boolean, snap: ResMonSnapshotData | null): boolean {
    return ramOn && snap != null && !snap.supported;
}
