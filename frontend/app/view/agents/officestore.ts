// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's per-viewer choices (cockpit office spec, "Where it lives" and "Motion"), kept in localStorage
// like the pet's. Read them through cockpitView, officeAnimation and sanitizeHours, which turn anything unexpected
// into the default.

import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_HOURS, type WorkHours } from "./officebehavior";
import { EMPTY_LAYOUT, type OfficeLayout, type RoomPlace } from "./officelayout";

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
// the card beside the desk drawn big (⤢ or f), kept for the next card
export const officeBigCardAtom = atomWithStorage<boolean>("cockpit.office.bigcard", false, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<boolean>;
export const officeAnimationAtom = atomWithStorage<boolean>(
    "cockpit.office.animation",
    DEFAULT_OFFICE_ANIMATION,
    undefined,
    { getOnInit: true }
) as PrimitiveAtom<boolean>;

// the rooms' arrangement over the floors, per viewer (office floors spec, "The arrangement"). atomWithStorage hands back
// whatever JSON was stored: read it through parseLayout
export const officeLayoutAtom = atomWithStorage<OfficeLayout>("cockpit.office.layout", EMPTY_LAYOUT, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<OfficeLayout>;
// the floor the office shows; not kept: the office opens on G
export const officeFloorAtom = atom(0) as PrimitiveAtom<number>;

export function cockpitView(v: unknown): CockpitView {
    return v === "office" ? "office" : "cards";
}

export function officeAnimation(v: unknown): boolean {
    return v !== false;
}

// the Events rail while the Cockpit shows Office: hidden there until the office menu's Events (or the footer's event
// line) shows it; Esc while walking hides it again. Not kept: Office opens with the rail hidden.
export const officeEventsOpenAtom = atom(false) as PrimitiveAtom<boolean>;

// the office menu (m) is open: cockpitoffice.tsx opens and shuts it, and the footer's m chip lights while it is open
export const officeMenuOpenAtom = atom(false) as PrimitiveAtom<boolean>;

// the notice board's page in view (one page per Needs you row, officeboardmodel.ts), and whether the Why of that page is
// open: shut again whenever the page changes. Not kept: the office opens on the first page
export const officeBoardPageAtom = atom(0) as PrimitiveAtom<number>;
export const officeBoardWhyAtom = atom(false) as PrimitiveAtom<boolean>;

/** A room picked up to move (office floors spec, "Arranging rooms"): by keyboard (g) or by dragging its title. The target
 *  is where a drop puts it: a slot of some floor, `"new"` for the floor above the top one, and by pointer null while the
 *  pointer is over no slot and no floor that can take it. */
export interface Carry {
    project: string;
    from: RoomPlace;
    target: RoomPlace | "new" | null;
    by: "key" | "pointer";
}
// the room being carried; null while none is. Not kept: a reload puts it back
export const officeCarryAtom = atom<Carry | null>(null) as PrimitiveAtom<Carry | null>;
