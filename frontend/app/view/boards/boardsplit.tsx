// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board as a cell of its own in the Agent surface's grid, a peer of the agent and terminal cells (agentsurface.tsx
// draws the cell's wrapper and bar; boardcell.ts holds the rules). It reads one chat, the board's tie, and its header
// moves it to another. Above the canvas sits the strip (boardstrip.tsx: the drawings row and the Edit switch), under it
// the status line (boardstatus.tsx), there only while the drawer works or the latest turn failed. Questions about the
// board go through Chat (`@board`). It holds no xterm, so it mounts only while shown and goes when the cell does.
//
// The canvas is mounted only while the Agent surface is on screen. The surface keeps its cells mounted when another
// surface shows, and a canvas left running there would be a second copy of the board beside Library's, each saving over
// the other; closed, it saves its edits and the next look reads the file again.

import { layerFade } from "@/app/element/motiontokens";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { AgentsViewModel } from "../agents/agents";
import { takeoverAgents } from "../library/libraryboardsmodel";
import { moveBoardToChat, retryBoardTurn, stopBoardTurn } from "./boardactions";
import { BoardCanvas } from "./boardcanvas";
import { boardCommands } from "./boardcommands";
import { boardKey } from "./boardentries";
import { BoardHeader } from "./boardheader";
import { BoardHistory } from "./boardhistory";
import type { BoardPart } from "./boardparts";
import { boardMaxAtom, closeBoard, setBoardMax, switchBoard, type BoardSplit } from "./boardsplitstore";
import { BoardStatus } from "./boardstatus";
import { boardEditingAtom, boardsOfAgent, useBoardList, useBoardTalk } from "./boardstore";
import { BoardStrip } from "./boardstrip";
import { agentAlive } from "./boardtalkmodel";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// the cell of one open board, keyed by the board: a part being read and an error belong to one board. `alone`: the
// board over the whole centre (agentcenter.ts's board mode), laid out as an expanded cell, its Close back to the agent.
export function BoardCell({
    model,
    board,
    alone,
    onClose,
}: {
    model: AgentsViewModel;
    board: BoardSplit;
    alone?: boolean;
    onClose?: () => void;
}) {
    return <OpenCell key={boardKey(board)} model={model} split={board} alone={alone} onClose={onClose} />;
}

function OpenCell({
    model,
    split,
    alone = false,
    onClose,
}: {
    model: AgentsViewModel;
    split: BoardSplit;
    alone?: boolean;
    onClose?: () => void;
}) {
    const { project, boardId } = split;
    const key = boardKey(split);
    const onAgentSurface = useAtomValue(model.surfaceAtom) === "agent";
    const roster = useAtomValue(model.agentsAtom);
    const list = useBoardList(project);
    const talk = useBoardTalk(project, boardId);
    const [error, setError] = useState<string | null>(null);
    // the part of the board being read, null for the whole board (boardparts.ts)
    const [parts, setParts] = useState<BoardPart[]>([]);
    const [part, setPart] = useState<number | null>(null);
    // the Edit switch (boardstore.ts): a part is deleted from the header only in Edit
    const editing = useAtomValue(boardEditingAtom(boardId));

    // the canvas is gone while another surface shows: the part it was reading goes with it
    useEffect(() => {
        if (!onAgentSurface) {
            setPart(null);
        }
    }, [onAgentSurface]);

    const board = list?.find((b) => b.id === boardId);
    // nothing drawn and nothing requested: the list is read (the wire omits `shapes` at 0) and the talk holds no turn. A file
    // that won't open has its own line in the canvas's place.
    const empty =
        board != null && (board.shapes ?? 0) === 0 && !board.loaderror && talk != null && talk.turns.length === 0;
    // the chat the board reads (its tie), and the project's live Claude chats it can move to
    const chatId = board?.agenttabid ?? "";
    const alive = agentAlive(chatId, roster);
    const chats = useMemo(() => takeoverAgents(roster, project), [roster, project]);
    const chatTitle = roster.find((a) => a.id === chatId)?.name || board?.agenttitle || "";
    // its chat's boards, and the open one whatever its chat (the switcher always lists it)
    const ofChat = chatId !== "" ? boardsOfAgent(list, chatId) : [];
    const boards = board != null && !ofChat.some((b) => b.id === board.id) ? [board, ...ofChat] : ofChat;
    // Expand: the cell fills the whole grid (agentsurface.tsx hides the others under it)
    const expanded = useAtomValue(boardMaxAtom(key)) || alone;
    const closeCell = () => (onClose != null ? onClose() : closeBoard(model, split));
    // the board was deleted (the list is read and no longer has it): its cell goes
    const gone = list != null && board == null;
    useEffect(() => {
        if (gone) {
            closeCell();
        }
    }, [gone]);
    const target = { project, boardId };

    // a rejected Stop or Retry shows on the status line; the next action that goes clears it
    async function act(fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
            setError(null);
        } catch (e) {
            setError(errorText(e));
        }
    }

    return (
        <div
            data-board-cell={boardId}
            data-board-split={boardId}
            data-board-expanded={expanded ? "true" : "false"}
            data-board-max={expanded ? "true" : undefined}
            // Excalidraw's tool keys and Escape are its own: the surface's bindings stand down inside (dispatcher.ts)
            data-owns-keys
            className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
        >
            <BoardHeader
                board={board}
                boards={boards}
                expanded={expanded}
                onSwitch={(id) => switchBoard(model, split, id)}
                onToggleExpanded={alone ? undefined : () => setBoardMax(split, !expanded)}
                onClose={closeCell}
                chat={{ id: chatId, title: chatTitle, alive }}
                chats={chats}
                onChat={(tabId) => void act(() => moveBoardToChat(target, tabId))}
                history={<BoardHistory boardId={boardId} talk={talk} />}
                parts={parts}
                part={part}
                onPart={setPart}
                onDeletePart={editing ? (p) => boardCommands(boardId)?.deletePart(p) : undefined}
            />
            {/* the strip (the drawings row and Edit) directly above the canvas, the status line under it */}
            <BoardStrip boardId={boardId} />
            <div className="relative min-h-0 min-w-0 flex-1">
                {onAgentSurface ? (
                    <BoardCanvas project={project} boardId={boardId} part={part} onPart={setPart} onParts={setParts} />
                ) : null}
                <MotionConfig reducedMotion="user">
                    <AnimatePresence initial={false}>
                        {onAgentSurface && empty ? (
                            <motion.div
                                key="empty"
                                data-board-empty
                                variants={layerFade}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                // over the canvas, which stays under it: a press goes through to draw on it
                                className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] leading-[1.5] text-muted"
                            >
                                Nothing drawn yet. Ask in Chat with @board, or press Edit to draw.
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </MotionConfig>
            </div>
            <BoardStatus
                talk={talk}
                error={error}
                onStop={() => void act(() => stopBoardTurn(target))}
                onRetry={(turn) => void act(() => retryBoardTurn(target, turn.id))}
            />
        </div>
    );
}
