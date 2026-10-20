// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The apps pinned to the nav rail: the pin list (localStorage apps.rail) and the service the app surface shows.
// Module-level atoms: every surface but Agent unmounts on a switch. The pure parts are in railapps.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { movedRailPin, parseRailPins, withRailPin } from "./railapps";
import { servicesAtom } from "./servicesstore";

const PINS_KEY = "apps.rail";

function readPins(): string[] {
    try {
        return parseRailPins(localStorage.getItem(PINS_KEY));
    } catch {
        return [];
    }
}

const pinsBaseAtom = atom<string[]>(readPins());

// the service ids on the rail, in the person's order; the model decides which of them still show
export const railPinsAtom = atom(
    (get) => get(pinsBaseAtom),
    (_get, set, next: string[]) => {
        set(pinsBaseAtom, next);
        try {
            localStorage.setItem(PINS_KEY, JSON.stringify(next));
        } catch {
            // storage unavailable: the pins hold for this session
        }
    }
);

// the service the app surface shows: the id of the rail item last opened
export const appSurfaceIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// Both writers wait for the first read of the services: the model drops a pin whose service is gone, and until then
// none is known to be.
export function setRailPinned(id: string, on: boolean): void {
    const services = globalStore.get(servicesAtom);
    if (services == null) {
        return;
    }
    globalStore.set(railPinsAtom, withRailPin(globalStore.get(railPinsAtom), id, on, services));
}

export function moveRailPin(id: string, by: -1 | 1): void {
    const services = globalStore.get(servicesAtom);
    if (services == null) {
        return;
    }
    globalStore.set(railPinsAtom, movedRailPin(globalStore.get(railPinsAtom), id, by, services));
}
