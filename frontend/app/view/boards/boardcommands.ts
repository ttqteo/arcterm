// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What the strip asks of the open canvas beyond a pick or a Tidy: copy the view as a picture, export the drawing in view,
// delete a drawing. The strip calls these from the click itself (a clipboard write must start inside the press), so the
// open canvas registers them here rather than answering an atom. One board can be open twice (the split and Library):
// the newest canvas answers, and when it goes the one before does again. The scene edits are pure and tested.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Drawing } from "./boarddrawings";
import { bump } from "./boardmodel";
import type { BoardPart } from "./boardparts";

export type ExportKind = "png" | "svg";

export interface BoardCommands {
    // the canvas as it shows now, at its zoom, on the clipboard as a PNG
    copyView(): Promise<void>;
    // the drawing to a file the person picks; the path written, or null when they cancelled
    exportDrawing(drawingId: string, kind: ExportKind): Promise<string | null>;
    // the drawing and everything in it, gone as one undo step; false when it was not on the board
    deleteDrawing(drawingId: string): boolean;
    // the part's shapes (a part drawn by mistake), the view back on the whole drawing; false when none is left
    deletePart(part: BoardPart): boolean;
}

const commands = new Map<string, BoardCommands[]>();

export function registerBoardCommands(boardId: string, cmds: BoardCommands): () => void {
    commands.set(boardId, [...(commands.get(boardId) ?? []), cmds]);
    return () => {
        const rest = (commands.get(boardId) ?? []).filter((c) => c !== cmds);
        if (rest.length > 0) {
            commands.set(boardId, rest);
        } else {
            commands.delete(boardId);
        }
    };
}

export function boardCommands(boardId: string): BoardCommands | undefined {
    return commands.get(boardId)?.at(-1);
}

// The ids a drawing's delete takes: its frame, the shapes in it, and the text bound to any of them (a label is in its
// container's frame already, but a board drawn by hand may have left one out).
export function drawingIds(elements: readonly ExcalidrawElement[], drawingId: string): Set<string> {
    const live = elements.filter((el) => !el.isDeleted);
    if (!live.some((el) => el.id === drawingId && el.type === "frame")) {
        return new Set();
    }
    const ids = new Set<string>([drawingId]);
    for (const el of live) {
        if (el.frameId === drawingId) {
            ids.add(el.id);
        }
    }
    for (const el of live) {
        const container = "containerId" in el ? el.containerId : null;
        if (container != null && ids.has(container)) {
            ids.add(el.id);
        }
    }
    return ids;
}

// the elements with these marked deleted (or live again, for an undo), each a new version for the save and a new
// versionNonce, which is how Excalidraw's store tells a changed element (without it the step is not one undo)
export function setDeleted(
    elements: readonly ExcalidrawElement[],
    ids: ReadonlySet<string>,
    deleted: boolean,
    now: number
): ExcalidrawElement[] {
    return elements.map((el) =>
        ids.has(el.id) && el.isDeleted !== deleted
            ? bump(el, { isDeleted: deleted, versionNonce: Math.floor(Math.random() * 2 ** 31) }, now)
            : el
    );
}

// where the view goes once a drawing is gone: the one before it, else the one after; null when it was the only one
export function drawingAfterDelete(drawings: readonly Drawing[], drawingId: string): Drawing | null {
    const at = drawings.findIndex((d) => d.id === drawingId);
    if (at < 0) {
        return null;
    }
    return drawings[at - 1] ?? drawings[at + 1] ?? null;
}

// a file name from the drawing's title: what Windows and macOS refuse in a name becomes a dash, and an untitled
// drawing is named by its number
export function exportFileName(drawing: { n: number; title: string }, kind: ExportKind): string {
    const base = [...drawing.title]
        .map((c) => (c.charCodeAt(0) < 32 ? "-" : c))
        .join("")
        .replace(/[<>:"/\\|?*]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/\s+/g, " ")
        .replace(/^[\s.-]+|[\s.-]+$/g, "")
        .slice(0, 80);
    return `${base !== "" ? base : `drawing-${drawing.n}`}.${kind}`;
}
