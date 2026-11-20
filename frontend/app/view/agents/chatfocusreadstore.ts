// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Focus read in Chat, the state half (chatfocusread.ts is the pure half, chatfocusreadview.ts the DOM half). The toggle
// is each agent's own: the agents that have it on are a list remembered in localStorage `chat.focusRead`. Each ChatPane
// registers its reader under its agent id, so the keys in bindings.ts and the pane's step buttons reach the conversation
// they act in (chatjump.ts and chatinsert.ts keep the same kind of registry).

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import {
    FOCUS_READ_DEFAULT_SIZE,
    parseFocusReadIds,
    parseFocusReadSize,
    withFocusRead,
    type FocusReadSize,
} from "./chatfocusread";

const STORAGE_KEY = "chat.focusRead";
const SIZE_KEY = "chat.focusRead.size";

function readSize(): FocusReadSize {
    try {
        return parseFocusReadSize(localStorage.getItem(SIZE_KEY));
    } catch {
        return FOCUS_READ_DEFAULT_SIZE;
    }
}

const sizeBase = atom<FocusReadSize>(readSize());

// how many blocks the line lights at a time (1 to 5, 3 to start): one reading preference for every agent, remembered
export const chatFocusReadSizeAtom = atom(
    (get) => get(sizeBase),
    (_get, set, next: FocusReadSize) => {
        set(sizeBase, next);
        try {
            localStorage.setItem(SIZE_KEY, String(next));
        } catch {
            // storage unavailable: the size holds for this session
        }
    }
);

// the toggle's key (agent:chat-focus-read), here so the button's tooltip names it without importing the bindings
export const FOCUS_READ_KEYS = "Alt:r";

function readIds(): string[] {
    try {
        return parseFocusReadIds(localStorage.getItem(STORAGE_KEY));
    } catch {
        return [];
    }
}

const idsAtom = atom<string[]>(readIds());

// the agents whose Chat reads one block at a time; the keybindings' predicates subscribe to it (whenstate.ts)
export const chatFocusReadIdsAtom = atom((get) => get(idsAtom));

// one agent's toggle; writing it keeps the list in localStorage
const onAtoms = new Map<string, ReturnType<typeof makeOnAtom>>();
function makeOnAtom(agentId: string) {
    return atom(
        (get) => get(idsAtom).includes(agentId),
        (get, set, next: boolean) => {
            const ids = withFocusRead(get(idsAtom), agentId, next);
            set(idsAtom, ids);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
            } catch {
                // storage unavailable: the toggle holds for this session
            }
        }
    );
}
export function chatFocusReadOnAtom(agentId: string) {
    let a = onAtoms.get(agentId);
    if (a == null) {
        a = makeOnAtom(agentId);
        onAtoms.set(agentId, a);
    }
    return a;
}

export function focusReadOn(agentId: string): boolean {
    return globalStore.get(chatFocusReadIdsAtom).includes(agentId);
}

export function setFocusReadOn(agentId: string, on: boolean): void {
    globalStore.set(chatFocusReadOnAtom(agentId), on);
}

/** What the keys do in one agent's Chat (or a markdown Preview) while focus read is on. */
export interface FocusReader {
    /** J / ↓ / Space (1) and K / ↑ / Shift+Space (-1): the next or previous block onto the line */
    step(dir: 1 | -1): void;
    /** Q: the lit blocks into the chat box as one quote, the focus left in the conversation; a document has none */
    quote?(): void;
}

// Focus read in the File tab's markdown Preview (mddoc.tsx): one switch for every document, remembered in localStorage
// `doc.focusRead` (off unless it says true). Its reader registers as DOC_READER_PREFIX + the file's path, and the
// Preview's scroller carries that id in `data-fr-reader`, so the keys find the document that holds the focus.
const DOC_STORAGE_KEY = "doc.focusRead";
export const DOC_READER_PREFIX = "doc:";

function readDocOn(): boolean {
    try {
        return localStorage.getItem(DOC_STORAGE_KEY) === "true";
    } catch {
        return false;
    }
}

const docOnBase = atom<boolean>(readDocOn());

export const docFocusReadOnAtom = atom(
    (get) => get(docOnBase),
    (_get, set, next: boolean) => {
        set(docOnBase, next);
        try {
            localStorage.setItem(DOC_STORAGE_KEY, next ? "true" : "false");
        } catch {
            // storage unavailable: the switch holds for this session
        }
    }
);

export function setDocFocusReadOn(on: boolean): void {
    globalStore.set(docFocusReadOnAtom, on);
}

// The markdown Preview that holds the keyboard focus, else null: its scroller (`data-md-doc`), or a control inside it
export function focusedDoc(): HTMLElement | null {
    if (typeof document === "undefined") {
        return null;
    }
    return document.activeElement?.closest?.<HTMLElement>("[data-md-doc]") ?? null;
}

// the reader id of the markdown Preview that holds the focus while doc focus read is on and its reader is registered
export function focusedDocReader(): string | null {
    if (!globalStore.get(docFocusReadOnAtom)) {
        return null;
    }
    const id = focusedDoc()?.getAttribute("data-fr-reader");
    return id != null && readers.has(id) ? id : null;
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
    if (typeof document === "undefined") {
        return null;
    }
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

// After a pick, so J/K step at once: the conversation shows only once the pick has rendered (a pane mounting the first
// time it shows takes a frame or two), so it is tried on the next few frames, and given up when it never shows (the agent
// in Terminal, asleep). Not when something else took the focus meanwhile (a dialog, a field, a terminal).
const SOON_FRAMES = 6;
export function focusConversationSoon(agentId: string, frames: number = SOON_FRAMES): void {
    const from = document.activeElement;
    requestAnimationFrame(() => {
        if (document.activeElement !== from) {
            return;
        }
        if (!focusConversation(agentId) && frames > 1) {
            focusConversationSoon(agentId, frames - 1);
        }
    });
}
