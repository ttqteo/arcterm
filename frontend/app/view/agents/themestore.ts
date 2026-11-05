// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Theme selection state, persisted to localStorage (the atomWithStorage convention from railstore.ts /
// cockpitprefsstore.ts). Pure-frontend appearance -> no wconfig / no task generate.

import { useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useLayoutEffect } from "react";

import { activePalette, applyThemeVars, buildThemeVars, DEFAULT_THEME_PRESET, type OverrideRole } from "./themes";

// Exported so the Settings surface can mark the row changed and revert it without restating the literal.
export { DEFAULT_THEME_PRESET };

export const themePresetAtom = atomWithStorage<string>("cockpit.theme.preset", DEFAULT_THEME_PRESET);

// Per-role color overrides on top of the preset. Keyed by OverrideRole. Cleared when a preset is picked.
export const themeOverridesAtom = atomWithStorage<Partial<Record<OverrideRole, string>>>(
    "cockpit.theme.overrides",
    {}
);

// Settings → Appearance → Theme's "Christmas effects" switch, stored as "off" so the default (effects on) is false.
// Kept beside the preset and not reset by picking one: off, the Christmas palette stays and every decor and motion
// goes (christmas.ts hasChristmasDecor).
export const christmasEffectsOffAtom = atomWithStorage<boolean>("cockpit.theme.christmasEffectsOff", false);

// The Snow switch under Christmas effects: off by default, since a full-window animation costs frames the rest of the
// decor does not (christmas.ts christmasSnowShows).
export const christmasSnowOnAtom = atomWithStorage<boolean>("cockpit.theme.christmasSnow", false);

// Applies the active theme's CSS vars to <html> before paint. atomWithStorage hydrates synchronously
// from localStorage, so a non-default theme applies without a flash of the default. Always writes the full
// themed set, so switching presets needs no stale-key cleanup.
export function useApplyCockpitTheme(): void {
    const preset = useAtomValue(themePresetAtom);
    const overrides = useAtomValue(themeOverridesAtom);
    useLayoutEffect(() => {
        applyThemeVars(document.documentElement, buildThemeVars(activePalette(preset), overrides));
    }, [preset, overrides]);
}
