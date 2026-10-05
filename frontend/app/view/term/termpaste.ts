// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reaches a mounted terminal by its block id, so the cockpit can put text into an agent's terminal the way a paste
// does: through xterm's own paste(), which brackets the text when the program asked for bracketed paste (Claude
// Code does) and sends it as typed text when it did not, and never presses Enter. Each TermWrap registers itself;
// the callers (uploadsingest.ts) never import termwrap.ts or the cockpit, so this module has no imports and no
// import cycle can run through it.

export interface TermHandle {
    // false when the terminal cannot take input yet (nothing was pasted)
    paste: (text: string) => boolean;
    focus: () => void;
}

const handles = new Map<string, TermHandle>();

// returns the unregister; a remount that registered the block again first is left alone
export function registerTermHandle(blockId: string, handle: TermHandle): () => void {
    handles.set(blockId, handle);
    return () => {
        if (handles.get(blockId) === handle) {
            handles.delete(blockId);
        }
    };
}

// false when the block has no mounted terminal, or one that is not ready for input
export function pasteIntoTerm(blockId: string, text: string): boolean {
    return handles.get(blockId)?.paste(text) ?? false;
}

export function focusTerm(blockId: string): void {
    handles.get(blockId)?.focus();
}
