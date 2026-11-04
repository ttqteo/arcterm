// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Showing one message of a council's chat from outside it: the Report's Final proposal has Open in Discussion, which
// lands on the message where it was said. A module-level atom, like councilstore.ts's other UI state, so the request
// outlives the Report that made it: the chat (councilchat.tsx) mounts after the view switches, reads the request once
// it is on screen, scrolls to the message and sets the atom back to null.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { showCouncil } from "./agentcenter";

/** The message a council's chat is asked to show: its id (an idea's P1 or a reply's r3), and the council it is in. */
export interface CouncilReveal {
    councilId: string;
    messageId: string;
}

/** The pending request to show a message in a council's chat, or null while there is none. The chat consumes it. */
export const councilRevealAtom = atom<CouncilReveal | null>(null) as PrimitiveAtom<CouncilReveal | null>;

/** Opens the council on its Discussion, showing everyone's messages (showCouncil clears the one-seat filter), and leaves
 *  the chat a request to show the message `messageId`: what it does with it (the scroll, the thread a reply sits in) is
 *  the chat's. */
export function revealCouncilMessage(councilId: string, messageId: string): void {
    showCouncil(councilId, "discussion");
    globalStore.set(councilRevealAtom, { councilId, messageId });
}
