// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Whether the pet stays at its home instead of roaming (pet stay put spec §2): Roam, an hour, four hours, or until
// the user turns it off. Pure — petstore.ts holds the atom and the persistence, petwalk.ts the walking.
//
// A timed stay keeps an absolute end time, so a restart does not restart the clock. The stored stay is not rewritten
// when the time passes (the expiry timer does that a moment later), so every control reads it through
// shownStayChoice(stay, Date.now()) and shows Roam the instant a timed stay is over, never the stale choice.

export type PetStayChoice = "roam" | "1h" | "4h" | "forever";

// until is an absolute epoch ms for the timed choices, null for roam and forever
export interface PetStay {
    choice: PetStayChoice;
    until: number | null;
}

export const PET_ROAM: PetStay = { choice: "roam", until: null };

const HOUR_MS = 3_600_000;
const TIMED_MS: Partial<Record<PetStayChoice, number>> = { "1h": HOUR_MS, "4h": 4 * HOUR_MS };

export function stayFor(choice: PetStayChoice, now: number): PetStay {
    const span = TIMED_MS[choice];
    return span == null ? { choice, until: null } : { choice, until: now + span };
}

function isStayChoice(value: unknown): value is PetStayChoice {
    return value === "roam" || value === "1h" || value === "4h" || value === "forever";
}

// What the store holds under its key. A missing, malformed or already-ended value reads as roam: a stay the user
// started and then lost to a restart that outlived it has nothing left to honour.
export function parsePetStay(raw: string | null, now: number): PetStay {
    if (raw == null || raw.trim() === "") {
        return PET_ROAM;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return PET_ROAM;
    }
    if (parsed == null || typeof parsed !== "object") {
        return PET_ROAM;
    }
    const { choice, until } = parsed as { choice?: unknown; until?: unknown };
    if (!isStayChoice(choice) || choice === "roam") {
        return PET_ROAM;
    }
    if (choice === "forever") {
        return { choice, until: null };
    }
    return typeof until === "number" && Number.isFinite(until) && until > now ? { choice, until } : PET_ROAM;
}

export function isStaying(stay: PetStay, now: number): boolean {
    if (stay.choice === "roam") {
        return false;
    }
    if (stay.choice === "forever") {
        return true;
    }
    return stay.until != null && now < stay.until;
}

// The choice a control should show: an ended timed stay reads as Roam even before the expiry timer clears the atom.
export function shownStayChoice(stay: PetStay, now: number): PetStayChoice {
    return isStaying(stay, now) ? stay.choice : "roam";
}

// For the expiry timer: how long until a timed stay ends (0 once it has), null when there is nothing to time.
export function stayEndsInMs(stay: PetStay, now: number): number | null {
    if (TIMED_MS[stay.choice] == null || stay.until == null) {
        return null;
    }
    return Math.max(0, stay.until - now);
}

// "until 15:30": the local end time of a timed stay, 24-hour, which Settings shows on the row.
export function stayUntilLabel(stay: PetStay): string | null {
    if (TIMED_MS[stay.choice] == null || stay.until == null) {
        return null;
    }
    const end = new Date(stay.until);
    const two = (n: number) => String(n).padStart(2, "0");
    return `until ${two(end.getHours())}:${two(end.getMinutes())}`;
}

// The words of both controls, in one place: label is the Settings segment, menuLabel the peek's pin menu. The
// array is in the Settings order; the menu puts Roam again last and orders itself.
export const PET_STAY_CHOICES: { id: PetStayChoice; label: string; menuLabel: string }[] = [
    { id: "roam", label: "Roam", menuLabel: "Roam again" },
    { id: "1h", label: "Stay 1h", menuLabel: "Stay 1 hour" },
    { id: "4h", label: "Stay 4h", menuLabel: "Stay 4 hours" },
    { id: "forever", label: "Stay", menuLabel: "Stay until I turn it off" },
];
