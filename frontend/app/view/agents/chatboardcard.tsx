// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The card a turn ends in when the agent drew on a board with `wsh board draw` (docs/superpowers/specs/2026-11-19-kael-
// boards-design.md): the board's name, how many shapes it holds (`drawing…` after them while the drawer answers the
// agent's last request), and Open, which splits the agent's cell with the board. The board never opens by itself. One card
// per board per turn (chatboard.ts boardsDrawn); what the card says is chatboard.ts's boardCardView, read from the board
// stores (view/boards/boardstore.ts). A board the list does not hold draws nothing: there is nothing to open. The chip of
// a question forwarded from a board is here too: it is the same board, said over your own message.

import { cn } from "@/util/util";
import { ArrowUpRight, Shapes } from "lucide-react";
import type { BoardForward } from "../boards/boardforwardmarker";
import { openBoard } from "../boards/boardsplitstore";
import { findBoardByName, useBoardList, useBoardTalk } from "../boards/boardstore";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { boardCardView, forwardChip } from "./chatboard";
import { FOCUS_RING, SMALL_BTN, StateDot } from "./chatbrainstormparts";

function BoardCard({ info, agent, model }: { info: BoardInfo; agent: AgentVM; model: AgentsViewModel }) {
    const talk = useBoardTalk(info.project, info.id);
    const view = boardCardView(info, talk, Date.now());
    if (view == null) {
        return null;
    }
    return (
        <div
            data-chat-board={view.boardId}
            data-chat-board-drawing={view.drawing ? "" : undefined}
            className="flex min-w-0 items-center gap-[10px] rounded-[10px] border border-edge-mid bg-surface px-[14px] py-[9px] text-[12.5px]"
        >
            <Shapes size={14} strokeWidth={2} aria-hidden className="flex-none text-muted" />
            <span data-chat-board-name title={view.name} className="min-w-0 truncate font-medium text-primary">
                {view.name}
            </span>
            <span data-chat-board-facts className="flex flex-none items-center gap-[6px] text-[11.5px] text-muted">
                {view.drawing ? <StateDot state="working" /> : null}
                {view.facts}
            </span>
            <button
                type="button"
                data-chat-board-open
                onClick={() => openBoard(model, agent.id, view.project, view.boardId)}
                className={cn(SMALL_BTN, FOCUS_RING, "ml-auto font-semibold text-primary")}
            >
                Open
                <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
            </button>
        </div>
    );
}

/** The chip over a question forwarded from a board: `from <board> · on <shapes>`, drawn above the bubble that holds your
 *  words (the marker line itself is not shown). */
export function ChatBoardChip({ forward }: { forward: BoardForward }) {
    const text = forwardChip(forward);
    return (
        <div
            data-chat-board-chip
            title={text}
            className="mb-[6px] flex min-w-0 max-w-[75%] items-center gap-[6px] self-end rounded-full border border-edge-mid bg-surface px-[10px] py-[3px] text-[11.5px] text-muted"
        >
            <Shapes size={12} strokeWidth={2} aria-hidden className="flex-none" />
            <span className="min-w-0 truncate">{text}</span>
        </div>
    );
}

/** The card of one board a turn drew on, found by the name the call gave it in the agent's project. `project` is the
 *  agent's (never empty: the list of "" is every project's, and a name could match another project's board). */
export function ChatBoardCard({
    board,
    project,
    agent,
    model,
}: {
    board: string;
    project: string;
    agent: AgentVM;
    model: AgentsViewModel;
}) {
    const info = findBoardByName(useBoardList(project), board);
    return info != null ? <BoardCard info={info} agent={agent} model={model} /> : null;
}
