// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The board beside a Chat: a board cell in the same split as the agent (any board, another agent's too). The chat box
// offers it as a dashed chip under the box (chatboardchip.tsx); a click attaches it to the next message only, which
// then ends with `board:<id>`, the reference the `@` picker writes (refmention.ts) and the arc mod's prompt hook tells
// the agent to draw on (claude/arc-mod/hooks/refs-core.ts). Nothing rides unless the person picks it: a message that
// says nothing of the board carries none. Pure.

import { boardCellRef } from "../boards/boardcell";
import { boardKey, type BoardSplit } from "../boards/boardentries";
import type { ProjectGrids } from "./agentgrid";
import { refSpans } from "./refbadge";

// The open board in a split with `agentId`: the first board cell of the grid that holds the agent, in reading order.
// Undefined when the agent is in no split, or its split holds no open board.
export function besideBoard(
    grids: ProjectGrids,
    agentId: string,
    open: ReadonlyMap<string, BoardSplit>
): BoardSplit | undefined {
    for (const grid of Object.values(grids.grids)) {
        if (grid.ids.length < 2 || !grid.ids.includes(agentId)) {
            continue;
        }
        for (const id of grid.ids) {
            const ref = boardCellRef(id);
            if (ref != null && open.has(boardKey(ref))) {
                return ref;
            }
        }
    }
    return undefined;
}

// The message with the board's reference at its end: left as it is when there is no board, nothing typed, a
// `/command` or a `! command` (neither is a prompt the hook reads), or the text already names that board (a prefix of
// its id counts, as the hook matches it).
export function withBoardRef(text: string, boardId: string | undefined): string {
    const t = text.trim();
    if (boardId == null || boardId === "" || t === "" || t.startsWith("/") || t.startsWith("!")) {
        return text;
    }
    const id = boardId.toLowerCase();
    if (refSpans(t).some((r) => r.kind === "board" && id.startsWith(r.id))) {
        return text;
    }
    return `${text.replace(/\s+$/, "")} board:${boardId}`;
}
