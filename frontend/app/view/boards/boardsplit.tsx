// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board as a cell of its own in the Agent surface's grid, a peer of the agent and terminal cells (agentsurface.tsx
// draws the cell's wrapper and bar; boardcell.ts holds the rules). It reads one chat, the board's tie, and its header
// moves it to another. Above the canvas sits the strip (boardstrip.tsx: the drawings row and the Edit switch); a board
// opens in view mode, so a line asks about the drawing in view and no shapes until Edit is pressed. It holds no xterm,
// so it mounts only while shown and goes when the cell does.
//
// The canvas is mounted only while the Agent surface is on screen. The surface keeps its cells mounted when another
// surface shows, and a canvas left running there would be a second copy of the board beside Library's, each saving over
// the other; closed, it saves its edits and the next look reads the file again.

import { layerFade, springFoldHeight, springFoldWidth } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { AgentsViewModel } from "../agents/agents";
import { takeoverAgents } from "../library/libraryboardsmodel";
import { askBoard, moveBoardToChat, rerouteBoardTurn, retryBoardTurn, stopBoardTurn } from "./boardactions";
import { BoardAskBox } from "./boardaskbox";
import { BoardCanvas, type BoardSelection } from "./boardcanvas";
import { boardCommands } from "./boardcommands";
import { boardKey } from "./boardentries";
import { BoardHeader } from "./boardheader";
import type { BoardPart } from "./boardparts";
import {
    boardMaxAtom,
    closeBoard,
    setBoardMax,
    switchBoard,
    turnsFoldedAtom,
    type BoardSplit,
} from "./boardsplitstore";
import { boardDrawingsAtom, boardEditingAtom, boardsOfAgent, useBoardList, useBoardTalk } from "./boardstore";
import { BoardStrip } from "./boardstrip";
import { agentAlive, askAllowed } from "./boardtalkmodel";
import { BoardTurns } from "./boardturns";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// the cell of one open board, keyed by the board: a selection, a Show and an error belong to one board. `alone`: the
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
    const [selection, setSelection] = useState<BoardSelection | null>(null);
    // Show: a new array each press, so the same shapes can be shown again
    const [highlight, setHighlight] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    // the part of the board being read, null for the whole board (boardparts.ts)
    const [parts, setParts] = useState<BoardPart[]>([]);
    const [part, setPart] = useState<number | null>(null);
    const [turnsFolded, setTurnsFolded] = useAtom(turnsFoldedAtom(key));
    // the Edit switch and the drawings row the canvas publishes (boardstore.ts): in view mode a selection is only Show's,
    // so a line asks about the drawing in view, and about the part being read as if its shapes were selected; in Edit
    // about the drawing a selection names, and its shapes
    const editing = useAtomValue(boardEditingAtom(boardId));
    const drawings = useAtomValue(boardDrawingsAtom(boardId));
    const readPart = part != null ? (parts[part] ?? null) : null;
    const askedSelection: BoardSelection | null = editing
        ? selection
        : readPart != null && readPart.ids.length > 0
          ? { ids: readPart.ids, label: readPart.label }
          : null;
    const askedDrawing = (editing ? drawings?.selected : null) ?? drawings?.inView ?? null;

    // the canvas is gone while another surface shows: what it had selected or shown goes with it
    useEffect(() => {
        if (!onAgentSurface) {
            setSelection(null);
            setHighlight(null);
            setPart(null);
        }
    }, [onAgentSurface]);

    const board = list?.find((b) => b.id === boardId);
    // nothing drawn and nothing asked: the list is read (the wire omits `shapes` at 0) and the talk holds no turn. A file
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
    // the turns column folds on the axis it sits on: beside the canvas (expanded, and the cell as wide as the
    // @[640px] container query below) its width, under it its height
    const [cellRef, , cellRect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const beside = expanded && (cellRect?.width ?? 0) >= 640;
    const widthFold = usePartMotion(springFoldWidth);
    const heightFold = usePartMotion(springFoldHeight);

    // the board was deleted (the list is read and no longer has it): its cell goes
    const gone = list != null && board == null;
    useEffect(() => {
        if (gone) {
            closeCell();
        }
    }, [gone]);
    const target = { project, boardId };

    // a rejection (the agent ended, the drawer is busy) shows above the ask box; the next action that goes clears it
    async function act(fn: () => Promise<void>): Promise<boolean> {
        try {
            await fn();
            setError(null);
            return true;
        } catch (e) {
            setError(errorText(e));
            return false;
        }
    }

    const turns = (
        <BoardTurns
            talk={talk}
            mode={expanded ? "full" : "recent"}
            // beside Chat only the latest turn shows, one line; "N earlier" opens the board with all of them
            recent={1}
            canForward={alive}
            onShow={(turn) => setHighlight([...(turn.shapeids ?? [])])}
            onOtherWay={(turn) => void act(() => rerouteBoardTurn(target, turn.id))}
            onStop={() => void act(() => stopBoardTurn(target))}
            onRetry={(turn) => void act(() => retryBoardTurn(target, turn.id))}
            onEarlier={alone ? undefined : () => setBoardMax(split, true)}
            emptyText="No turns yet. Ask below; to ask about shapes, press Edit and select them."
        />
    );

    return (
        <div
            ref={cellRef}
            data-board-cell={boardId}
            data-board-split={boardId}
            data-board-expanded={expanded ? "true" : "false"}
            data-board-max={expanded ? "true" : undefined}
            // Excalidraw's tool keys and Escape are its own: the surface's bindings stand down inside (dispatcher.ts)
            data-owns-keys
            // @container: the expanded board puts its turns beside the canvas only where there is room for both
            className="@container flex min-h-0 min-w-0 flex-1 flex-col bg-background"
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
                turnsFolded={turnsFolded}
                onToggleTurns={() => setTurnsFolded(!turnsFolded)}
                parts={parts}
                part={part}
                onPart={setPart}
                onDeletePart={editing ? (p) => boardCommands(boardId)?.deletePart(p) : undefined}
            />
            {/* the same boxes either way, so expanding never remounts the canvas or drops a half-typed question. Wide
                enough (640px), the expanded board has the canvas on the left and on its right the turns column with the
                ask box under it; narrower (a grid cell), they stack under the canvas, the turns scrolling in what is left */}
            <div className={cn("flex min-h-0 flex-1 flex-col", expanded && "@[640px]:flex-row")}>
                {/* the board's strip (the drawings row and Edit) sits directly above the canvas, in the canvas's column:
                    wide, it spans the canvas and not the turns column */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <BoardStrip boardId={boardId} />
                    <div className="relative min-h-0 min-w-0 flex-1">
                        {onAgentSurface ? (
                            <BoardCanvas
                                project={project}
                                boardId={boardId}
                                highlightIds={highlight}
                                onSelection={(s) => setSelection(s.ids.length > 0 ? s : null)}
                                part={part}
                                onPart={setPart}
                                onParts={setParts}
                            />
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
                                        Nothing drawn yet. Ask below, or press Edit to draw.
                                    </motion.div>
                                ) : null}
                            </AnimatePresence>
                        </MotionConfig>
                    </div>
                </div>
                {/* the strip sits before the column, so a folding column shrinks toward the edge and the strip rides
                    out to it; the column slides open and shut on the spring (springFoldWidth beside the canvas,
                    springFoldHeight under it) */}
                {turnsFolded ? (
                    // folded: a 14px strip where the column was (right of the canvas when expanded and wide, under it
                    // otherwise); a press opens it again
                    <button
                        type="button"
                        data-board-turns-strip
                        aria-label="Show turns"
                        title="Show turns"
                        onClick={() => setTurnsFolded(false)}
                        className={cn(
                            "flex h-[14px] w-full flex-none cursor-pointer items-center justify-center border-t border-edge-mid bg-surface text-muted hover:bg-surface-raised hover:text-primary",
                            expanded && "@[640px]:h-auto @[640px]:w-[14px] @[640px]:border-l @[640px]:border-t-0"
                        )}
                    >
                        <ChevronLeft
                            size={11}
                            strokeWidth={2}
                            aria-hidden
                            className={cn("rotate-90", expanded && "@[640px]:rotate-0")}
                        />
                    </button>
                ) : null}
                <MotionConfig reducedMotion="user">
                    <AnimatePresence initial={false}>
                        {turnsFolded ? null : (
                            <motion.div
                                key="turns"
                                data-board-turns-column
                                {...(beside ? widthFold : heightFold)}
                                className={cn(
                                    "flex flex-none flex-col",
                                    // the axis it does not fold on is never sized inline: a slide cut short by the
                                    // cell changing layout (Collapse pressed mid-slide) would leave it stuck
                                    beside ? "!h-auto" : "!w-auto",
                                    expanded &&
                                        "max-h-[55%] min-h-0 border-t border-edge-mid @[640px]:max-h-none @[640px]:border-l @[640px]:border-t-0"
                                )}
                            >
                                {/* a fixed width inside the folding one, so the turns never reflow while it slides */}
                                <div className={cn("flex min-h-0 flex-1 flex-col", expanded && "@[640px]:w-[300px]")}>
                                    {turns}
                                    {error != null ? (
                                        <div
                                            role="alert"
                                            data-board-error
                                            className="mx-3 mb-1.5 flex-none text-[11.5px] leading-[1.4] text-error [overflow-wrap:anywhere]"
                                        >
                                            {error}
                                        </div>
                                    ) : null}
                                    <BoardAskBox
                                        editing={editing}
                                        selection={askedSelection}
                                        part={editing ? null : (askedSelection?.label ?? null)}
                                        allowed={askAllowed(talk, alive)}
                                        placeholder={alive ? undefined : "Its chat has ended: pick a chat above to ask"}
                                        onAsk={(question) =>
                                            act(() => askBoard(target, question, askedSelection, askedDrawing))
                                        }
                                    />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </MotionConfig>
            </div>
        </div>
    );
}
