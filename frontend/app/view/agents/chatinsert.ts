// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Putting text into an agent's chat box from outside it (an Alt-drop's @mention), the way termpaste.ts puts text into
// an agent's terminal. The box's text is React state (useAgentSend's), so the insert goes through it: writing the
// textarea's value from outside would be overwritten by the next render. Each ChatComposer registers its insert under
// its agent id; this module has no imports, so no import cycle can run through it.

// the text after an insert, and where the caret goes (both in UTF-16 units, as a textarea's selection counts them)
export function insertAt(
    text: string,
    selStart: number,
    selEnd: number,
    insert: string
): { text: string; caret: number } {
    const clamp = (n: number) => Math.min(Math.max(n, 0), text.length);
    const start = clamp(Math.min(selStart, selEnd));
    const end = clamp(Math.max(selStart, selEnd));
    return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

// false when the box took nothing
type ChatInsert = (text: string) => boolean;

const inserts = new Map<string, ChatInsert>();

// returns the unregister; a remount that registered the agent again first is left alone
export function registerChatInsert(agentId: string, insert: ChatInsert): () => void {
    inserts.set(agentId, insert);
    return () => {
        if (inserts.get(agentId) === insert) {
            inserts.delete(agentId);
        }
    };
}

// false when the agent has no chat box mounted (its cell shows Terminal)
export function insertIntoChatBox(agentId: string, text: string): boolean {
    return inserts.get(agentId)?.(text) ?? false;
}
