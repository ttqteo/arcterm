// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what a council's channel or thread says under the person's newest post while it waits, as a messenger does:
// `Sent`, then `Seen` with the seats working on it once a second has passed, and only after that their typing bubbles,
// so a send does not flip straight to "writing". Only a follow-up the seats are answering (councilmodel's ANSWERING) gets
// the line; a post that waits on something else keeps saying what (`Queued for the next step`) under itself. Read by
// councilchat.tsx's useSendState, which renders again when `nextMs` runs out.

import type { ChannelItem, ThreadItem, TypingRow, Who } from "./councilchatmodel";
import { ANSWERING } from "./councilmodel";

// how long after a send `Seen` shows, and the typing bubbles after it
export const SEEN_AFTER_MS = 1_000;
export const TYPING_AFTER_MS = 1_400;

export interface SendStatus {
    postId: string; // the person's post the line sits under
    word: "Sent" | "Seen";
    seen: Who[]; // with `Seen`: the seats working on it, as small avatars
}

export interface SendState {
    status: SendStatus | null;
    holdTyping: boolean; // the typing bubbles wait until TYPING_AFTER_MS after the send
    nextMs: number; // when this changes by itself; 0 for never
}

const IDLE: SendState = { status: null, holdTyping: false, nextMs: 0 };

/** The line under the person's newest post in `items` at `now` (ms), and whether the typing rows wait. A post a seat has
 *  answered since says nothing: the answer shows it. */
export function sendState(items: readonly (ChannelItem | ThreadItem)[], now: number): SendState {
    let at = -1;
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === "reply" && item.mine) {
            at = i;
            break;
        }
    }
    if (at < 0) {
        return IDLE;
    }
    const post = items[at];
    if (post.kind !== "reply" || post.pending !== ANSWERING) {
        return IDLE;
    }
    if (items.slice(at + 1).some((i) => i.kind === "reply" && !i.mine)) {
        return IDLE;
    }
    const age = Math.max(0, now - post.ts);
    const working = items.filter((i): i is TypingRow => i.kind === "typing" && !i.waiting);
    const holdTyping = age < TYPING_AFTER_MS;
    const nextMs = age < SEEN_AFTER_MS ? SEEN_AFTER_MS - age : holdTyping ? TYPING_AFTER_MS - age : 0;
    if (age < SEEN_AFTER_MS || working.length === 0) {
        return { status: { postId: post.id, word: "Sent", seen: [] }, holdTyping, nextMs };
    }
    const seen = working.map(({ author, name, initials, tone, tag, tab, transcript }) => ({
        author,
        name,
        initials,
        tone,
        tag,
        tab,
        transcript,
    }));
    return { status: { postId: post.id, word: "Seen", seen }, holdTyping, nextMs };
}

/** The items to draw: the typing rows that are not a wait leave while `holdTyping`. */
export function shownItems<T extends ChannelItem | ThreadItem>(items: readonly T[], holdTyping: boolean): T[] {
    return holdTyping ? items.filter((i) => i.kind !== "typing" || i.waiting) : [...items];
}
