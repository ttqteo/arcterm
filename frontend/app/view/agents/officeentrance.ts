// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The boss pet's entrance each time the Cockpit office opens (office pet boss spec, "Entrance"): Spider-Man swings in
// through the window nearest the boss's spot, lands, stands, unmasks and turns into Peter the boss in a puff; Sprout and
// the Minion arrive by the teleport's beam. Skipped within ENTRANCE_COOLDOWN_MS of leaving the office and under reduced
// motion. Pure but for when the office was last left, which is module state: a launch starts with none, so the first
// office of a launch always plays it.

import type { PetCharacter } from "@/app/view/jarvis/petsprite";
import { TELEPORT_MS } from "@/app/view/jarvis/petteleport";
import type { Point } from "./officeplanmodel";

export const ENTRANCE_COOLDOWN_MS = 120_000;

export type EntrancePhase = "swing" | "land" | "stand" | "unmask" | "puff" | "beam" | "done";

// the canvas's Entrance board: each phase until this many ms
const SPIDEY_TIMELINE: [EntrancePhase, number][] = [
    ["swing", 700],
    ["land", 1000],
    ["stand", 1300],
    ["unmask", 1800],
    ["puff", 2200],
];

const CELL = 3;
// how far below the straight line the swing dips at its middle, as a share of the drop
const SWING_DIP = 0.35;

let leftAt: number | null = null;

/** The office unmounted (Cards, or another surface). */
export function markOfficeLeft(now: number): void {
    leftAt = now;
}

/** For tests. */
export function resetOfficeLeft(): void {
    leftAt = null;
}

export function shouldPlayEntrance(now: number, reduce: boolean): boolean {
    return !reduce && (leftAt == null || now - leftAt >= ENTRANCE_COOLDOWN_MS);
}

export function entranceLength(character: PetCharacter): number {
    return character === "spidey" ? SPIDEY_TIMELINE[SPIDEY_TIMELINE.length - 1][1] : TELEPORT_MS.arrive;
}

export function entrancePhase(character: PetCharacter, t: number): EntrancePhase {
    if (character !== "spidey") {
        return t < TELEPORT_MS.arrive ? "beam" : "done";
    }
    for (const [phase, until] of SPIDEY_TIMELINE) {
        if (t < until) {
            return phase;
        }
    }
    return "done";
}

const snap = (v: number) => Math.round(v / CELL) * CELL;

/** Where the swing has him at k (0..1) from the window `from` to the spot `to`: a line that sags like a pendulum. */
export function swingPoint(from: Point, to: Point, k: number): Point {
    const e = Math.min(1, Math.max(0, k));
    const dip = Math.sin(Math.PI * e) * SWING_DIP * Math.abs(to.y - from.y);
    return { x: snap(from.x + (to.x - from.x) * e), y: snap(from.y + (to.y - from.y) * e + dip) };
}

/** The window nearest the spot along the wall, or null when the floor has none. */
export function nearestWindow(windows: readonly Point[], spot: Point): Point | null {
    let best: Point | null = null;
    for (const w of windows) {
        if (best == null || Math.abs(w.x - spot.x) < Math.abs(best.x - spot.x)) {
            best = w;
        }
    }
    return best;
}
