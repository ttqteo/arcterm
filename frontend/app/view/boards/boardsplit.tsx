// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board as a cell of the Agent surface's grid, beside its agent's Chat (agentsurface.tsx draws the cell's wrapper and
// bar; boardcell.ts holds the rules). It holds no xterm, so it mounts only while shown and goes when the cell does.
//
// The canvas is mounted only while the Agent surface is on screen. The surface keeps its cells mounted when another
// surface shows, and a canvas left running there would be a second copy of the board beside Library's, each saving over
// the other; closed, it saves its edits and the next look reads the file again.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { AgentsViewModel } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { removeBoardCell } from "../agents/gridstore";
import { askBoard, rerouteBoardTurn, retryBoardTurn, stopBoardTurn } from "./boardactions";
import { BoardAskBox } from "./boardaskbox";
import { BoardCanvas, type BoardSelection } from "./boardcanvas";
import { BoardHeader } from "./boardheader";
import type { BoardPart } from "./boardparts";
import { boardMaxAtom, boardSplitAtom, closeBoard, setBoardMax, switchBoard, type BoardSplit } from "./boardsplitstore";
import { boardsOfAgent, useBoardList, useBoardTalk } from "./boardstore";
import { agentAlive, askAllowed } from "./boardtalkmodel";
import { BoardTurns } from "./boardturns";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// the cell of one agent's board; nothing when it has no board open. `multi`: the grid draws a bar over each cell.
export function BoardCell({ model, agent }: { model: AgentsViewModel; agent: AgentVM; multi: boolean }) {
    const split = useAtomValue(boardSplitAtom(agent.id));
    if (split == null) {
        return null;
    }
    // keyed by the board: a selection, a Show and an error belong to one board
    return <OpenCell key={`${split.project}/${split.boardId}`} model={model} agent={agent} split={split} />;
}

function OpenCell({ model, agent, split }: { model: AgentsViewModel; agent: AgentVM; split: BoardSplit }) {
    const { project, boardId } = split;
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

    // the canvas is gone while another surface shows: what it had selected or shown goes with it
    useEffect(() => {
        if (!onAgentSurface) {
            setSelection(null);
            setHighlight(null);
            setPart(null);
        }
    }, [onAgentSurface]);

    const board = list?.find((b) => b.id === boardId);
    // the agent's boards, and the open one even when it is tied to another agent (a card in this Chat can open it)
    const ofAgent = boardsOfAgent(list, agent.id);
    const boards = board != null && !ofAgent.some((b) => b.id === board.id) ? [board, ...ofAgent] : ofAgent;
    // Expand: the cell fills the whole grid (agentsurface.tsx hides the others under it)
    const expanded = useAtomValue(boardMaxAtom(agent.id));
    const alive = agentAlive(board?.agenttabid, roster);
    const closeCell = () => {
        closeBoard(agent.id);
        removeBoardCell(model, agent.id);
    };

    // the board was deleted (the list is read and no longer has it): the entry and the cell go, Chat stays alone
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
            onEarlier={() => setBoardMax(agent.id, true)}
        />
    );

    return (
        <div
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
                onSwitch={(id) => switchBoard(agent.id, id)}
                onToggleExpanded={() => setBoardMax(agent.id, !expanded)}
                onClose={closeCell}
                parts={parts}
                part={part}
                onPart={setPart}
            />
            {/* the same boxes either way, so expanding never remounts the canvas or drops a half-typed question. Wide
                enough (640px), the expanded board has the canvas on the left and on its right the turns column with the
                ask box under it; narrower (a grid cell), they stack under the canvas, the turns scrolling in what is left */}
            <div className={cn("flex min-h-0 flex-1 flex-col", expanded && "@[640px]:flex-row")}>
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
                </div>
                <div
                    className={cn(
                        "flex flex-none flex-col",
                        expanded &&
                            "max-h-[55%] min-h-0 border-t border-edge-mid @[640px]:max-h-none @[640px]:w-[300px] @[640px]:border-l @[640px]:border-t-0"
                    )}
                >
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
                        selection={selection}
                        allowed={askAllowed(talk, alive)}
                        onAsk={(question) => act(() => askBoard(target, question, selection))}
                    />
                </div>
            </div>
        </div>
    );
}
