// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the gallery's card cursor over groups drawn as separate grids (Today / Yesterday / Earlier), and the viewer's
// "changed" line. canvasgallery.ts' moveCursor works on one flat grid; the groups break it at their edges.

import { cardMeta, moveCursor, type GalleryCanvas } from "./canvasgallery";

export type CursorKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

// Left and right walk the cards in drawn order, across a group's edge. Up and down keep the column: down from a group's
// last row lands in the next group's first row, up from its first row in the previous group's last row, each on the
// nearest card when that row is short. At the very first or last row they stay put.
export function moveGalleryCursor(sizes: number[], cols: number, i: number, key: CursorKey): number {
    const total = sizes.reduce((n, s) => n + s, 0);
    if (total <= 0) {
        return 0;
    }
    const at = Math.min(Math.max(0, i), total - 1);
    if (key === "ArrowLeft" || key === "ArrowRight") {
        return moveCursor(total, cols, at, key);
    }
    const width = Math.max(1, cols);
    const starts: number[] = [];
    let n = 0;
    for (const s of sizes) {
        starts.push(n);
        n += s;
    }
    const g = sizes.findIndex((s, k) => s > 0 && at < starts[k] + s);
    const local = at - starts[g];
    const inside = moveCursor(sizes[g], width, local, key);
    if (inside !== local) {
        return starts[g] + inside;
    }
    const column = local % width;
    if (key === "ArrowDown") {
        const next = sizes.findIndex((s, k) => k > g && s > 0);
        return next < 0 ? at : starts[next] + Math.min(column, sizes[next] - 1);
    }
    let prev = -1;
    for (let k = g - 1; k >= 0; k--) {
        if (sizes[k] > 0) {
            prev = k;
            break;
        }
    }
    if (prev < 0) {
        return at;
    }
    const lastRow = Math.floor((sizes[prev] - 1) / width) * width;
    return starts[prev] + Math.min(lastRow + column, sizes[prev] - 1);
}

// "arcterm · changed 13:09" / "arcterm · changed 12 Oct": the card's own line with the verb added
export function changedLine(c: GalleryCanvas, now: number): string {
    const meta = cardMeta(c, now);
    const at = meta.lastIndexOf(" · ");
    return at < 0 ? meta : `${meta.slice(0, at)} · changed ${meta.slice(at + 3)}`;
}
