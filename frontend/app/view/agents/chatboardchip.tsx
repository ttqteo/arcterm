// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chip under the chat box, left of the model, while a board sits in the agent's split (chatboardref.ts): dashed,
// it offers the board; a click attaches it to the next message (solid, with an ×), which then ends with
// `board:<id>`. It lets go once that message is sent, so a message that says nothing of the board carries none. The
// pick is per agent and per board: another board put beside the chat starts unpicked.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { Plus, Shapes, X } from "lucide-react";
import { boardKey, openBoardsAtom, type BoardSplit } from "../boards/boardentries";
import { useBoardList } from "../boards/boardstore";
import { besideBoard } from "./chatboardref";
import { projectGridsAtom } from "./gridstore";

// agent id -> the key of the board picked for its next message
const pickedAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

export interface ChatBoard {
    board: BoardSplit;
    name: string;
    picked: boolean;
}

// The board beside the agent's Chat, its name and whether it rides the next message; null with none beside it.
export function useChatBoard(agentId: string): ChatBoard | null {
    const grids = useAtomValue(projectGridsAtom);
    const open = useAtomValue(openBoardsAtom);
    const picked = useAtomValue(pickedAtom)[agentId];
    const board = besideBoard(grids, agentId, open);
    // the every-project list the `@` picker reads too: the board's own project would be a second read of the same files
    const list = useBoardList("");
    if (board == null) {
        return null;
    }
    const info = list?.find((b) => b.project === board.project && b.id === board.boardId);
    return { board, name: info?.name ?? "Board", picked: picked === boardKey(board) };
}

export function setBoardPicked(agentId: string, board: BoardSplit | null): void {
    const next = { ...globalStore.get(pickedAtom) };
    if (board == null) {
        delete next[agentId];
    } else {
        next[agentId] = boardKey(board);
    }
    globalStore.set(pickedAtom, next);
}

export function ChatBoardChip({ agentId, chat }: { agentId: string; chat: ChatBoard }) {
    const { board, name, picked } = chat;
    return (
        <button
            type="button"
            data-chat-board-chip={picked ? "on" : "off"}
            aria-pressed={picked}
            // the box keeps the caret: a click here is a pick, not a move out of the box
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setBoardPicked(agentId, picked ? null : board)}
            title={
                picked
                    ? `${name} rides your next message as board:${board.boardId}, so the agent draws or answers on it. Click to take it off`
                    : `Ask about ${name}: attach it to your next message`
            }
            className={cn(
                "flex h-[22px] min-w-0 max-w-[180px] cursor-pointer items-center gap-1.5 rounded-[7px] border text-[12px] transition-colors duration-150",
                picked
                    ? "border-accent/45 bg-accentbg pl-2 pr-1 text-primary hover:border-accent"
                    : "border-dashed border-edge-mid px-2 text-muted hover:border-edge-strong hover:text-primary"
            )}
        >
            {picked ? null : <Plus size={12} strokeWidth={2} aria-hidden className="flex-none" />}
            <Shapes size={13} strokeWidth={1.8} aria-hidden className={cn("flex-none", picked && "text-accent")} />
            <span className="truncate">{name}</span>
            {picked ? <X size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" /> : null}
        </button>
    );
}
