// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent surface's tree has folded, each a list of names. Persisted, like the rail. The sections fold apart
// from each other, and a project's folder in one section apart from its folder in another: closing old conversations
// must not hide the agents running in that project.

import { atomWithStorage } from "jotai/utils";

export type SidebarSection = "active" | "terminals" | "conversations";

// the Active section's project folders
export const collapsedProjectsAtom = atomWithStorage<string[]>("agent.tree.collapsed", []);
// the Terminals section's project folders
export const collapsedTerminalProjectsAtom = atomWithStorage<string[]>("agent.tree.terminals.collapsed", []);
// the Conversations section's project folders
export const collapsedConversationProjectsAtom = atomWithStorage<string[]>("agent.tree.conversations.collapsed", []);
// the sections themselves (SidebarSection)
export const collapsedSectionsAtom = atomWithStorage<string[]>("agent.tree.sections.collapsed", []);

export function toggleFold(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((p) => p !== name) : [...list, name];
}
