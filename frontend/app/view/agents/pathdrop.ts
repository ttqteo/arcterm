// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Worktree files tree drags paths onto a terminal: what the drag carries, and the text a drop types.
// Pure except for the drag-size variable at the bottom.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";

export const RAIL_PATHS_MIME = "application/x-arc-paths";

export interface DropTarget {
    // an agent terminal takes `@path` mentions; a plain shell takes the bare path
    agent: boolean;
    // the block's working directory; null when unknown, which leaves every path absolute
    cwd: string | null;
}

export function isPathsDrag(types: readonly string[]): boolean {
    return types.includes(RAIL_PATHS_MIME);
}

// The paths go out twice: as JSON for an arcterm drop, and one per line as text for a drop outside it.
export function encodePathsDrag(paths: string[]): { mime: string; data: string }[] {
    return [
        { mime: RAIL_PATHS_MIME, data: JSON.stringify(paths) },
        { mime: "text/plain", data: paths.join("\n") },
    ];
}

export function decodePathsDrag(data: string): string[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(data);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === "string" && p !== "")) {
        return null;
    }
    return parsed;
}

// A directory arrives with a trailing separator and keeps one, as "/", so the terminal text shows it is one.
function dropPathText(path: string, cwd: string | null): string {
    const isDir = /[\\/]$/.test(path);
    const bare = path.replace(/[\\/]+$/, "");
    const text = cwd != null && isUnderRoot(cwd, bare) ? toRel(cwd, bare) : bare.replace(/\\/g, "/");
    return isDir ? text + "/" : text;
}

// Several paths are joined by single spaces and the text ends with a space, so typing can continue.
export function formatDroppedPaths(paths: string[], target: DropTarget): string {
    return paths
        .map((path) => {
            const text = dropPathText(path, target.cwd);
            const quoted = /\s/.test(text) ? `"${text}"` : text;
            return (target.agent ? "@" : "") + quoted + " ";
        })
        .join("");
}

// How many paths are being dragged. A browser hides a drag's payload until the drop, so the hint a drop
// target words at dragover ("the path" or "the paths") reads this instead.
let draggedCount = 0;

export function setDraggedPathsCount(n: number): void {
    draggedCount = n;
}

export function draggedPathsCount(): number {
    return draggedCount;
}
