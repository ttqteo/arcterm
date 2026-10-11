// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Code tree's toolbar actions: Collapse All, and Locate (IntelliJ's Select Opened File), which shows the open file
// in the tree.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { codeCursorAtom, codeExpandedAtom, codeFileAtom, revealPath } from "./codestore";
import { topEntry } from "./codetree";

// bumped by Locate, so the tree scrolls to the file even when its cursor was on it already
export const codeLocateAtom = atom(0) as PrimitiveAtom<number>;

// every folder closes, and the cursor climbs to the top-level row that held it, the one place it still shows
export function collapseAllDirs(): void {
    globalStore.set(codeExpandedAtom, new Set<string>());
    const cursor = globalStore.get(codeCursorAtom);
    if (cursor != null) {
        globalStore.set(codeCursorAtom, topEntry(cursor));
    }
}

export function locateOpenFile(): void {
    const file = globalStore.get(codeFileAtom);
    if (file.kind === "none") {
        return;
    }
    revealPath(file.path);
    globalStore.set(codeCursorAtom, file.path);
    globalStore.set(codeLocateAtom, (n) => n + 1);
}
