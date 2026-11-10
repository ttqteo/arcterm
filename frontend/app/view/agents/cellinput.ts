// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one rule for what takes the keyboard in an agent's cell. Every hand-off that gives it back to "the agent" (the
// surface's own focus routes, a drop, the float note or the translate panel closing) asks here, so none of them
// picks the xterm under a chat layer by its own selector.

// What takes the keyboard in an agent's cell: its chat box while the cell shows Chat (the xterm is still mounted
// underneath it, so it would also pass checkVisibility, and typing would go to a terminal nobody can see), else its
// xterm. Null when neither is showing. Reads the DOM, so it is what is on screen, whichever mode the store says. A chat
// layer fading out (ChatPane marks it data-chat-leaving) is no longer showing: it stays in the DOM for its exit, but
// the keyboard belongs to the xterm under it from the moment of the flip.
export function cellInputOf(root: ParentNode | null | undefined, id: string): HTMLElement | null {
    const box = root?.querySelector<HTMLElement>(
        `[data-agent-chat="${id}"]:not([data-chat-leaving]) [data-agent-chat-composer] textarea`
    );
    if (box != null) {
        return box.checkVisibility() ? box : null;
    }
    const term = root?.querySelector<HTMLElement>(`[data-agent-terminal="${id}"] .xterm-helper-textarea`);
    return term?.checkVisibility() ? term : null;
}

// The cell's chat box when the cell shows Chat, else null: the cell's input only when it is the box, never its xterm.
export function chatInputOf(root: ParentNode | null | undefined, id: string): HTMLElement | null {
    const input = cellInputOf(root, id);
    return input?.closest("[data-agent-chat-composer]") != null ? input : null;
}
