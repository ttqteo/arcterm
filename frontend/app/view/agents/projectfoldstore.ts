// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent surface's tree has folded and pinned: the project folders, each a list of names. Persisted, like the
// rail.

import { atomWithStorage } from "jotai/utils";

// the tree's project folders
export const collapsedProjectsAtom = atomWithStorage<string[]>("agent.tree.collapsed", []);

// the project folders the tree keeps when nothing is left in them (projectTree's `pinned`), so a project you come back
// to has a folder to start its next agent from; per machine, set from the folder's menu
export const pinnedProjectsAtom = atomWithStorage<string[]>("agent.tree.pinned", []);

export function toggleFold(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((p) => p !== name) : [...list, name];
}
