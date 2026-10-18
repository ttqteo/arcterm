// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The path items a file or folder's right-click menu ends with, in the Code tree, the Agent panel's Files tree and
// the path headers above an open file: its path relative to the folder it is listed under, its absolute path, and the
// file manager showing it. Pure: pathmenu.tsx turns them into menu items.

export type PathAction =
    | { kind: "copy"; label: string; text: string }
    | { kind: "reveal"; label: string; path: string };

// each OS names its file manager; anywhere else the containing folder opens
export function revealLabel(platform: string): string {
    if (platform === "darwin") {
        return "Reveal in Finder";
    }
    if (platform === "win32") {
        return "Show in Explorer";
    }
    return "Open Containing Folder";
}

// `rel` null or "": a file outside the folder it was opened against, which has no relative path to copy
export function pathActions(abs: string, rel: string | null, platform: string): PathAction[] {
    const actions: PathAction[] = [];
    if (rel != null && rel !== "") {
        actions.push({ kind: "copy", label: "Copy Relative Path", text: rel });
    }
    actions.push({ kind: "copy", label: "Copy Absolute Path", text: abs });
    actions.push({ kind: "reveal", label: revealLabel(platform), path: abs });
    return actions;
}
