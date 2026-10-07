// frontend/app/view/code/codewrap.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Word wrap for every Monaco view of a file: the Code surface's editor and diff, and the Agent panel's File tab.
// A file wraps by its kind (prose on, code per editor:wordwrap — codeclassify.ts defaultWrap) until the reader
// toggles it; the toggle is kept per absolute path for the session, so it survives surface switches.

import { getSettingsKeyAtom, globalStore } from "@/app/store/global";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { defaultWrap } from "./codeclassify";
import { codeFileAtom, codeProjectAtom, draftKey } from "./codestore";

export const codeWrapAtom = atom(new Map<string, boolean>()) as PrimitiveAtom<Map<string, boolean>>;

function wrapFor(abs: string, choices: Map<string, boolean>, setting: boolean | null | undefined): boolean {
    return choices.get(abs) ?? defaultWrap(abs, setting ?? undefined);
}

export function useWrap(abs: string): boolean {
    const choices = useAtomValue(codeWrapAtom);
    const setting = useAtomValue(getSettingsKeyAtom("editor:wordwrap"));
    return wrapFor(abs, choices, setting);
}

export function toggleWrap(abs: string): void {
    const setting = globalStore.get(getSettingsKeyAtom("editor:wordwrap"));
    globalStore.set(codeWrapAtom, (m) => new Map(m).set(abs, !wrapFor(abs, m, setting)));
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
