// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Jarvis says when a worker width you just picked is more than the machine's free RAM holds: a new run
// started that wide, or a live run's Adjust saved that wide. Said once, as a warning notice (petvoice.ts), at
// the moment of the pick; the standing "RAM is full" face is petcondition.ts's ram-full.

import { globalStore } from "@/app/store/jotaiStore";
import { formatGB, overCapacity, type WorkerCapacity } from "../agents/workercapacity";
import { workerCapacityAtom } from "../agents/workercapacitystore";
import { pushPetEvent } from "./petstore";
import type { PetEvent } from "./petvoice";

export interface WorkerPick {
    picked: number; // the width chosen
    extra: number; // the new workers it adds (workercapacity.extraWorkers)
    live: boolean; // a live run's Adjust, rather than a new run
}

export function overCapacitySpeech(cap: WorkerCapacity | null, pick: WorkerPick): string | null {
    if (cap == null || !overCapacity(cap, pick.extra)) {
        return null;
    }
    const head = pick.live ? `Raising to ${pick.picked} workers` : `Starting ${pick.picked} workers`;
    return `${head}, but RAM fits ~${cap.moreworkers} more (${formatGB(cap.availablebytes)} free) — expect swapping.`;
}

export function overCapacityEvent(cap: WorkerCapacity | null, pick: WorkerPick, now: number): PetEvent | null {
    const text = overCapacitySpeech(cap, pick);
    return text == null ? null : { id: `ram-over:${now}`, at: now, kind: "notify", level: "warn", text };
}

// The pick's call sites (createRun, the lead card's Save) call this after the pick took effect.
export function sayIfOverCapacity(pick: WorkerPick): void {
    const event = overCapacityEvent(globalStore.get(workerCapacityAtom), pick, Date.now());
    if (event != null) {
        pushPetEvent(event);
    }
}
