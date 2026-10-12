// frontend/app/view/code/codewrap.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Word wrap for every Monaco view of a file: the Code surface's editor and diff, and the Agent panel's File tab.
// Every file wraps until the reader toggles it; the toggle is kept per absolute path for the session, so it survives
// surface switches.

import { globalStore } from "@/app/store/global";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { codeFileAtom, codeProjectAtom, draftKey } from "./codestore";

export const codeWrapAtom = atom(new Map<string, boolean>()) as PrimitiveAtom<Map<string, boolean>>;

function wrapFor(abs: string, choices: Map<string, boolean>): boolean {
    return choices.get(abs) ?? true;
}

export function useWrap(abs: string): boolean {
    return wrapFor(abs, useAtomValue(codeWrapAtom));
}

export function toggleWrap(abs: string): void {
    globalStore.set(codeWrapAtom, (m) => new Map(m).set(abs, !wrapFor(abs, m)));
}

// the Code surface's open file; false when no text file is open, so the key passes on
export function toggleCodeWrap(): boolean {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return false;
    }
    toggleWrap(draftKey(project, file.path));
    return true;
}
