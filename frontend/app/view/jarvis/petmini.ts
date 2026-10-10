// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Sprout looks like while the float is folded into it (cockpit/sprout-mini.tsx): the walking pet's posture marks,
// a count of what waits, how many agents work, the errand's progress and a reply nobody has read. Pure, like petcondition.ts.

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
    const label = input.chatOpen
        ? "Collapse Jarvis chat"
        : status == null
          ? "Open Jarvis chat"
          : `Open Jarvis chat — ${status}`;
    return { pose, marks, chip, working, bob: input.frame === 1, label };
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
