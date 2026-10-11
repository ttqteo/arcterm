// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Jarvis tour's model: which step of which track is showing, what each step opens before it shows, where the
// spotlight goes, and the first-visit offer's flag. Pure, so the view (jarvistour.tsx) only measures, clicks and
// draws.

export type TourLang = "vi" | "en";
export type TourTrackId = "brief" | "initiatives" | "runsheet" | "profile";

// what a step needs open before its target can be on screen; a word, not a function, so the order is testable
export type TourPrepare = "profile" | "newestRun" | "firstInitiative";

export interface TourText {
    title: string;
    body: string;
}

export interface TourStep {
    id: string;
    // alternatives, tried in order: the first that matches is lit
    target?: string[];
    // lit with the target, each by its first match; one that matches nothing is left out
    also?: string[];
    prepare?: TourPrepare;
    vi: TourText;
    en: TourText;
}

export interface TourTrack {
    id: TourTrackId;
    vi: { title: string };
    en: { title: string };
    steps: TourStep[];
}

export interface TourState {
    track: TourTrackId;
    index: number;
}

export function tourStart(track: TourTrackId): TourState {
    return { track, index: 0 };
}

/** The next step, or null past the last: the track is over. */
export function tourNext(s: TourState, total: number): TourState | null {
    return s.index + 1 >= total ? null : { ...s, index: s.index + 1 };
}

export function tourBack(s: TourState): TourState {
    return { ...s, index: Math.max(0, s.index - 1) };
}

export function textOf(step: TourStep, lang: TourLang): TourText {
    return step[lang];
}

/**
 * What to close and open before a step, given what the tour itself opened: a step owns only its own `prepare`,
 * so going Back from the Profile to the header's Profile button closes the Profile again. `want` undefined is the
 * end of a track. Closing runs newest first.
 */
export function reconcile(
    opened: TourPrepare[],
    want?: TourPrepare
): { close: TourPrepare[]; open: TourPrepare | null } {
    const close = opened.filter((p) => p !== want).reverse();
    return { close, open: want != null && !opened.includes(want) ? want : null };
}

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export const SPOT_PAD = 6;

/** A lit box: the element padded, kept inside the viewport. */
export function spotRect(r: Rect, view: { width: number; height: number }): Rect {
    const left = Math.max(0, r.left - SPOT_PAD);
    const top = Math.max(0, r.top - SPOT_PAD);
    const right = Math.min(view.width, r.left + r.width + SPOT_PAD);
    const bottom = Math.min(view.height, r.top + r.height + SPOT_PAD);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function touches(a: Rect, b: Rect): boolean {
    return (
        a.left <= b.left + b.width &&
        b.left <= a.left + a.width &&
        a.top <= b.top + b.height &&
        b.top <= a.top + a.height
    );
}

function bounds(a: Rect, b: Rect): Rect {
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    return {
        left,
        top,
        width: Math.max(a.left + a.width, b.left + b.width) - left,
        height: Math.max(a.top + a.height, b.top + b.height) - top,
    };
}

/** Boxes that overlap or touch become their bounding box, until none do. The first box keeps the first rect. */
export function mergeBoxes(rects: Rect[]): Rect[] {
    const out = [...rects];
    for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
            if (touches(out[i], out[j])) {
                out[i] = bounds(out[i], out[j]);
                out.splice(j, 1);
                // the grown box may now reach one already passed
                i = -1;
                break;
            }
        }
    }
    return out;
}

export type StepView = { kind: "spot"; boxes: Rect[] } | { kind: "center" };

/**
 * How a step shows, given the rects its selectors found: every element lit, those that sit together in one box,
 * or the card centered when the step names nothing or nothing found has a size.
 */
export function stepView(step: TourStep, found: Rect[], view: { width: number; height: number }): StepView {
    const sized = found.filter((r) => r.width > 0 && r.height > 0);
    if ((step.target == null && step.also == null) || sized.length === 0) {
        return { kind: "center" };
    }
    return { kind: "spot", boxes: mergeBoxes(sized.map((r) => spotRect(r, view))) };
}

// The first-visit offer's flag. Read when the Brief mounts rather than held in an atomWithStorage, whose value is
// read once at module load: the CDP harness sets it after load (scripts/cdp/verify.mjs) so the offer stays out of
// every other scenario.
export const OFFERED_KEY = "jarvis.tour.offered";

interface FlagStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** Whether to offer the tour: not once it was answered, and not when storage cannot be read. */
export function shouldOffer(storage: FlagStorage): boolean {
    try {
        return storage.getItem(OFFERED_KEY) !== "true";
    } catch {
        return false;
    }
}

export function markOffered(storage: FlagStorage): void {
    try {
        storage.setItem(OFFERED_KEY, "true");
    } catch {
        // a blocked storage offers again next launch; nothing else depends on it
    }
}
