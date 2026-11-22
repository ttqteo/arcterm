// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The boards open as cells of the Agent surface's grids, persisted (localStorage "agent.openboards", keyed by
// boardKey) so a split with a board survives a restart like any other split. A board cell is a cell of its own, not a
// companion of an agent: the chat it reads is the board's tie (BoardInfo.agenttabid), which wavesrv keeps. A leaf on
// purpose: gridstore.ts reads it (a board cell exists only while its board is open) and boardsplitstore.ts, which imports
// gridstore, writes it, so neither can hold the atom without a cycle.
//
// Before boards were cells of their own, "agent.boards" held one board per agent; it is not read, so those cells go once.

import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export interface BoardSplit {
    project: string;
    boardId: string;
}

// A board's key: its project and id. A board id is unique only within its project's folder.
export function boardKey(ref: BoardSplit): string {
    return `${ref.project}/${ref.boardId}`;
}

// The board a key names; undefined for anything else. The id is after the last "/" (an id has none; a project might).
export function parseBoardKey(key: string): BoardSplit | undefined {
    const at = key.lastIndexOf("/");
    if (at <= 0 || at === key.length - 1) {
        return undefined;
    }
    return { project: key.slice(0, at), boardId: key.slice(at + 1) };
}

// The cast is the one the other getOnInit atoms carry (gridstore.ts): with `undefined` for the storage argument jotai
// resolves the async overload. getOnInit keeps the first read from seeing the empty default.
// Readers go through openBoardsAtom, which repairs a hand-edited value; only writers touch this one.
export const boardEntriesAtom = atomWithStorage<unknown>("agent.openboards", [], undefined, {
    getOnInit: true,
}) as PrimitiveAtom<unknown>;

// Whatever storage holds, repaired: a list of boards, each with a project and a board id, each once.
export function parseBoardEntries(raw: unknown): BoardSplit[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = new Map<string, BoardSplit>();
    for (const v of raw) {
        const e = v as { project?: unknown; boardId?: unknown } | null;
        if (
            e != null &&
            typeof e.project === "string" &&
            e.project !== "" &&
            typeof e.boardId === "string" &&
            e.boardId !== "" &&
            !e.boardId.includes("/")
        ) {
            const ref = { project: e.project, boardId: e.boardId };
            out.set(boardKey(ref), ref);
        }
    }
    return [...out.values()];
}

// The open boards, by key.
export const openBoardsAtom: Atom<ReadonlyMap<string, BoardSplit>> = atom(
    (get) =>
        new Map(parseBoardEntries(get(boardEntriesAtom)).map((b) => [boardKey(b), b])) as ReadonlyMap<
            string,
            BoardSplit
        >
);
