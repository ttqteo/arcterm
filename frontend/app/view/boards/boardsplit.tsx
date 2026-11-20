// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The board beside an agent's Chat: a layer inside the agent's cell, drawn after ChatLayer (agentsurface.tsx), never
// wrapping it. It takes the cell right of a 360px Chat column (all of it expanded) over the xterm and the pane, which keep their size, so
// nothing refits and no pane changes parent. Only while the cell shows Chat: the live xterm is never inside the split.
//
// The canvas is mounted only while the Agent surface is on screen. The surface keeps its cells mounted when another
// surface shows, and a canvas left running there would be a second copy of the board beside Library's, each saving over
// the other; closed, it saves its edits and the next look reads the file again.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { AgentsViewModel } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { useChatShown } from "../agents/chatmodestore";
import { askBoard, rerouteBoardTurn, retryBoardTurn, stopBoardTurn } from "./boardactions";
import { BoardAskBox } from "./boardaskbox";
import { BoardCanvas, type BoardSelection } from "./boardcanvas";
import { BoardHeader } from "./boardheader";
import {
    boardSplitAtom,
    closeBoard,
    setBoardExpanded,
    splitExpanded,
    switchBoard,
    type BoardSplit,
} from "./boardsplitstore";
import { boardsOfAgent, useBoardList, useBoardTalk } from "./boardstore";
import { agentAlive, askAllowed } from "./boardtalkmodel";
import { BoardTurns } from "./boardturns";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// the layer for one agent's cell; nothing when no board is open beside it, or the cell is not showing Chat
export function BoardSplitLayer({ model, agent, barred }: { model: AgentsViewModel; agent: AgentVM; barred: boolean }) {
    const split = useAtomValue(boardSplitAtom(agent.id));
    const chatShown = useChatShown(agent);
    if (split == null || !chatShown) {
        return null;
    }
    // keyed by the board: a selection, a Show and an error belong to one board
    return (
        <OpenSplit
            key={`${split.project}/${split.boardId}`}
            model={model}
            agent={agent}
            barred={barred}
            split={split}
        />
    );
}

function OpenSplit({
    model,
    agent,
    barred,
    split,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    barred: boolean;
    split: BoardSplit;
}) {
    const { project, boardId } = split;
    const onAgentSurface = useAtomValue(model.surfaceAtom) === "agent";
    const roster = useAtomValue(model.agentsAtom);
    const list = useBoardList(project);
    const talk = useBoardTalk(project, boardId);
    const [selection, setSelection] = useState<BoardSelection | null>(null);
    // Show: a new array each press, so the same shapes can be shown again
    const [highlight, setHighlight] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // the canvas is gone while another surface shows: what it had selected or shown goes with it
    useEffect(() => {
        if (!onAgentSurface) {
            setSelection(null);
            setHighlight(null);
        }
    }, [onAgentSurface]);

    const board = list?.find((b) => b.id === boardId);
    // the agent's boards, and the open one even when it is tied to another agent (a card in this Chat can open it)
    const ofAgent = boardsOfAgent(list, agent.id);
    const boards = board != null && !ofAgent.some((b) => b.id === board.id) ? [board, ...ofAgent] : ofAgent;
    // a board in a grid of several cells is always expanded: half of a quarter is too narrow to draw in
    const expanded = splitExpanded(split, barred);
    const alive = agentAlive(board?.agenttabid, roster);
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
            canForward={alive}
            onShow={(turn) => setHighlight([...(turn.shapeids ?? [])])}
            onOtherWay={(turn) => void act(() => rerouteBoardTurn(target, turn.id))}
            onStop={() => void act(() => stopBoardTurn(target))}
            onRetry={(turn) => void act(() => retryBoardTurn(target, turn.id))}
            onEarlier={() => setBoardExpanded(agent.id, true)}
        />
    );

    return (
        <div
            data-board-split={boardId}
            data-board-expanded={expanded ? "true" : "false"}
            // Excalidraw's tool keys and Escape are its own: the surface's bindings stand down inside (dispatcher.ts)
            data-owns-keys
            // @container: the expanded board puts its turns beside the canvas only where there is room for both
            className={cn(
                "@container absolute bottom-0 right-0 z-20 flex flex-col bg-background",
                barred ? "top-[26px]" : "top-0",
                expanded ? "left-0" : "left-[min(360px,50%)] border-l border-edge-mid"
            )}
        >
            <BoardHeader
                board={board}
                boards={boards}
                expanded={expanded}
                canExpand={!barred}
                onSwitch={(id) => switchBoard(agent.id, id)}
                onToggleExpanded={() => setBoardExpanded(agent.id, !split.expanded)}
                onClose={() => closeBoard(agent.id)}
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
