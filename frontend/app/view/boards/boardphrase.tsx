// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Board pointers in a Chat message (boardpointers.ts): a link the reply wrote to shapes ([words](#shape-<id>)) and a
// phrase remarkboardphrase.ts marked, drawn as words that light their shapes on the board beside the Chat while the
// pointer is on them and show them on a click. A written link is underlined solid, a phrase matched by text dotted
// and fainter, since a match can be wrong. With no board beside the Chat, or nothing on it to point at, the words are
// drawn as written: a link to shapes no board here holds is plain text, never a dead link.

import { cn } from "@/util/util";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { matchPhrase, shapeLinkIds, type PointerShape } from "./boardpointers";
import { glowBoard, pointBoard, unglowBoard } from "./boardpointerstore";

export interface BoardPointerValue {
    boardId: string;
    name: string;
    shapes: readonly PointerShape[];
}

export const BoardPointerContext = createContext<BoardPointerValue | null>(null);

function Pointer({
    board,
    ids,
    written,
    children,
}: {
    board: BoardPointerValue;
    ids: string[];
    written: boolean;
    children?: ReactNode;
}) {
    const n = ids.length;
    // a pointer that leaves the screen under the pointer (another agent shown, the message gone) takes its light along
    const key = ids.join(",");
    useEffect(() => () => unglowBoard(board.boardId, key.split(",")), [board.boardId, key]);
    return (
        <span
            role="button"
            data-board-pointer={written ? "link" : "match"}
            data-board-pointer-ids={ids.join(",")}
            title={`Show on ${board.name} (${n === 1 ? "1 shape" : `${n} shapes`}; click again for the next drawing)`}
            onPointerEnter={() => glowBoard(board.boardId, ids)}
            onPointerLeave={() => unglowBoard(board.boardId, ids)}
            onClick={(e) => {
                // a phrase inside a link or a table row: the click is the pointer's
                e.stopPropagation();
                pointBoard(board.boardId, ids);
            }}
            className={cn(
                "cursor-pointer rounded-[3px] underline underline-offset-[3px] transition-colors duration-150 hover:bg-accent/15",
                written ? "decoration-accent/70" : "decoration-accent/45 decoration-dotted"
            )}
        >
            {children}
        </span>
    );
}

// a phrase remarkboardphrase.ts marked: a pointer where the board beside has shapes it matches
export function BoardPhrase({ phrase, children }: { phrase?: string; children?: ReactNode }) {
    const board = useContext(BoardPointerContext);
    const ids = useMemo(
        () => (board == null || phrase == null ? [] : matchPhrase(phrase, board.shapes)),
        [board, phrase]
    );
    if (board == null || ids.length === 0) {
        return <>{children}</>;
    }
    return (
        <Pointer board={board} ids={ids} written={false}>
            {children}
        </Pointer>
    );
}

// a link the reply wrote to shapes, `#shape-<id>,<id>`: a pointer to those the board beside holds, else the words alone
export function BoardShapeLink({ href, children }: { href: string; children?: ReactNode }) {
    const board = useContext(BoardPointerContext);
    const ids = useMemo(() => (board == null ? [] : shapeLinkIds(href, board.shapes)), [board, href]);
    if (board == null || ids.length === 0) {
        return <>{children}</>;
    }
    return (
        <Pointer board={board} ids={ids} written>
            {children}
        </Pointer>
    );
}
