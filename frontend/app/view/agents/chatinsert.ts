// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Putting text into an agent's chat box from outside it (an Alt-drop's @mention), the way termpaste.ts puts text into
// an agent's terminal. The box's text is React state (useAgentSend's), so the insert goes through it: the chat editor
// draws from that text, and a change made to the editor alone would be overwritten by the next render. The offsets are
// in the plain text (the message as the agent receives it, a file pill counting as the `@path` it is written as), which
// the editor's handle reports the way a textarea does. Each ChatComposer registers its insert under its agent id; this
// module has no imports, so no import cycle can run through it.

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

// What a visual in the conversation (chatvisualview.tsx) does with the box: read its draft, send a text as the person's
// message, or put a text at the end of it. `submit` and `append` answer false when the box took nothing (it is
// read-only while a wake is in flight).
export interface ChatBox {
    text(): string;
    submit(text: string): boolean;
    append(text: string): boolean;
}

const boxes = new Map<string, ChatBox>();

// returns the unregister; a remount that registered the agent again first is left alone
export function registerChatBox(agentId: string, box: ChatBox): () => void {
    boxes.set(agentId, box);
    return () => {
        if (boxes.get(agentId) === box) {
            boxes.delete(agentId);
        }
    };
}

// the box's current text; "" when the agent has no chat box mounted
export function chatBoxText(agentId: string): string {
    return boxes.get(agentId)?.text() ?? "";
}

// false when the agent has no chat box mounted, or the box would not take it
export function submitIntoChatBox(agentId: string, text: string): boolean {
    return boxes.get(agentId)?.submit(text) ?? false;
}

// false when the agent has no chat box mounted, or the box would not take it
export function appendToChatBox(agentId: string, text: string): boolean {
    return boxes.get(agentId)?.append(text) ?? false;
}
