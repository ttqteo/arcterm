// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar wall's pure model (spec 2026-11-13-sidecar-design.md, section 3; board D-fit-by-count): the grid shape
// for a window size and an agent count, the selection and its keys, and a tile's age text. sidecarwall.tsx draws it.
// This file is sidecarwallmodel.ts, never sidecarwall.ts: Vite and TS resolve .ts before .tsx, so a sidecarwall.ts
// beside the component would shadow it.

import type { SidecarTile } from "./sidecartypes";

/** The gap between tiles, px. */
export const WALL_GAP = 12;
/** The smallest readable tile, px. Past it the tiles stay this size and the wall scrolls. */
export const MIN_TILE_W = 300;
export const MIN_TILE_H = 170;
/** The most message rows a tile shows: the tallest tile (one agent on a 1080p screen) and the snapshot's cap. */
export const MAX_TILE_MSGS = 8;

// What a tile spends its height on besides messages, and what one message row takes (px). The header is the name row
// and the project line; the strip is the tallest bottom block, an ask (band, a two-line question, a row of buttons),
// so the one count of messages fits every tile of the wall. A row is a sentence of one or two lines and its tool line.
const TILE_HEAD_H = 48;
const TILE_STRIP_H = 122;
const MSG_ROW_H = 52;

export interface WallShape {
    cols: number;
    rows: number;
    /** message rows a tile shows */
    msgs: number;
    /** a tile's size in px (the grid's own, which keeps the gaps) */
    tileW: number;
    tileH: number;
    /** more tiles than fit at the floor size: the wall keeps that size and scrolls */
    scroll: boolean;
}

function msgsFor(tileH: number): number {
    const rows = Math.floor((tileH - TILE_HEAD_H - TILE_STRIP_H) / MSG_ROW_H);
    return Math.min(MAX_TILE_MSGS, Math.max(1, rows));
}

/**
 * The grid for `count` tiles in a wall whose inner box (its padding left out) is `width` × `height` px. It tries every
 * column count, rows following (`ceil(count / cols)`), and keeps the one whose tile is largest by `min(w, 1.5 · h)`:
 * a tile is worth its width until it is more than half again as wide as it is tall. Only shapes whose tile meets the
 * 300×170 floor are tried; with none, the wall scrolls: as many columns as fit at the floor width, filling the width,
 * every tile 170 tall. The floor width assumes the window's own minimum size (340×440), which keeps `width` ≥ 300.
 * No tiles (or an area not measured yet) gives an empty shape that does not scroll, or the scrolling floor shape.
 */
export function wallShape(width: number, height: number, count: number): WallShape {
    if (!(count > 0)) {
        return { cols: 0, rows: 0, msgs: 1, tileW: 0, tileH: 0, scroll: false };
    }
    const w0 = Math.max(0, width);
    const h0 = Math.max(0, height);
    let best: { cols: number; rows: number; tileW: number; tileH: number; score: number } | null = null;
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const tileW = (w0 - WALL_GAP * (cols - 1)) / cols;
        const tileH = (h0 - WALL_GAP * (rows - 1)) / rows;
        if (tileW < MIN_TILE_W || tileH < MIN_TILE_H) {
            continue;
        }
        const score = Math.min(tileW, 1.5 * tileH);
        // strictly greater: a tie keeps the fewer columns
        if (best == null || score > best.score + 1e-9) {
            best = { cols, rows, tileW, tileH, score };
        }
    }
    if (best != null) {
        return {
            cols: best.cols,
            rows: best.rows,
            msgs: msgsFor(best.tileH),
            tileW: best.tileW,
            tileH: best.tileH,
            scroll: false,
        };
    }
    const cols = Math.max(1, Math.min(count, Math.floor((w0 + WALL_GAP) / (MIN_TILE_W + WALL_GAP))));
    return {
        cols,
        rows: Math.ceil(count / cols),
        msgs: msgsFor(MIN_TILE_H),
        tileW: (w0 - WALL_GAP * (cols - 1)) / cols,
        tileH: MIN_TILE_H,
        scroll: true,
    };
}

/** The tile name's size: larger when there are only a few tiles (the board's 16 px at 4 agents, 14 px beyond). */
export function nameSizePx(count: number): number {
    return count <= 4 ? 16 : 14;
}

export type MoveKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * The index an arrow key moves the selection to. Left and right step through the tiles in reading order and stop at
 * the first and last; up and down step a row (`cols`), and a move to a place with no tile stays where it is.
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

/**
 * The selected tile's id after the snapshot changed: the same agent when it is still there, else the tile now at the
 * index it had (clamped to the new list), else the first; null when there are no tiles. `prevIds` is the order the
 * selection was last resolved against, which tells where an agent that left stood.
 */
export function resolveSelection(
    selectedId: string | null,
    prevIds: readonly string[],
    ids: readonly string[]
): string | null {
    if (ids.length === 0) {
        return null;
    }
    if (selectedId != null && ids.includes(selectedId)) {
        return selectedId;
    }
    const was = selectedId == null ? -1 : prevIds.indexOf(selectedId);
    return ids[was < 0 ? 0 : Math.min(was, ids.length - 1)];
}

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** A duration as the board writes a tile's age: `<1m`, `33m`, `1h`, `1h 05m`, `1d 3h`. */
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

/** A tile's age text; empty when the snapshot has no `since` for it. */
export function ageText(since: number | undefined, snapNow: number, sinceArrivedMs: number): string {
    return since == null ? "" : formatTileAge(tileAgeMs(since, snapNow, sinceArrivedMs));
}

export type WallKeyAction = { kind: "move"; key: MoveKey } | { kind: "open" } | { kind: "answer"; option: number };

/** What a key does on the wall: an arrow moves, Enter opens, 1-9 answers option 0-8; null for any other key. */
export function wallKey(key: string): WallKeyAction | null {
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

/** Whether the tile's ask takes this option from the keyboard or a button: answerable, not sent yet, and it has it. */
export function canAnswer(tile: Pick<SidecarTile, "ask" | "sent"> | undefined, option: number): boolean {
    const ask = tile?.ask;
    return ask != null && ask.answerable && tile?.sent !== true && option >= 0 && option < ask.options.length;
}
