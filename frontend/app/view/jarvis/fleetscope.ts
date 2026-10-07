// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A record's fleet crosses channels: attribution yields dossier -> run orefs, and workers hang off runs.
// buildFleetSnapshot is per-channel, so this rolls it up over every channel that owns an attributed run
// and dedups by worker oref (one worker can be reached through more than one channel).

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { buildFleetSnapshot, type WorkerState } from "@/app/view/agents/jarvisderive";

export interface RecordFleetInput {
    channels: Channel[];
    // each channel's messages, keyed by channel id (channelMessagesAtom)
    messagesByChannel: Record<string, ChannelMessage[]>;
    agents: AgentVM[];
    // the record's attributed runs; each run row names its owning channel
    attributedRuns: Run[];
}

export interface RecordFleet {
    workers: WorkerState[];
    channelCount: number;
}

// The counts line shares one rail row with the section title. The rail is 300px with 18px of padding a
// side, and "Fleet · on this record" takes ~123px of the remaining 264px at 9px mono — so the line has
// roughly 24 characters before the title has to start truncating to make room.
export const RAIL_COUNTS_MAX_CHARS = 24;

function formatUsd(n: number): string {
    return `$${n.toFixed(2)}`;
}

// A record's fleet is counted in channels, not waiting workers: it crosses channels by construction, and
// cost is a channel's own meter. Kept short deliberately — the record variant used to read
// "N working · across M channels" and ran off the edge of the rail, clipped mid-word.
export function fleetCountsLine(
    counts: { working: number; waiting: number },
    costUsd: number,
    record: RecordFleet | null
): string {
    if (record != null) {
        return `${counts.working} working · ${record.channelCount} channel${record.channelCount === 1 ? "" : "s"}`;
    }
    return `${counts.working} working · ${counts.waiting} waiting${costUsd > 0 ? ` · ${formatUsd(costUsd)}` : ""}`;
}

export function fleetForRecord(input: RecordFleetInput): RecordFleet {
    const owning = new Set<string>();
    for (const run of input.attributedRuns ?? []) {
        if (run.channeloid) {
            owning.add(run.channeloid);
        }
    }
    const workers: WorkerState[] = [];
    const seen = new Set<string>();
    let channelCount = 0;
    // over the channel snapshot, not the owning ids: a run whose channel was deleted counts no channel
    for (const channel of input.channels ?? []) {
        if (!owning.has(channel.oid)) continue;
        channelCount++;
        for (const w of buildFleetSnapshot(input.messagesByChannel[channel.oid] ?? [], input.agents)) {
            if (seen.has(w.oref)) continue;
            seen.add(w.oref);
            workers.push(w);
        }
    }
    return { workers, channelCount };
}
