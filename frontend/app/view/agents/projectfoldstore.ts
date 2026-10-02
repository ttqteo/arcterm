// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which project groups the Agent surface's tree has collapsed, by project name. Persisted, like the rail.

import { atomWithStorage } from "jotai/utils";

export const collapsedProjectsAtom = atomWithStorage<string[]>("agent.tree.collapsed", []);

export function toggleProject(list: string[], project: string): string[] {
    return list.includes(project) ? list.filter((p) => p !== project) : [...list, project];
}
