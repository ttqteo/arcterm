// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rows of the initiative picker: the agent header's "Link to initiative", and the List's "Link to…". Pure.

import { isIdea } from "./briefrows";
import type { EffortCardModel } from "./effortmodel";

export type PickerTone = "working" | "asking" | "success" | "faint" | "muted";

export type PickerRow = {
    oref: string;
    title: string;
    project: string;
    progress: string; // "done/total"
    status: string; // a word: at work, blocked, paused, done, to do
    tone: PickerTone;
};

export type PickerRows = {
    // the project's initiatives, or every match while a query is typed (the project's own first)
    rows: PickerRow[];
    // the other projects' initiatives, behind "Other projects · N"; empty while a query is typed
    others: PickerRow[];
    otherCount: number;
    // the initiatives touched last, across every project, drawn above `rows` (which then leaves them out); empty unless
    // asked for with `opts.recent`, and while a query is typed
    recent: PickerRow[];
};

// how many initiatives "Recent" holds
export const RECENT_PICKER_ROWS = 3;

// blocked first: it is the one state that waits on someone, as on the Brief's row
function pickerStatus(card: EffortCardModel): { status: string; tone: PickerTone } {
    if (card.blockedChunks.length > 0) {
        return { status: "blocked", tone: "asking" };
    }
    if (card.status === "done" || card.status === "completed" || (card.remaining === 0 && card.done > 0)) {
        return { status: "done", tone: "success" };
    }
    if (card.status === "paused") {
        return { status: "paused", tone: "faint" };
    }
    if (card.activeTone === "active") {
        return { status: "at work", tone: "working" };
    }
    return { status: "to do", tone: "muted" };
}

function pickerRow(card: EffortCardModel): PickerRow {
    return {
        oref: card.oref,
        title: card.title,
        project: card.project ?? "",
        // a topic holds no chunks of its own, so it names no count
        progress:
            card.topic === true && card.done + card.remaining === 0
                ? "topic"
                : `${card.done}/${card.done + card.remaining}`,
        ...pickerStatus(card),
    };
}

// The initiatives a link can go to: not archived, not an idea (it has no plan to attach an agent to), and not one of
// `excluding` (the initiative being linked and everything beneath it, which would make a cycle). `project` is the
// agent's; a card with no project belongs to the project "". With `opts.recent` and no query, the RECENT_PICKER_ROWS
// with the newest `updatedts` (the list's order between equal ones) come out of the project's rows and the other
// projects' into `recent`: Save for later's picker puts where the person has just been first.
export function pickerRows(
    cards: EffortCardModel[],
    project: string,
    query: string,
    excluding: readonly string[] = [],
    opts: { recent?: boolean } = {}
): PickerRows {
    const skip = new Set(excluding);
    const live = cards.filter((c) => c.status !== "archived" && !isIdea(c) && !skip.has(c.oref));
    const own = (c: EffortCardModel) => (c.project ?? "") === project;
    const q = query.trim().toLowerCase();
    if (q !== "") {
        const hits = live.filter((c) => c.title.toLowerCase().includes(q));
        return {
            rows: [...hits.filter(own), ...hits.filter((c) => !own(c))].map(pickerRow),
            others: [],
            otherCount: 0,
            recent: [],
        };
    }
    // Array.prototype.sort is stable, so equal timestamps keep the list's order
    const newest =
        opts.recent === true ? [...live].sort((a, b) => b.updatedts - a.updatedts).slice(0, RECENT_PICKER_ROWS) : [];
    const taken = new Set(newest.map((c) => c.oref));
    const rest = live.filter((c) => !taken.has(c.oref));
    const others = rest.filter((c) => !own(c)).map(pickerRow);
    return { rows: rest.filter(own).map(pickerRow), others, otherCount: others.length, recent: newest.map(pickerRow) };
}

// An initiative and everything beneath it, by `parentoid` (a bare oid; an oref is "effort:" + oid). A cycle already in
// the data ends the walk rather than looping it.
export function descendantOrefs(items: { oref: string; parentoid?: string }[], root: string): string[] {
    const oidOf = (oref: string) => oref.replace(/^effort:/, "");
    const found = [root];
    const seen = new Set([root]);
    for (let i = 0; i < found.length; i++) {
        const oid = oidOf(found[i]);
        for (const item of items) {
            if (item.parentoid === oid && !seen.has(item.oref)) {
                seen.add(item.oref);
                found.push(item.oref);
            }
        }
    }
    return found;
}
