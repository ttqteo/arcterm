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

export type OptionId = "split" | "whitespace" | "wrap" | "editor" | "code";

export interface OptionItem {
    id: OptionId;
    label: string;
    // a switch (aria-checked) or an action (undefined)
    checked?: boolean;
    disabled?: boolean;
    // why a disabled item is, as its tooltip
    reason?: string;
    // the binding that does the same thing, as a chord string for formatChordString
    chord?: string;
}

export interface OptionsState {
    split: boolean;
    // the pane is wide enough for two editors (paneHeaderLayout)
    splitAllowed: boolean;
    ignoreWs: boolean;
    wrap: boolean;
    // a file is open in File mode (Review has no single file to wrap)
    wrapAllowed: boolean;
    // the file exists in the working tree
    editorAllowed: boolean;
    // a repository is resolved
    codeAllowed: boolean;
}

// The header's `⋯` menu: what the old header spread over four labelled buttons. Always the same five items, in the same
// order, so a disabled one says why instead of vanishing and the menu never changes shape under the pointer.
export function optionItems(s: OptionsState): OptionItem[] {
    return [
        {
            id: "split",
            label: "Side by side",
            checked: s.split && s.splitAllowed,
            disabled: !s.splitAllowed,
            reason: s.splitAllowed ? undefined : "The pane is too narrow for two editors",
            chord: "Shift:d",
        },
        { id: "whitespace", label: "Hide whitespace changes", checked: s.ignoreWs, chord: "Shift:w" },
        {
            id: "wrap",
            label: "Wrap long lines",
            checked: s.wrap,
            disabled: !s.wrapAllowed,
            reason: s.wrapAllowed ? undefined : "Open a file to wrap its lines",
            chord: "Alt:z",
        },
        {
            id: "editor",
            label: "Open in editor",
            disabled: !s.editorAllowed,
            reason: s.editorAllowed ? undefined : "Only a file in the working tree can be opened",
        },
        {
            id: "code",
            label: "Open in Code",
            disabled: !s.codeAllowed,
            reason: s.codeAllowed ? undefined : "No repository is open",
        },
    ];
}
