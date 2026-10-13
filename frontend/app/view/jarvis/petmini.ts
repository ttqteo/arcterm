// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Sprout looks like while the float is folded into it (cockpit/sprout-mini.tsx): the walking pet's posture marks,
// a count of what waits, how many agents work, the errand's progress and a reply nobody has read; and what its hover
// card's chat row says. Pure, like petcondition.ts.

import type { PetPosture } from "./petcondition";
import type { PetMark, PetPose } from "./petsprite";
import type { PetErrand } from "./petstore";
import { POSTURE_MARK } from "./petwalk";

export interface MiniLookInput {
    posture: PetPosture;
    waiting: number;
    // agents working now: the "…" beside Sprout's head
    working: number;
    errand: PetErrand | null;
    unread: boolean;
    chatOpen: boolean;
    // the bob's tick: up on 1, and the typing pose's second frame
    frame: 0 | 1;
}

export interface MiniLook {
    pose: PetPose;
    marks: PetMark[];
    chip: number | null;
    // the agents working, shown as "…" and a count; null when none is
    working: number | null;
    bob: boolean;
    label: string;
}

export function miniLook(input: MiniLookInput): MiniLook {
    const busy = input.errand?.status === "streaming";
    const told = input.unread && !input.chatOpen;
    const postureMark = POSTURE_MARK[input.posture];
    const pose: PetPose = busy ? (input.frame === 0 ? "work1" : "work2") : told ? "speak" : "stand";
    // the typing pose draws notes where the marks go
    const marks: PetMark[] = busy ? [] : postureMark != null ? [postureMark] : told ? ["unread"] : [];
    const chip = input.waiting > 0 ? input.waiting : null;
    const working = input.working > 0 ? input.working : null;
    const status =
        chip != null
            ? `${chip} waiting on you`
            : busy
              ? "thinking"
              : told
                ? "new reply"
                : working != null
                  ? `${working} ${working === 1 ? "agent" : "agents"} working`
                  : null;
    // a click on Sprout gives the window back; the chat opens from the hover card
    const label = status == null ? "Restore the window" : `Restore the window — ${status}`;
    return { pose, marks, chip, working, bob: input.frame === 1, label };
}

// The hover card's row that opens the chat: what waits on you leads, then a reply nobody has read. Folded, the chat
// has no field to ask in, so the row names only what it shows.
export function miniChatLabel(waiting: number, unread: boolean): string {
    if (waiting > 0) {
        return `${waiting} waiting on you`;
    }
    return unread ? "New reply" : "Nothing waiting";
}

// What Spider-Man's rooftop shows for a fold look: lit windows for the working agents, spider-sense for what waits,
// swinging legs on the bob's beat, the unread mark, and the working dots while Jarvis types.
export interface SpideyFoldLook {
    lit: number;
    sense: boolean;
    swing: boolean;
    unread: boolean;
    thinking: boolean;
}

const WAITING_MARKS: readonly PetMark[] = ["gate", "escalation", "blocked"];

export function spideyFoldLook(look: MiniLook, frame: 0 | 1): SpideyFoldLook {
    const sense = look.chip != null || look.marks.some((m) => WAITING_MARKS.includes(m));
    return {
        lit: Math.min(look.working ?? 0, 4),
        sense,
        swing: frame === 1 && !sense,
        unread: look.marks.includes("unread"),
        thinking: look.pose === "work1" || look.pose === "work2",
    };
}

// A reply that lands, or fails, while the chat is folded stays unread until the chat opens or its bubble is dismissed:
// a folded window is where a reply is easiest to miss.
export function nextUnread(
    prev: PetErrand | null,
    next: PetErrand | null,
    chatOpen: boolean,
    unread: boolean
): boolean {
    if (chatOpen || next == null) {
        return false;
    }
    if (prev?.status === "streaming" && next.status !== "streaming") {
        return true;
    }
    return unread;
}
