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

// a Windows drive path (D:\ or D:/), a UNC share (\\server\share) or a POSIX absolute path
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]|\/)/;

// file:///D:/a%20b.pdf → D:/a b.pdf, file:///home/me/n.md → /home/me/n.md; null for another scheme or a bad escape
function fileUriPath(uri: string): string | null {
    if (!uri.toLowerCase().startsWith("file://")) {
        return null;
    }
    try {
        const path = decodeURIComponent(uri.slice("file://".length).replace(/^localhost(?=\/)/i, ""));
        return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
    } catch {
        return null;
    }
}

// The files a drag names by path, for a text box that attaches them in place: arcterm's own tree (RAIL_PATHS_MIME),
// file URIs (text/uri-list, which VS Code and file managers set), or plain text whose every line is one absolute path,
// quotes stripped ("Copy as path", Obsidian). Null when the drag holds real files (the box copies those) or names no
// path, so a drop of ordinary text still lands as text. `get` is DataTransfer.getData, readable only during the drop.
export function pathsFromDrop(types: readonly string[], get: (type: string) => string): string[] | null {
    if (types.includes("Files")) {
        return null;
    }
    if (isPathsDrag(types)) {
        return decodePathsDrag(get(RAIL_PATHS_MIME));
    }
    if (types.includes("text/uri-list")) {
        const paths = get("text/uri-list")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l !== "" && !l.startsWith("#"))
            .map(fileUriPath)
            .filter((p): p is string => p != null && p !== "");
        if (paths.length > 0) {
            return paths;
        }
    }
    if (types.includes("text/plain")) {
        const lines = get("text/plain")
            .split(/\r?\n/)
            .map((l) => l.trim().replace(/^"(.*)"$/, "$1"))
            .filter((l) => l !== "");
        if (lines.length > 0 && lines.every((l) => ABSOLUTE_PATH.test(l) && !/\s{2,}|\t/.test(l))) {
            return lines;
        }
    }
    return null;
}

// A directory arrives with a trailing separator and keeps one, as "/", so the terminal text shows it is one.
function dropPathText(path: string, cwd: string | null): string {
    const isDir = /[\\/]$/.test(path);
    const bare = path.replace(/[\\/]+$/, "");
    const text = cwd != null && isUnderRoot(cwd, bare) ? toRel(cwd, bare) : bare.replace(/\\/g, "/");
    return isDir ? text + "/" : text;
}

// eslint-disable-next-line no-control-regex
const UNDROPPABLE = /[\x00-\x1f\x7f"]/;

// The paths a drop can type as they are. A control character is refused: a newline typed into a shell without
// bracketed paste is an Enter, so the line would run before the person sees it. So is a double quote: inside @"..."
// or "..." it ends the quoting early and the terminal is given another path (Windows names cannot hold one).
export function splitDroppable(paths: string[]): { ok: string[]; refused: string[] } {
    const ok: string[] = [];
    const refused: string[] = [];
    for (const path of paths) {
        (UNDROPPABLE.test(path) ? refused : ok).push(path);
    }
    return { ok, refused };
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
