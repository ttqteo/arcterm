// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's per-viewer choices (cockpit office spec, "Where it lives" and "Motion"), kept in localStorage
// like the pet's. Read them through cockpitView, officeAnimation and sanitizeHours, which turn anything unexpected
// into the default.

import type { PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_HOURS, type WorkHours } from "./officebehavior";

export type CockpitView = "cards" | "office";
export const DEFAULT_COCKPIT_VIEW: CockpitView = "cards";
export const DEFAULT_OFFICE_ANIMATION = true;

// Cards by default: the office is something to ask for (compact by default)
export const cockpitViewAtom = atomWithStorage<CockpitView>("cockpit.view", DEFAULT_COCKPIT_VIEW, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<CockpitView>;
export const officeHoursAtom = atomWithStorage<WorkHours>("cockpit.office.hours", DEFAULT_HOURS, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<WorkHours>;
export const officeAnimationAtom = atomWithStorage<boolean>(
    "cockpit.office.animation",
    DEFAULT_OFFICE_ANIMATION,
    undefined,
    { getOnInit: true }
) as PrimitiveAtom<boolean>;

export function cockpitView(v: unknown): CockpitView {
    return v === "office" ? "office" : "cards";
}

export function officeAnimation(v: unknown): boolean {
    return v !== false;
}
