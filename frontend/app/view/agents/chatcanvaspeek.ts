// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the Canvas card at the end of a finished turn that wrote design boards
// (.superpowers/design/chat-canvas-peek/project/A-canvas-card.dc.html): which canvas the turn drew on, which of its
// boards the card shows, and the rows its board modal steps through. The card itself is chatcanvaspeekcard.tsx.

import { parseCanvasPath, type CanvasBoard } from "./canvasmodel";
import type { CanvasPick } from "./chatcanvaspick";
import { turnFileAbs, type TurnFile } from "./chatsteps";

/** The canvas a turn drew on: its topic, the project it lives in, and its boards in the order the turn first touched them. */
export type TurnCanvas = { topic: string; cwd: string; boards: string[] };

/** Pure: the canvas a turn's edits wrote boards of, or null when it wrote none. A turn that touched boards of two canvases
 *  is said to have drawn on the one it wrote more boards of (the first one on a tie): one card, not one per canvas. A file
 *  outside `<project>/.superpowers/design/<topic>/project/` (canvas.json itself, a board moved to `unchosen/`) is no
 *  board. */
export function turnCanvas(files: readonly TurnFile[], cwd: string | null | undefined): TurnCanvas | null {
    const byTopic = new Map<string, TurnCanvas>();
    for (const f of files) {
        const abs = turnFileAbs(f.path, cwd);
        const at = abs != null ? parseCanvasPath(abs) : null;
        if (at == null) {
            continue;
        }
        const seen = byTopic.get(at.topic) ?? { topic: at.topic, cwd: at.cwd, boards: [] };
        if (!seen.boards.includes(at.board)) {
            seen.boards.push(at.board);
        }
        byTopic.set(at.topic, seen);
    }
    let best: TurnCanvas | null = null;
    for (const c of byTopic.values()) {
        if (best == null || c.boards.length > best.boards.length) {
            best = c;
        }
    }
    return best;
}

/** Pure: the boards the card shows, from the canvas's own list (canvas.json, as the poller last read it): the ones the
 *  turn wrote, in canvas.json's order. A board canvas.json no longer lists (an option moved to `unchosen/` once picked,
 *  a board deleted) is left out. */
export function peekBoards(boards: readonly CanvasBoard[], named: readonly string[]): CanvasBoard[] {
    const want = new Set(named);
    return boards.filter((b) => want.has(b.name));
}

/** Pure: a board as the card's tile and the modal's tab name it: its title as the agent wrote it, else its file name. */
export function peekTitle(b: CanvasBoard): string {
    return b.title?.trim() || b.name.replace(/\.dc\.html$/i, "");
}

/** Pure: the boards as the board modal takes them (chatcanvaspickmodal.tsx): no letters, since nothing is picked here,
 *  and the topic where the quick pick has its question. */
export function peekPick(topic: string, boards: readonly CanvasBoard[]): CanvasPick {
    return { question: topic, rows: boards.map((b) => ({ letter: "", title: peekTitle(b), board: b.name })) };
}
