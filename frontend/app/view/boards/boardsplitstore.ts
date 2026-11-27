// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The open board cells (boardentries.ts holds the persisted list; boardcell.ts the cell's rules and gridstore.ts the
// grid). Module-level, like the chat mode, because any opener (the board card, the toast, Library, `wsh ui`, the tree's
// board row) opens one without holding a cell.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { setAgentView } from "../agents/agentview";
import { setChatMode } from "../agents/chatmodestore";
import { openBoardCell, removeBoardCell, replaceBoardCell, type GridModel } from "../agents/gridstore";
import { boardEntriesAtom, boardKey, openBoardsAtom, parseBoardEntries, type BoardSplit } from "./boardentries";

export type { BoardSplit } from "./boardentries";

// Whether a board is open as a cell.
export const boardOpenAtom = atomFamily((key: string) => atom((get) => get(openBoardsAtom).has(key)));

function setOpen(ref: BoardSplit, open: boolean): void {
    const list = parseBoardEntries(globalStore.get(boardEntriesAtom)).filter((b) => boardKey(b) !== boardKey(ref));
    globalStore.set(boardEntriesAtom, open ? [...list, { project: ref.project, boardId: ref.boardId }] : list);
}

// The boards removed from the tree's list, by key, with their activets then (agentsidebarmodel.ts treeBoards): kept
// across launches; opening one again takes it off.
export const hiddenBoardsAtom = atomWithStorage<Record<string, number>>("board.tree.hidden", {}, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<Record<string, number>>;

export function unhide(ref: BoardSplit): void {
    const key = boardKey(ref);
    const hidden = globalStore.get(hiddenBoardsAtom) ?? {};
    if (key in hidden) {
        const next = { ...hidden };
        delete next[key];
        globalStore.set(hiddenBoardsAtom, next);
    }
}

// Remove from list: the board closes (its cell goes) and its tree row with it until it is active again.
export function removeBoardFromList(model: GridModel, ref: BoardSplit, activets: number): void {
    if (globalStore.get(openBoardsAtom).has(boardKey(ref))) {
        closeBoard(model, ref);
    }
    globalStore.set(hiddenBoardsAtom, { ...(globalStore.get(hiddenBoardsAtom) ?? {}), [boardKey(ref)]: activets });
}

// Opens a board without placing its cell: a drop places it (griddropoverlay.tsx), and a board cell is eligible only
// while its board is open.
export function ensureBoardOpen(ref: BoardSplit): void {
    unhide(ref);
    if (!globalStore.get(openBoardsAtom).has(boardKey(ref))) {
        setOpen(ref, true);
    }
}

// Expand: the board cell fills the whole grid, the others hidden under it. Per board and not persisted, so a launch
// opens a split as it was saved, not covered.
export const boardMaxAtom = atomFamily((_key: string) => atom(false) as PrimitiveAtom<boolean>);

export function setBoardMax(ref: BoardSplit, on: boolean): void {
    globalStore.set(boardMaxAtom(boardKey(ref)), on);
}

// what openBoard needs of AgentsViewModel; spelled out so it can be tested without one
export interface BoardOpenModel extends GridModel {
    openTerminal(agentId: string): void;
}

// Open a board as a cell of its own beside the chat it was opened from (`agentId`): focus that agent on the Agent
// surface, put its terminal slot back (closing a Review, Brainstorm or Canvas pane) and its chat mode on Chat, then
// open the board and give it a cell right of the agent's. A board already on screen stays where it is.
export function openBoard(model: BoardOpenModel, agentId: string, project: string, boardId: string): void {
    const ref = { project, boardId };
    model.openTerminal(agentId);
    setAgentView(agentId, "terminal", Date.now());
    setChatMode(agentId, "chat");
    unhide(ref);
    setOpen(ref, true);
    openBoardCell(model, ref, agentId);
}

// The board closes and Expand with it; its cell leaves the grid.
export function closeBoard(model: GridModel, ref: BoardSplit): void {
    removeBoardCell(model, ref);
    setOpen(ref, false);
    setBoardMax(ref, false);
}

// The header's switcher: another board in the same cell, in its square. The new board opens before the cell changes
// (a board that is not open is no cell to put there), the old one closes after.
export function switchBoard(model: GridModel, from: BoardSplit, boardId: string): void {
    const to = { project: from.project, boardId };
    if (boardKey(to) === boardKey(from)) {
        return;
    }
    // the cell stays as it was: an expanded cell stays expanded on the other board
    const max = globalStore.get(boardMaxAtom(boardKey(from)));
    setOpen(to, true);
    setBoardMax(to, max);
    replaceBoardCell(model, from, to);
    setOpen(from, false);
    setBoardMax(from, false);
}

// The Agent tree's own fold, chosen by hand and kept across launches.
export const treeFoldedAtom = atomWithStorage<boolean>("agent.tree.folded", false);
