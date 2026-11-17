// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Sidecar dashboard's keys and ages are made of (spec 2026-11-17-sidecar-orbit-dashboard-design.md): the arrow
// keys' step through a list, a duration written the way the board writes it, the key a press means, and the answer an
// ask row takes. Pure; sidecarorbitmodel.ts builds the page's keys from them (and keeps the selection across a snapshot,
// `selectionAfter`) and the two views draw the ages. They lived beside the wall's tiling until the dashboard replaced
// the wall.

import type { SidecarAct, SidecarTile } from "./sidecartypes";

export type MoveKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * The index an arrow key moves the selection to. Left and right step through the items in reading order and stop at
 * the first and last; up and down step a row (`cols`), and a move to a place with no item stays where it is.
 */
export function moveSelection(index: number, key: MoveKey, cols: number, count: number): number {
    if (count <= 0) {
        return 0;
    }
    const i = Math.min(count - 1, Math.max(0, index));
    switch (key) {
        case "ArrowLeft":
            return Math.max(0, i - 1);
        case "ArrowRight":
            return Math.min(count - 1, i + 1);
        case "ArrowUp":
            return i - cols >= 0 ? i - cols : i;
        case "ArrowDown":
            return i + cols <= count - 1 ? i + cols : i;
    }
}

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** A duration as the board writes an age: `<1m`, `33m`, `1h`, `1h 05m`, `1d 3h`. */
export function formatTileAge(ms: number): string {
    if (ms < MIN_MS) {
        return "<1m";
    }
    if (ms < HOUR_MS) {
        return `${Math.floor(ms / MIN_MS)}m`;
    }
    if (ms < DAY_MS) {
        const h = Math.floor(ms / HOUR_MS);
        const m = Math.floor((ms % HOUR_MS) / MIN_MS);
        return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
    }
    const d = Math.floor(ms / DAY_MS);
    const h = Math.floor((ms % DAY_MS) / HOUR_MS);
    return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

/** How long ago `since` was: at the snapshot's `now`, plus the time since the snapshot arrived on the page. */
export function tileAgeMs(since: number, snapNow: number, sinceArrivedMs: number): number {
    return Math.max(0, snapNow + Math.max(0, sinceArrivedMs) - since);
}

/** An age text; empty when the snapshot has no `since` for it. */
export function ageText(since: number | undefined, snapNow: number, sinceArrivedMs: number): string {
    return since == null ? "" : formatTileAge(tileAgeMs(since, snapNow, sinceArrivedMs));
}

export type SidecarKeyAction = { kind: "move"; key: MoveKey } | { kind: "open" } | { kind: "answer"; option: number };

/** What a key does on the dashboard: an arrow moves, Enter opens, 1-9 answers option 0-8; null for any other key. */
export function sidecarKey(key: string): SidecarKeyAction | null {
    switch (key) {
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown":
            return { kind: "move", key };
        case "Enter":
            return { kind: "open" };
    }
    return /^[1-9]$/.test(key) ? { kind: "answer", option: Number(key) - 1 } : null;
}

/** Whether the ask takes this option from the keyboard or a button: answerable, keyed, not sent yet, and it has it. */
export function canAnswer(tile: Pick<SidecarTile, "ask" | "sent"> | undefined, option: number): boolean {
    const ask = tile?.ask;
    return (
        ask != null &&
        ask.answerable &&
        ask.key != null &&
        tile?.sent !== true &&
        option >= 0 &&
        option < ask.options.length
    );
}

/** The answer act for this option of the ask, naming the ask it answers; null when canAnswer says no. */
export function answerAct(
    tile: Pick<SidecarTile, "id" | "ask" | "sent"> | undefined,
    option: number
): Extract<SidecarAct, { kind: "answer" }> | null {
    if (tile == null || !canAnswer(tile, option)) {
        return null;
    }
    return { kind: "answer", id: tile.id, option, key: tile.ask!.key! };
}
