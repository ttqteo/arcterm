// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit office's depth: which of the floor's props (scenery.ts: the coffee machine, a plant, the notice board)
// stand before a body, and the body's own cells as a CSS clip path. cockpitoffice.tsx draws those props again over the
// body, clipped to its cells, so a body behind a prop is hidden where the prop is and nothing else on the floor changes
// (a label over a prop stays over it). A body is behind a prop while its feet are above the prop's foot. Pure: no React,
// no DOM.

import type { Box, Point } from "@/app/view/agents/officeplanmodel";
import { CELL, type Prop } from "./scenery";

/** Whether `prop` stands before a body whose feet are at `feet` and which is drawn in `body` (plan px): the feet are
 *  above the prop's foot, and the body and the prop overlap. */
export function inFront(prop: Prop, feet: Point, body: Box): boolean {
    const x = prop.x * CELL;
    const y = prop.y * CELL;
    return (
        feet.y < prop.foot * CELL &&
        body.x < x + prop.w * CELL &&
        x < body.x + body.w &&
        body.y < y + prop.h * CELL &&
        y < body.y + body.h
    );
}

/** A body's filled cells, `cell` px each in a box `width` px wide, as a CSS clip path in that box's px: each row's runs
 *  of cells, mirrored when `flip` as the body is drawn facing left, and `extra` boxes beside them (the boss's ring).
 *  With nothing to show, it hides all. */
export function cellsClip(
    cells: readonly { x: number; y: number }[],
    cell: number,
    width: number,
    flip: boolean,
    extra: readonly Box[] = []
): string {
    const rows = new Map<number, number[]>();
    for (const c of cells) {
        const row = rows.get(c.y);
        if (row) {
            row.push(c.x);
        } else {
            rows.set(c.y, [c.x]);
        }
    }
    const parts: string[] = [];
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
        const xs = [...new Set(rows.get(y))].sort((a, b) => a - b);
        let start = xs[0];
        for (let i = 1; i <= xs.length; i++) {
            if (i < xs.length && xs[i] === xs[i - 1] + 1) {
                continue;
            }
            const len = (xs[i - 1] - start + 1) * cell;
            const left = flip ? width - (xs[i - 1] + 1) * cell : start * cell;
            parts.push(`M${left} ${y * cell}h${len}v${cell}h-${len}z`);
            start = xs[i];
        }
    }
    for (const b of extra) {
        parts.push(`M${b.x} ${b.y}h${b.w}v${b.h}h-${b.w}z`);
    }
    return parts.length > 0 ? `path("${parts.join("")}")` : "inset(50%)";
}

/** A sprite grid's filled cells: every one but the clear `.`. */
export function gridCells(rows: readonly string[]): { x: number; y: number }[] {
    const cells: { x: number; y: number }[] = [];
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] !== ".") {
                cells.push({ x, y });
            }
        }
    });
    return cells;
}
