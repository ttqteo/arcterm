// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What the board's buttons ask wavesrv to do. The board cell and Library → Boards both call these. A rejection (an ended
// agent, a busy drawer) is the caller's to show: nothing here swallows it.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export interface BoardRef {
    project: string;
    boardId: string;
}

// ends the turn that is answering; the board stays as it was
export function stopBoardTurn(board: BoardRef): Promise<void> {
    return RpcApi.BoardAskStopCommand(TabRpcClient, { project: board.project, boardid: board.boardId });
}

// asks a failed or stopped turn again
export function retryBoardTurn(board: BoardRef, turnId: string): Promise<void> {
    return RpcApi.BoardAskRetryCommand(TabRpcClient, {
        project: board.project,
        boardid: board.boardId,
        turnid: turnId,
    });
}

// ties the board to another chat, a live Claude agent of its project: the drawer reads that chat from the next turn on
export async function moveBoardToChat(board: BoardRef, tabId: string): Promise<void> {
    await RpcApi.BoardTakeOverCommand(TabRpcClient, { project: board.project, boardid: board.boardId, tabid: tabId });
}
