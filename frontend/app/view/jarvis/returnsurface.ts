// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where each jump came from. Opening an item on another surface remembers the surface the user was on, and
// going back (Escape, or closing the sheet, record peek or DAG modal the jump opened) returns there. The trail
// holds only jumps made through landOn: moving by hand (the rail, a surface chord) clears it, so a back long
// after the user moved on never pulls them somewhere stale. It restores the surface, not the selection on it.

import { globalStore } from "@/app/store/jotaiStore";
import type { PrimitiveAtom } from "jotai";
import type { SurfaceKey } from "../agents/agents";

// the thing a jump opened whose close ends the visit; a jump with none ends on Escape alone
export type ReturnCloser = "sheet" | "record" | "dag";

type SurfaceAtom = PrimitiveAtom<SurfaceKey>;
type Visit = { from: SurfaceKey; closer?: ReturnCloser; onReturn?: () => void };

let trail: Visit[] = [];
let watched: { surfaceAtom: SurfaceAtom; unsub: () => void } | null = null;
let moving = false;

export function forgetOrigin(): void {
    trail = [];
    watched?.unsub();
    watched = null;
}

// a surface change this module makes keeps the trail; any other clears it
function move(surfaceAtom: SurfaceAtom, to: SurfaceKey): void {
    moving = true;
    try {
        globalStore.set(surfaceAtom, to);
    } finally {
        moving = false;
    }
}

function watch(surfaceAtom: SurfaceAtom): void {
    if (watched?.surfaceAtom === surfaceAtom) {
        return;
    }
    forgetOrigin();
    const unsub = globalStore.sub(surfaceAtom, () => {
        if (!moving) {
            forgetOrigin();
        }
    });
    watched = { surfaceAtom, unsub };
}

// Switch to the destination surface, remembering the one left. A jump made from the destination itself adds
// nothing: stepping between runs in the sheet is still the same visit.
export function landOn(surfaceAtom: SurfaceAtom, to: SurfaceKey, closer?: ReturnCloser): void {
    const from = globalStore.get(surfaceAtom);
    if (from === to) {
        return;
    }
    watch(surfaceAtom);
    trail.push({ from, closer });
    move(surfaceAtom, to);
}

// A jump that opens something over its destination (the DAG over the sheet) hands the return to that. onReturn
// puts away what the jump left open underneath, which going back would otherwise leave for the next visit.
export function returnWhenClosed(closer: ReturnCloser, onReturn?: () => void): void {
    const visit = trail[trail.length - 1];
    if (visit != null) {
        visit.closer = closer;
        visit.onReturn = onReturn;
    }
}

// What the jump opened handed the user on (the record peek opening a run's sheet), so closing that one ends the
// visit instead. A return some other closer holds is left alone.
export function passReturn(from: ReturnCloser, to: ReturnCloser): void {
    const visit = trail[trail.length - 1];
    if (visit?.closer === from) {
        visit.closer = to;
    }
}

// Back one jump. False when there is none to go back over, so the caller can fall through to its own default.
export function backToOrigin(): boolean {
    const visit = trail.pop();
    if (visit == null || watched == null) {
        return false;
    }
    const { surfaceAtom } = watched;
    if (trail.length === 0) {
        forgetOrigin();
    }
    visit.onReturn?.();
    move(surfaceAtom, visit.from);
    return true;
}

export function returnToOrigin(closer: ReturnCloser): void {
    if (trail[trail.length - 1]?.closer === closer) {
        backToOrigin();
    }
}
