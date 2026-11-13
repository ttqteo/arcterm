// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Hide Jarvis for a while (docs/superpowers/specs/2026-11-13-jarvis-snooze-design.md): a right-click on Jarvis offers
// an hour, the next 8:00, or a typed time, and jarvis:hiddenuntil (Unix ms) keeps it off screen until then; Show Jarvis
// in the palette writes 0. Pure: the menu (petview.tsx) and the store (pethidestore.ts) read and write the setting. The
// times come from foldpause.ts, the folded Sprout's "Don't fold for", so the two read a typed time the same way.

import { HOUR_PAUSE_MS, MORNING_HOUR, nextMorning, parsePauseText, pauseEndLabel } from "@/app/view/agents/foldpause";

/** Whether jarvis:hiddenuntil keeps Jarvis hidden at `now`: unset, 0 or past is shown. */
export function jarvisHidden(raw: unknown, now: number): raw is number {
    return typeof raw === "number" && raw > now;
}

// setTimeout's longest delay; a later end is waited out in more than one wait
const MAX_TIMER_MS = 2 ** 31 - 1;

/** How long until a hide ends, for the timer that brings Jarvis back, or null when nothing is hidden. */
export function hideEndsInMs(raw: unknown, now: number): number | null {
    return jarvisHidden(raw, now) ? Math.min(raw - now, MAX_TIMER_MS) : null;
}

export interface HideChoice {
    key: "hour" | "morning";
    label: string;
    until: number;
}

/** The menu's two fixed choices at `now`: an hour from now, and the next 8:00. "Hide for…" (a typed time) is the third
 *  row, which opens a box rather than holding a time. */
export function hideChoices(now: number): HideChoice[] {
    return [
        { key: "hour", label: "Hide for 1 hour", until: now + HOUR_PAUSE_MS },
        { key: "morning", label: `Hide till ${MORNING_HOUR}:00`, until: nextMorning(now) },
    ];
}

export const HIDE_FOR_LABEL = "Hide for…";

/** What a typed hide reads as: when it ends, as the box says it, or null for text that is no time ("2h", "14:30"). */
export function typedHide(text: string, now: number): { until: number; label: string } | null {
    const until = parsePauseText(text, now);
    return until == null ? null : { until, label: pauseEndLabel(until, now) };
}
