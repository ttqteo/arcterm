// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief header's autonomy chip, as a number. The mockup states the tier as one global fact
// ("Gatekeeper · answers routine asks"), but the backend has no global tier: gatekeeper:enabled is
// per-channel meta (pkg/jarvis/resolve.go), and the Gatekeeper gates on the channel the work belongs to.
// So the header can only summarize, and this is the summary — one tier when every project agrees, and an
// honest "mixed" when they do not, naming the highest tier in force because that is the one acting
// without you.

import { partitionChannels } from "@/app/view/agents/channelderive";
import { tierFromMeta, type JarvisTier } from "@/app/view/agents/channelmessages";
import { rowsWithChannel, type ProjectRow } from "@/app/view/agents/projectsstore";

export interface ChannelAutonomy {
    channelId: string;
    name: string;
    tier: JarvisTier;
}

// the chip names what the tier does to your queue; the popover keeps the rung names that explain it
const CHIP: Record<JarvisTier, string> = {
    concierge: "All asks: to you",
    gatekeeper: "Routine asks: auto",
};

const RANK: Record<JarvisTier, number> = { concierge: 0, gatekeeper: 1 };

/** Pure: the per-project autonomy rows behind the chip, one per project in the shared list. Archived
 *  channels are not work you have a policy over, so they are excluded. */
export function channelAutonomy(rows: ProjectRow[]): ChannelAutonomy[] {
    const ready = rowsWithChannel(rows);
    const active = new Set(partitionChannels(ready.map((r) => r.channel)).active);
    return ready
        .filter((r) => active.has(r.channel))
        .map((r) => ({
            channelId: r.channel.oid,
            name: r.name,
            tier: tierFromMeta(r.channel.meta as Record<string, unknown> | undefined),
        }));
}

export interface AutonomySummary {
    label: string;
    // the tier the chip's glyph draws: the shared one, or the highest in force when they disagree
    tier: JarvisTier;
    mixed: boolean;
}

/** Pure: the chip's face. Null for no projects — a policy chip over nothing to have a policy about
 *  would be the same lie as "all clear" over a snapshot that has not landed. */
export function autonomySummary(rows: ChannelAutonomy[]): AutonomySummary | null {
    if (rows.length === 0) {
        return null;
    }
    const top = rows.reduce((a, r) => (RANK[r.tier] > RANK[a] ? r.tier : a), rows[0].tier);
    const atTop = rows.filter((r) => r.tier === top).length;
    if (atTop === rows.length) {
        return { label: CHIP[top], tier: top, mixed: false };
    }
    // with two tiers a mixed top is always gatekeeper, so "auto" is the count of projects answering without you
    return { label: `Mixed · ${atTop} of ${rows.length} auto`, tier: top, mixed: true };
}
