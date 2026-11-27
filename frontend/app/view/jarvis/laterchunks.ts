// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's Later section as data (spec 2026-11-27-ask-later-design.md, Builder's call 11): the chunks saved for later,
// grouped by initiative from the briefing's summaries (EffortSummary.later, which the server fills with the later chunks
// still pending, active or blocked), in the order the section draws them, and the tick that settles one. Pure, no jotai
// and no RPC: the writes come in as dependencies, as briefingmodel.ts actOnChunk takes them.

import { chunkDueChip } from "./inlinetracker";

/** One row of the Later section: a later chunk, with what its tick and Ask agent need. */
export type LaterRowModel = {
    /** unique across initiatives: a chunk's label is its key only inside its own initiative */
    key: string;
    oref: string;
    label: string;
    /** pending, active or blocked: the status the tick's Undo puts back */
    status: string;
    /** the day it comes due, YYYY-MM-DD; used for the order, and shown once the day has come */
    due?: string;
    /** when it was saved, in ms */
    since: number;
    /** the first note's text: the passage Ask agent quotes */
    note: string;
    /** `agent:<tabid>` of the agent it came from */
    session?: string;
    /** the conversation id of that agent, which outlives its tab */
    conversation?: string;
};

export type LaterGroup = { oref: string; title: string; items: LaterRowModel[] };

const rowKey = (oref: string, label: string) => `${oref}\u0000${label}`;

// items with a due first, the earliest due first; the rest after them; the oldest first in each; the summary's own order
// for the rest (Array.sort is stable)
function byDueThenAge(a: LaterRowModel, b: LaterRowModel): number {
    if (a.due && b.due) {
        return a.due < b.due ? -1 : a.due > b.due ? 1 : a.since - b.since;
    }
    if (a.due || b.due) {
        return a.due ? -1 : 1;
    }
    return a.since - b.since;
}

const newestOf = (g: LaterGroup) => g.items.reduce((n, i) => Math.max(n, i.since), 0);

/**
 * The summaries' later items as groups, one per initiative that has any: the group with the newest item first (its ref
 * breaks a tie), and within a group the items with a due first, earliest first, then oldest first. `filter` is the
 * Brief's search: an item stays when its label matches, and all of an initiative's items stay when its title does,
 * ignoring case; a group left with nothing is dropped.
 */
export function laterGroups(summaries: readonly EffortSummary[], filter: string): LaterGroup[] {
    const q = filter.trim().toLowerCase();
    const groups: LaterGroup[] = [];
    for (const s of summaries) {
        const titleMatches = q === "" || s.title.toLowerCase().includes(q);
        const items: LaterRowModel[] = [];
        for (const it of s.later ?? []) {
            if (!titleMatches && !it.label.toLowerCase().includes(q)) {
                continue;
            }
            items.push({
                key: rowKey(s.oref, it.label),
                oref: s.oref,
                label: it.label,
                status: it.status,
                due: it.due || undefined,
                since: it.since,
                note: it.note ?? "",
                session: it.session || undefined,
                conversation: it.conversation || undefined,
            });
        }
        if (items.length > 0) {
            groups.push({ oref: s.oref, title: s.title, items: items.sort(byDueThenAge) });
        }
    }
    return groups.sort((a, b) => newestOf(b) - newestOf(a) || (a.oref < b.oref ? -1 : a.oref > b.oref ? 1 : 0));
}

/** The number the section's header reads: every item the groups hold. */
export function laterCount(groups: readonly LaterGroup[]): number {
    return groups.reduce((n, g) => n + g.items.length, 0);
}

/** The due chip's text ("due 11-27"), only once the day has come: before that the date only orders the rows. `today` is
 *  a local YYYY-MM-DD (inlinetracker.ts localDay). */
export function laterDueChip(due: string | undefined, status: string, today: string): string | null {
    const chip = chunkDueChip(due, status, today);
    return chip != null && chip.come ? chip.text : null;
}

export type TickLaterDeps = {
    setChunkStatus: (oref: string, chunk: string, status: string) => Promise<void>;
    undo: { notify: (text: string, undo?: () => void) => void; error: (text: string) => void };
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The tick: sets the item's chunk done and says so in a toast whose Undo puts the status it had back. A write the server
 * refuses shows its own words in place of the success toast. True when the chunk was set done.
 */
export async function tickLater(deps: TickLaterDeps, item: LaterRowModel): Promise<boolean> {
    try {
        await deps.setChunkStatus(item.oref, item.label, "done");
    } catch (e) {
        deps.undo.error(messageOf(e));
        return false;
    }
    deps.undo.notify(`Done · ${item.label}`, () => {
        deps.setChunkStatus(item.oref, item.label, item.status).catch((e) => deps.undo.error(messageOf(e)));
    });
    return true;
}
