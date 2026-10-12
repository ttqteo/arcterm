// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Opening a terminal's search box from outside its pane (a server's Log, docs/superpowers/specs/2026-10-12-server-
// terminal-log-design.md). There is no registry of term view models, so the request is a block id in an atom that the
// matching TerminalView takes and clears; a pane that mounts only when first shown still finds it.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

// Cast like agentDragAtom: with strictNullChecks off, atom<T | null>(null) resolves to the read-only overload.
export const pendingTermSearchAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export function requestTermSearch(blockId: string): void {
    globalStore.set(pendingTermSearchAtom, blockId);
}
