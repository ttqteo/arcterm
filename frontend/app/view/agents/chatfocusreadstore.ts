// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Focus read in Chat, the state half (chatfocusread.ts is the pure half, chatfocusreadview.ts the DOM half). The toggle
// is global across agents and remembered in localStorage `chat.focusRead`, the way Skim's `chat.skim` is. Each ChatPane
// registers its reader under its agent id, so the keys in bindings.ts reach the conversation that holds the focus
// (chatjump.ts and chatinsert.ts keep the same kind of registry).

import { atom } from "jotai";
import { parseFocusReadOn } from "./chatfocusread";

const STORAGE_KEY = "chat.focusRead";

// the toggle's key (agent:chat-focus-read), here so the button's tooltip names it without importing the bindings
export const FOCUS_READ_KEYS = "Alt:r";

function readOn(): boolean {
    try {
        return parseFocusReadOn(localStorage.getItem(STORAGE_KEY));
    } catch {
        return false;
    }
}

const onAtom = atom<boolean>(readOn());

// whether Chat reads one block at a time; writing it keeps it in localStorage
export const chatFocusReadOnAtom = atom(
    (get) => get(onAtom),
    (_get, set, next: boolean) => {
        set(onAtom, next);
        try {
            localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
        } catch {
            // storage unavailable: the toggle holds for this session
        }
    }
);

/** What the keys do in one agent's Chat while focus read is on. */
export interface FocusReader {
    /** J / Space (1) and K / Shift+Space (-1): the next or previous block onto the line */
    step(dir: 1 | -1): void;
    /** Q: the lit block into the chat box as a quote, the focus left in the conversation */
    quote(): void;
}

const readers = new Map<string, FocusReader>();

// returns the unregister; a remount that registered the agent again first is left alone
export function registerFocusReader(agentId: string, reader: FocusReader): () => void {
    readers.set(agentId, reader);
    return () => {
        if (readers.get(agentId) === reader) {
            readers.delete(agentId);
        }
    };
}

// the reader of an agent whose Chat is mounted, else undefined
export function focusReaderOf(agentId: string): FocusReader | undefined {
    return readers.get(agentId);
}

// The agent whose Chat conversation holds the keyboard focus (the scroller, or a control inside it), else null: where
// J/K/Space/Q act. Not the chat box, which is outside the scroller, and not a pane fading out to Terminal.
export function focusedConversationAgent(): string | null {
    if (typeof document === "undefined") {
        return null;
    }
    const scroller = document.activeElement?.closest?.("[data-chat-scroller]");
    const pane = scroller?.closest("[data-agent-chat]:not([data-chat-leaving])");
    return pane?.getAttribute("data-agent-chat") ?? null;
}

// an agent's Chat conversation on screen (not a pane fading out to Terminal, not one hidden), else null; by the DOM, since
// the reader registers only once focus read is on
function conversationOf(agentId: string): HTMLElement | null {
    const scroller = document.querySelector<HTMLElement>(
        `[data-agent-chat="${CSS.escape(agentId)}"]:not([data-chat-leaving]) [data-chat-scroller]`
    );
    return scroller?.checkVisibility() ? scroller : null;
}

// whether the agent shows its Chat conversation
export function conversationShown(agentId: string): boolean {
    return conversationOf(agentId) != null;
}

// Puts the keyboard focus in an agent's Chat conversation, so J/K act at once after focus read is turned on; false when
// the agent shows no Chat.
export function focusConversation(agentId: string): boolean {
    const scroller = conversationOf(agentId);
    scroller?.focus({ preventScroll: true });
    return scroller != null;
}
