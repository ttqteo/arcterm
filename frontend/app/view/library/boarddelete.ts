// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Delete a board from Library → Boards: wavesrv moves its drawing, talk and answers into ~/.arc/trash, purged after 7
// days (BoardDeleteCommand), and refuses while a turn is drawing on it. Whatever showed the board lets it go: its cell
// in the split, the Agent centre showing it alone, Library's open board, the tree's hidden entry. The lists reload on
// the board:update the delete sends.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { boardAloneAtom, centerModeAtom, leaveCenter } from "../agents/agentcenter";
import type { GridModel } from "../agents/gridstore";
import { boardKey, openBoardsAtom, type BoardSplit } from "../boards/boardentries";
import { closeBoard, unhide } from "../boards/boardsplitstore";
import { libraryBoardSelAtom } from "./librarystore";

export const DELETE_BOARD_LABEL = "Delete board";

export function deleteBoardMessage(name: string): string {
    return `Delete board '${name}'? Its drawing and its turns move to ~/.arc/trash and are purged after 7 days.`;
}

export async function deleteBoard(model: GridModel, ref: BoardSplit): Promise<boolean> {
    try {
        await RpcApi.BoardDeleteCommand(TabRpcClient, { project: ref.project, boardid: ref.boardId });
    } catch (e) {
        pushToast({
            title: "Could not delete the board",
            message: e instanceof Error ? e.message : String(e),
            level: "error",
        });
        return false;
    }
    letGo(model, ref);
    return true;
}

// the board is gone: nothing may keep showing it
export function letGo(model: GridModel, ref: BoardSplit): void {
    const key = boardKey(ref);
    if (globalStore.get(openBoardsAtom).has(key)) {
        closeBoard(model, ref);
    }
    const alone = globalStore.get(boardAloneAtom);
    if (alone != null && boardKey(alone) === key) {
        if (globalStore.get(centerModeAtom) === "board") {
            leaveCenter();
        }
        globalStore.set(boardAloneAtom, null);
    }
    const sel = globalStore.get(libraryBoardSelAtom);
    if (sel != null && boardKey(sel) === key) {
        globalStore.set(libraryBoardSelAtom, null);
    }
    unhide(ref);
}

export function confirmDeleteBoard(model: GridModel, ref: BoardSplit, name: string): void {
    modalsModel.pushModal("ConfirmModal", {
        title: DELETE_BOARD_LABEL,
        message: deleteBoardMessage(name),
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => fireAndForget(() => deleteBoard(model, ref)),
    });
}
