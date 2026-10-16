// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's boss drawn as the person's pet (office pet boss spec, "Poses"): which pose, which way it faces,
// which marks over its head, at a time. Pure: cockpitoffice.tsx's BossView draws it. The rests are the footer's
// (petwalk.ts REST_POSES, PASTIMES), played in place: the boss never wanders, since where it stands is the cursor.

import type { PetExpression, PetPosture } from "@/app/view/jarvis/petcondition";
import { wearsTired } from "@/app/view/jarvis/petcondition";
import type { PetCharacter, PetMark, PetPose } from "@/app/view/jarvis/petsprite";
import { PASTIMES, POSTURE_MARK, REST_POSES, SLEEP_AFTER_MS } from "@/app/view/jarvis/petwalk";
import type { Dir } from "./officeboss";

// standing still this long, it starts its pastime
export const REST_AFTER_MS = 4_000;

export type BossRest = (typeof REST_POSES)[number];

export interface BossPetInput {
    moving: boolean;
    dir: Dir;
    // the office's walk frame (walkFrameAtom)
    frame: 0 | 1;
    // the facing it had: walking up or down keeps it
    flip: boolean;
    // when it last stopped, and when the person last walked, clicked or pressed a key in the office
    stillSince: number;
    lastInputAt: number;
    now: number;
    // the pastime picked when it stopped (pickRest)
    rest: BossRest;
    character: PetCharacter;
    expression: PetExpression["kind"];
    posture: PetPosture;
    speaking: boolean;
    unread: boolean;
}

export interface BossPetLook {
    pose: PetPose;
    flip: boolean;
    marks: PetMark[];
}

/** A pastime for the next time the boss stops, as the footer's walker picks one. */
export function pickRest(rand: () => number): BossRest {
    return REST_POSES[Math.min(REST_POSES.length - 1, Math.floor(rand() * REST_POSES.length))];
}

function poseOf(i: BossPetInput): PetPose {
    if (i.moving) {
        return i.frame === 0 ? "walk1" : "walk2";
    }
    if (i.now - i.lastInputAt >= SLEEP_AFTER_MS) {
        return "sleep";
    }
    if (i.speaking) {
        return "speak";
    }
    if (wearsTired(i.expression)) {
        return "tired";
    }
    const idle = i.now - i.stillSince - REST_AFTER_MS;
    if (idle < 0) {
        return "stand";
    }
    const pastime = PASTIMES[i.rest];
    if (pastime == null) {
        return i.rest as "stand" | "sit";
    }
    return pastime.frames[Math.floor(idle / pastime.frameMs) % pastime.frames.length];
}

export function bossPet(i: BossPetInput): BossPetLook {
    const pose = poseOf(i);
    const sideways = i.moving && (i.dir === "left" || i.dir === "right");
    // Peter's walk is front-on: never mirrored
    const flip = i.character === "spidey" ? false : sideways ? i.dir === "left" : i.flip;
    const marks: PetMark[] = [];
    const postureMark = POSTURE_MARK[i.posture];
    if (postureMark != null) {
        marks.push(postureMark);
    }
    if (pose === "tired") {
        marks.push("drop");
    }
    if (pose === "sleep") {
        marks.push("z");
    }
    if (i.unread) {
        marks.push("unread");
    }
    return { pose, flip, marks };
}
