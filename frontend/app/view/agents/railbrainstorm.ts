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
    return { rows, openParts, boardOrder: [...rows.flatMap((r) => r.boards), ...openParts].map((b) => b.name) };
}
