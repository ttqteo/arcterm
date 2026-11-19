// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The board split beside an agent's Chat: which board each agent's cell shows, and whether it takes the whole cell.
// Module-level, like the chat mode, because the Agent surface keeps its cells mounted but any opener (the board card,
// the toast, Library, `wsh ui`) sets it without holding a cell. The split itself is a layer inside the cell
// (boardsplit.tsx); this file only decides what is open.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { setAgentView } from "../agents/agentview";
import { setChatMode } from "../agents/chatmodestore";
import { currentGrid, type GridTab } from "../agents/gridstore";

export interface BoardSplit {
    project: string;
    boardId: string;
    expanded: boolean; // the board takes the whole cell; Chat stays mounted under it
}

// null = no board beside this agent's Chat
export const boardSplitAtom = atomFamily(
    (_agentId: string) => atom<BoardSplit | null>(null) as PrimitiveAtom<BoardSplit | null>
);

// A board opens half the cell wide when the cell is the whole grid. In a grid of more than one cell half a cell is too
// narrow to draw in, so it opens expanded.
export function splitOpens(cellsInGrid: number): { expanded: boolean } {
    return { expanded: cellsInGrid > 1 };
}

// what openBoard needs of AgentsViewModel; spelled out so it can be tested without one
export interface BoardOpenModel {
    focusIdAtom: PrimitiveAtom<string | undefined>;
    agentsAtom: Atom<ReadonlyArray<GridTab>>;
    terminalsAtom: Atom<ReadonlyArray<GridTab>>;
    openTerminal(agentId: string): void;
}

// Beside Chat means the cell shows Chat: focus the agent on the Agent surface, put its terminal slot back (closing a
// Review, Brainstorm or Canvas pane) and its chat mode on Chat, then split. The live xterm is never inside the split.
export function openBoard(model: BoardOpenModel, agentId: string, project: string, boardId: string): void {
    model.openTerminal(agentId);
    setAgentView(agentId, "terminal", Date.now());
    setChatMode(agentId, "chat");
    // read once the agent is in focus: the grid on screen is then the split it is a cell of, or the agent alone
    const { expanded } = splitOpens(currentGrid(model).ids.length);
    globalStore.set(boardSplitAtom(agentId), { project, boardId, expanded });
}

export function closeBoard(agentId: string): void {
    globalStore.set(boardSplitAtom(agentId), null);
}

export function setBoardExpanded(agentId: string, expanded: boolean): void {
    globalStore.set(boardSplitAtom(agentId), (split) => (split == null ? split : { ...split, expanded }));
}

// the header's switcher: another of the agent's boards in the same split
export function switchBoard(agentId: string, boardId: string): void {
    globalStore.set(boardSplitAtom(agentId), (split) => (split == null ? split : { ...split, boardId }));
}
