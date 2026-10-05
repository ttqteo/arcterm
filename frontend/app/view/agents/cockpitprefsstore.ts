// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Cockpit-native preferences persisted to localStorage (the atomWithStorage convention established
// by railstore.ts). The Settings surface edits these; the cockpit reads them on boot.

import { atomWithStorage } from "jotai/utils";
import { SURFACE_ORDER, type SurfaceKey } from "./agents";

// Which surface opens on launch. Defaults to the cockpit overview (matches prior hardcoded behavior).
export const DEFAULT_STARTUP_SURFACE: SurfaceKey = "cockpit";

export const startupSurfaceAtom = atomWithStorage<SurfaceKey>("cockpit.startup.surface", DEFAULT_STARTUP_SURFACE);

// A persisted "activity" or "sessions" (retired surfaces: Activity folded into Sessions, Sessions into Agent's Conversation
// History) coerces to "agent", so a stored legacy startup value boots into the Agent surface (the Settings picker then
// shows no highlighted option for it). Callers that seed surfaceAtom from the stored value must route through this so a
// stale key never renders a blank surface.
export function coerceStartupSurface(k: SurfaceKey | "activity" | "sessions"): SurfaceKey {
    return (k as string) === "activity" || (k as string) === "sessions" ? "agent" : (k as SurfaceKey);
}

// Surfaces offered as a startup choice: the numbered workflow set minus "agent", which is not offered as a picked default
// (it is only meaningful with a live agent). A legacy value that coerces to "agent" above still boots there.
// "settings" is naturally absent — it was never in SURFACE_ORDER.
export function startupSurfaceOptions(): SurfaceKey[] {
    return SURFACE_ORDER.filter((k) => k !== "agent");
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
