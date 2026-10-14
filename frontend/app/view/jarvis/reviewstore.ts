// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Review state. The reviewed-at marks persist (like "Since you looked"'s cursor); a review pass does not. Module
// scope, not component state: the Brief unmounts on every surface switch, and the bindings that drive a pass
// (bindings.ts) read it with no component in reach.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { sessionNext, sessionStep } from "./reviewmodel";

// oref -> when the person last marked the initiative reviewed. getOnInit: the Brief reads it on its first render,
// and a first paint without it would flash every initiative as changed.
// Cast per this repo's convention: the storage's type admits an async read, which a synchronous localStorage never is.
export const reviewedAtom = atomWithStorage<Record<string, number>>("jarvis.review.reviewed", {}, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<Record<string, number>>;

export function markReviewed(oref: string, now: number): void {
    globalStore.set(reviewedAtom, { ...globalStore.get(reviewedAtom), [oref]: now });
}

// A review pass: the initiative it is on, the initiatives the queue held when it began (in order, so a marked one
// stays listed and "Reviewing 2 of 4" holds still), and when it began (a mark at or after it is this pass's).
export type ReviewMode = { cursor: string; orefs: string[]; startedAt: number };
export const reviewModeAtom = atom<ReviewMode | null>(null) as PrimitiveAtom<ReviewMode | null>;

// The orefs the Brief's review queue holds now, published by the Brief so `v` can begin a pass without a component.
export const reviewQueueAtom = atom<string[]>([]) as PrimitiveAtom<string[]>;

// Begin a pass over `orefs`; false when there is nothing to review.
export function enterReview(orefs: string[], now: number): boolean {
    if (orefs.length === 0) {
        return false;
    }
    globalStore.set(reviewModeAtom, { cursor: orefs[0], orefs: [...orefs], startedAt: now });
    return true;
}

export function exitReview(): void {
    globalStore.set(reviewModeAtom, null);
}

export function setReviewCursor(oref: string): void {
    const mode = globalStore.get(reviewModeAtom);
    if (mode != null && mode.cursor !== oref) {
        globalStore.set(reviewModeAtom, { ...mode, cursor: oref });
    }
}

// ← / → and j / k: the neighbour in the pass, wrapping
export function moveReview(delta: number): void {
    const mode = globalStore.get(reviewModeAtom);
    if (mode != null) {
        setReviewCursor(sessionStep(mode.orefs, mode.cursor, delta));
    }
}

// Move off `past` (the cursor by default) to the next initiative not yet marked in this pass; the cursor stays when
// every other one is marked. `past` counts as marked here, so an action whose mark lands later (Pause, once the
// server has written) still steps on.
export function advanceReview(past?: string): void {
    const mode = globalStore.get(reviewModeAtom);
    if (mode == null) {
        return;
    }
    const from = past ?? mode.cursor;
    const next = sessionNext(
        mode.orefs,
        { ...globalStore.get(reviewedAtom), [from]: mode.startedAt },
        mode.startedAt,
        from
    );
    if (next != null) {
        setReviewCursor(next);
    }
}

// Enter, and Keep going: mark the initiative the pass is on, then go to the next one
export function markReviewedAndAdvance(now: number): void {
    const mode = globalStore.get(reviewModeAtom);
    if (mode == null) {
        return;
    }
    markReviewed(mode.cursor, now);
    advanceReview(mode.cursor);
}
