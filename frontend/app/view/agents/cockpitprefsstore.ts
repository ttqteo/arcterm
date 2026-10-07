// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Cockpit-native preferences persisted to localStorage (the atomWithStorage convention established
// by railstore.ts). The Settings surface edits these; the cockpit reads them on boot.

import type { PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { SURFACE_ORDER, type SurfaceKey } from "./agents";

// Which surface opens on launch: a surface, or "last" for the one that was open when the app last closed.
export type StartupSurface = SurfaceKey | "last";

export const DEFAULT_STARTUP_SURFACE: StartupSurface = "last";

// getOnInit is load-bearing: the boot reads this once, before anything mounts it, and without it that read got the
// default instead of the stored choice. The cast is railstore.ts's (jotai 2.9.3 otherwise types it as a promise).
export const startupSurfaceAtom = atomWithStorage<StartupSurface>(
    "cockpit.startup.surface",
    DEFAULT_STARTUP_SURFACE,
    undefined,
    { getOnInit: true }
) as PrimitiveAtom<StartupSurface>;

// The last surface of SURFACE_ORDER that was open, written on every switch (rememberSurface). Setup and Settings are not
// remembered, so a launch after closing on one of them reopens on the surface you came to it from.
export const lastSurfaceAtom = atomWithStorage<string>("cockpit.last.surface", "cockpit", undefined, {
    getOnInit: true,
}) as PrimitiveAtom<string>;

// Pure: the value to remember for a switch to `surface`, or null to keep the one stored.
export function rememberSurface(surface: SurfaceKey): SurfaceKey | null {
    return SURFACE_ORDER.includes(surface) ? surface : null;
}

// A persisted "activity" or "sessions" (retired surfaces: Activity folded into Sessions, Sessions into Agent's Conversation
// History) coerces to "agent", so a stored legacy startup value boots into the Agent surface (the Settings picker then
// shows no highlighted option for it). Callers that seed surfaceAtom from the stored value must route through this so a
// stale key never renders a blank surface.
export function coerceStartupSurface(k: SurfaceKey | "activity" | "sessions"): SurfaceKey {
    return (k as string) === "activity" || (k as string) === "sessions" ? "agent" : (k as SurfaceKey);
}

// Pure: the surface a launch opens on. "last" reopens the remembered surface; whatever is stored there is read, not
// trusted (a hand edit, a surface since removed), and anything that is not a current surface falls back to the cockpit.
export function bootSurface(startup: StartupSurface | "activity" | "sessions", last: unknown): SurfaceKey {
    if (startup !== "last") {
        return coerceStartupSurface(startup);
    }
    if (last === "activity" || last === "sessions") {
        return "agent";
    }
    return SURFACE_ORDER.find((k) => k === last) ?? "cockpit";
}

// Choices offered for the startup surface: "last" first, then the numbered workflow set minus "agent", which is not
// offered as a picked default (it is only meaningful with a live agent); "last" still reopens it. A legacy value that
// coerces to "agent" above still boots there. "settings" is naturally absent — it was never in SURFACE_ORDER.
export function startupSurfaceOptions(): StartupSurface[] {
    return ["last", ...SURFACE_ORDER.filter((k) => k !== "agent")];
}

const FONT_SIZE_MIN = 6;
const FONT_SIZE_MAX = 48;

// Parse a font-size input to an integer within range, or null when the input isn't a usable number
// (so the caller can skip the config write instead of persisting garbage).
export function coerceFontSize(raw: string): number | null {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) {
        return null;
    }
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.floor(n)));
}

const SCROLLBACK_MIN = 0;
const SCROLLBACK_MAX = 100000;

// Parse a scrollback input to an integer within range, or null when unusable (so the caller can skip
// the config write instead of persisting garbage). Mirrors coerceFontSize.
export function coerceScrollback(raw: string): number | null {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) {
        return null;
    }
    return Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, Math.floor(n)));
}

// Clamp a transparency value to [0, 1]. Non-finite input coerces to 0 (fully opaque).
export function coerceTransparency(n: number): number {
    if (!Number.isFinite(n)) {
        return 0;
    }
    return Math.min(1, Math.max(0, n));
}

// Decide whether a stat result is a valid vault target. Returns an error message to surface, or null
// when the folder is safe to save. Callers skip the stat (and this check) for an empty path — clearing
// the override is valid and falls back to the default vault dir.
export function vaultPathError(info: { notfound?: boolean; isdir?: boolean }): string | null {
    if (info.notfound) {
        return "Folder not found";
    }
    if (!info.isdir) {
        return "Not a folder";
    }
    return null;
}
