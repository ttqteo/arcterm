// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent rail's Brainstorm tab as one timeline (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-
// tabs-design.md, canvas board D-timeline): the decisions that are the user's, numbered in the design's order, each with
// the boards of its part under it; boards whose part is not decided yet list after it as Open parts. Pure.

import type { BandBoard, BrainstormBandModel } from "./brainstormband";

export type RailBrainstormRow = {
    id: string;
    n: number;
    title: string;
    gist: string;
    boards: BandBoard[];
    hasNew: boolean;
};

export type RailBrainstormView = {
    rows: RailBrainstormRow[];
    openParts: BandBoard[];
    /** every board in the order the tab draws them, for the board dialog's ← / → */
    boardOrder: string[];
};

/** What the tab says before, or instead of, the timeline: `reading` while a brainstorm is attached and its file has not
 *  been read; `error` when the store holds a read error (it wins over a timeline kept from the last good read, which the
 *  tab still draws under it); `empty` while no decision is the user's (boards of open parts list after it); `timeline`
 *  once one is. Nothing attached has nothing to read, and the tab is not shown then. */
export type RailBrainstormState = "reading" | "error" | "empty" | "timeline";

export function brainstormPaneState(
    attached: boolean,
    model: BrainstormBandModel | null,
    error: string | null
): RailBrainstormState {
    if (error != null) {
        return "error";
    }
    if (model == null) {
        return attached ? "reading" : "empty";
    }
    return model.decided.length === 0 ? "empty" : "timeline";
}

export function railBrainstormRows(m: BrainstormBandModel): RailBrainstormView {
    const byPart = new Map<string, BandBoard[]>();
    for (const b of m.boards) {
        byPart.set(b.part, [...(byPart.get(b.part) ?? []), b]);
    }
    const decidedParts = new Set(m.decided.map((d) => d.title));
    const rows = m.decided.map((d, i) => {
        const boards = byPart.get(d.title) ?? [];
        return { id: d.id, n: i + 1, title: d.title, gist: d.gist, boards, hasNew: boards.some((b) => b.isNew) };
    });
    const openParts = m.boards.filter((b) => !decidedParts.has(b.part));
    // two decisions with one title list the same boards (a board's part is a title): each name steps once
    const boardOrder = [...new Set([...rows.flatMap((r) => r.boards), ...openParts].map((b) => b.name))];
    return { rows, openParts, boardOrder };
}
