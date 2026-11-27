// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a board's open canvas and a Chat beside it share for board pointers (boardpointers.ts): the canvas publishes the
// shapes a phrase can point at, and a phrase asks the canvas to light shapes (a hover) or to show them (a click). Per
// board and in memory, as the drawings row is (boardstore.ts boardDrawingsAtom).

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { PointerShape } from "./boardpointers";

// the shapes of the board as its canvas has it now; null until a canvas of it has loaded
export const boardPointerShapesAtom = atomFamily(
    (_boardId: string) => atom<PointerShape[] | null>(null) as PrimitiveAtom<PointerShape[] | null>
);

// A click on a phrase: the canvas shows these shapes. `step` is a press of the same phrase again, which goes on to the
// next drawing that holds some (boardpointers.pointPlan); a new ts applies again.
export interface BoardPoint {
    ids: string[];
    key: string;
    step: boolean;
    ts: number;
}
export const boardPointAtom = atomFamily(
    (_boardId: string) => atom<BoardPoint | null>(null) as PrimitiveAtom<BoardPoint | null>
);

// the shapes a hovered phrase lights, where they are in view; empty with no phrase under the pointer
export const boardGlowAtom = atomFamily((_boardId: string) => atom<string[]>([]) as PrimitiveAtom<string[]>);

// The shapes a click just showed, which the canvas flashes once (BoardCanvas's glow layer); written by the canvas.
export interface BoardFlash {
    ids: string[];
    ts: number;
}
export const boardFlashAtom = atomFamily(
    (_boardId: string) => atom<BoardFlash | null>(null) as PrimitiveAtom<BoardFlash | null>
);

export function pointBoard(boardId: string, ids: string[]): void {
    const key = ids.join(",");
    const prev = globalStore.get(boardPointAtom(boardId));
    globalStore.set(boardPointAtom(boardId), { ids, key, step: prev?.key === key, ts: Date.now() });
}

export function glowBoard(boardId: string, ids: string[]): void {
    globalStore.set(boardGlowAtom(boardId), ids);
}

// lets go of the glow only when it is still these shapes' (a pointer that moved straight onto another phrase set its own)
export function unglowBoard(boardId: string, ids: string[]): void {
    const now = globalStore.get(boardGlowAtom(boardId));
    if (now.join(",") === ids.join(",")) {
        globalStore.set(boardGlowAtom(boardId), []);
    }
}
