// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent surface's tree has folded: the project folders, a list of names. Persisted, like the rail.

import { atomWithStorage } from "jotai/utils";

// the tree's project folders
export const collapsedProjectsAtom = atomWithStorage<string[]>("agent.tree.collapsed", []);

export function toggleFold(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((p) => p !== name) : [...list, name];
}
