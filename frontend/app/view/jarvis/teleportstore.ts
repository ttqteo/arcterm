// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which pet is teleporting (petteleport.ts), and since when: the walking one (petview.tsx, on the footer or the float's
// ledge) or the folded one (sprout-mini.tsx). floatstore.ts plays them round a fold and a restore. A pet that has
// departed stays gone until it arrives or the teleports are cleared; one that has arrived is the plain pet again.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { TELEPORT_MS, TELEPORT_TAIL_MS, type TeleportKind } from "./petteleport";

export type TeleportPlace = "walk" | "mini";

// at: performance.now() when it began
export interface TeleportRun {
    kind: TeleportKind | "gone";
    at: number;
}

export const petTeleportAtom = atom<Record<TeleportPlace, TeleportRun | null>>({
    walk: null,
    mini: null,
}) as PrimitiveAtom<Record<TeleportPlace, TeleportRun | null>>;

function setRun(place: TeleportPlace, run: TeleportRun | null): void {
    globalStore.set(petTeleportAtom, { ...globalStore.get(petTeleportAtom), [place]: run });
}

/** Play a teleport at a place. Resolves once it has played (TELEPORT_MS), its sparks still fading. */
export function playTeleport(place: TeleportPlace, kind: TeleportKind): Promise<void> {
    const run: TeleportRun = { kind, at: performance.now() };
    setRun(place, run);
    if (kind === "arrive") {
        // the plain pet takes over once the last spark has gone, unless another teleport has begun since
        setTimeout(() => {
            if (globalStore.get(petTeleportAtom)[place] === run) {
                setRun(place, null);
            }
        }, TELEPORT_TAIL_MS.arrive);
    }
    return new Promise((resolve) => setTimeout(resolve, TELEPORT_MS[kind]));
}

/** Hide the pet at a place until it arrives: the folded one before the window stands in the corner, the walking one
 *  while the window grows back. */
export function hidePet(place: TeleportPlace): void {
    setRun(place, { kind: "gone", at: 0 });
}

export function clearTeleports(): void {
    globalStore.set(petTeleportAtom, { walk: null, mini: null });
}
