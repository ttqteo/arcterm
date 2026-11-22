// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which board each agent's board cell shows (boardentries.ts holds the persisted entries; boardcell.ts the cell's rules
// and gridstore.ts the grid). Module-level, like the chat mode, because any opener (the board card, the toast, Library,
// `wsh ui`, the tree's board row) sets it without holding a cell.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom, type SetStateAction, type WritableAtom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { setAgentView } from "../agents/agentview";
import { setChatMode } from "../agents/chatmodestore";
import { openBoardCell, type GridModel } from "../agents/gridstore";
import { boardEntriesAtom, boardEntryMapAtom, parseBoardEntries, type BoardSplit } from "./boardentries";

export type { BoardSplit } from "./boardentries";

// null = no board open for this agent (no board cell beside it). Read and written as one entry of the persisted map.
export const boardSplitAtom = atomFamily(
    (agentId: string): WritableAtom<BoardSplit | null, [SetStateAction<BoardSplit | null>], void> =>
        atom(
            (get) => get(boardEntryMapAtom)[agentId] ?? null,
            (get, set, next) => {
                const entries = { ...get(boardEntryMapAtom) };
                const value = typeof next === "function" ? next(entries[agentId] ?? null) : next;
                if (value == null) {
                    delete entries[agentId];
                } else {
                    entries[agentId] = { project: value.project, boardId: value.boardId };
                }
                set(boardEntriesAtom, entries);
            }
        )
);

// Expand: the board cell fills the whole grid, the others hidden under it. Per agent and not persisted, so a launch opens
// a split as it was saved, not covered.
export const boardMaxAtom = atomFamily((_agentId: string) => atom(false) as PrimitiveAtom<boolean>);

export function setBoardMax(agentId: string, on: boolean): void {
    globalStore.set(boardMaxAtom(agentId), on);
}

// Drops the entries of agents that are not in `live`, so a board whose agent ended while arcterm was closed leaves no
// orphan in localStorage. The surface calls it once the roster is seeded.
export function pruneBoardEntries(live: ReadonlySet<string>): void {
    const entries = parseBoardEntries(globalStore.get(boardEntriesAtom));
    const kept = Object.fromEntries(Object.entries(entries).filter(([id]) => live.has(id)));
    if (Object.keys(kept).length !== Object.keys(entries).length) {
        globalStore.set(boardEntriesAtom, kept);
    }
}

// what openBoard needs of AgentsViewModel; spelled out so it can be tested without one
export interface BoardOpenModel extends GridModel {
    openTerminal(agentId: string): void;
}

// Focus the agent on the Agent surface, put its terminal slot back (closing a Review, Brainstorm or Canvas pane) and its
// chat mode on Chat, then set the board and give it a cell right of the agent's. With the cell already on screen it only
// switches board.
export function openBoard(model: BoardOpenModel, agentId: string, project: string, boardId: string): void {
    model.openTerminal(agentId);
    setAgentView(agentId, "terminal", Date.now());
    setChatMode(agentId, "chat");
    globalStore.set(boardSplitAtom(agentId), { project, boardId });
    openBoardCell(model, agentId);
}

// The entry goes and Expand with it; the cell leaves the grid at the next reconcile (it is eligible only with an entry).
export function closeBoard(agentId: string): void {
    globalStore.set(boardSplitAtom(agentId), null);
    globalStore.set(boardMaxAtom(agentId), false);
}

// the header's switcher: another of the agent's boards in the same cell
export function switchBoard(agentId: string, boardId: string): void {
    globalStore.set(boardSplitAtom(agentId), (split) => (split == null ? split : { ...split, boardId }));
}

// The Agent tree's own fold, chosen by hand and kept across launches.
export const treeFoldedAtom = atomWithStorage<boolean>("agent.tree.folded", false);
