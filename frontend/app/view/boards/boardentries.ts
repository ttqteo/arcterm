// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which board each agent has open in its board cell, persisted (localStorage "agent.boards", keyed by agent id) so a
// split with a board survives a restart like any other split. A leaf on purpose: gridstore.ts reads it (a board cell
// exists only while its agent has an entry) and boardsplitstore.ts, which imports gridstore, writes it, so neither
// can hold the atom without a cycle.

import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export interface BoardSplit {
    project: string;
    boardId: string;
    expanded?: boolean; // deprecated: nothing writes it; removed by Task 2 of the board-cells plan
}

// The cast is the one the other getOnInit atoms carry (gridstore.ts): with `undefined` for the storage argument jotai
// resolves the async overload. getOnInit keeps the first read from seeing the empty default.
// Readers go through boardEntryMapAtom, which repairs a hand-edited value; only writers touch this one.
export const boardEntriesAtom = atomWithStorage<Record<string, BoardSplit>>("agent.boards", {}, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<Record<string, BoardSplit>>;

// Whatever storage holds, repaired: only entries with a project and a board id are kept, and nothing else of theirs.
export function parseBoardEntries(raw: unknown): Record<string, BoardSplit> {
    const out: Record<string, BoardSplit> = {};
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return out;
    }
    for (const [agentId, v] of Object.entries(raw as Record<string, unknown>)) {
        const e = v as { project?: unknown; boardId?: unknown } | null;
        if (agentId !== "" && e != null && typeof e.project === "string" && typeof e.boardId === "string") {
            out[agentId] = { project: e.project, boardId: e.boardId };
        }
    }
    return out;
}

export const boardEntryMapAtom: Atom<Record<string, BoardSplit>> = atom((get) =>
    parseBoardEntries(get(boardEntriesAtom))
);

// The agents that have a board open: their board cells may exist.
export const openBoardIdsAtom: Atom<ReadonlySet<string>> = atom(
    (get) => new Set(Object.keys(get(boardEntryMapAtom))) as ReadonlySet<string>
);
