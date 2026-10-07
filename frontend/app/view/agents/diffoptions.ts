// frontend/app/view/agents/diffoptions.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Diff pane's two view switches -> the options Monaco is handed. The switches live here
// rather than in the pane because the surface unmounts on a nav switch and the keybindings flip them
// from outside it, and the mapping lives here because it is the only part worth a test.

import { atom } from "jotai";
import type * as MonacoTypes from "monaco-editor";

// below this the two editors are narrower than most lines in this repo, so the toggle is offered
// disabled rather than producing a view nobody can read
export const SPLIT_MIN_PX = 900;

// Below this the header's labelled buttons wrap: at 1600x950 with history open the pane is ~760px.
// Measured on the pane itself, like SPLIT_MIN_PX, because the window says nothing about the columns.
export const LABELLED_MIN_PX = 1100;

export function paneHeaderLayout(width: number): { split: boolean; labelled: boolean } {
    return { split: width >= SPLIT_MIN_PX, labelled: width >= LABELLED_MIN_PX };
}

export const splitViewAtom = atom<boolean>(false);

// Monaco ignores leading and trailing whitespace by default, so a whitespace-only change draws as no
// change at all while the counts in the same header read +2 -2 — the pane contradicting the list it
// was opened from. Off by default so the two agree; on is the opt-in for reading through a reformat.
export const ignoreWsAtom = atom<boolean>(false);

// The file the pane shows, as an absolute path ("" when none), so Alt+Z can toggle its wrap from outside the pane.
// Wrap itself is codewrap.ts's per-file choice, shared with Code and the agent panel's File tab.
export const diffWrapPathAtom = atom<string>("");

export function paneOptions(split: boolean, ignoreWs: boolean, wrap: boolean): MonacoTypes.editor.IDiffEditorOptions {
    return {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: split,
        ignoreTrimWhitespace: ignoreWs,
        wordWrap: wrap ? "on" : "off",
        hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
        scrollBeyondLastLine: false,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily: "var(--font-mono)",
        smoothScrolling: true,
        scrollbar: { useShadows: false, verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
    };
}
