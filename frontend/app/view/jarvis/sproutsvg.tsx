// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sprout drawn from its cells (petsprite.ts spriteFor) at a whole number of pixels a cell, each cell filled with its
// theme token, so a runtime theme repaints it.

import { PET_GRID, spriteFor, type PetCell } from "./petsprite";

type Sprite = ReturnType<typeof spriteFor>;

export function SproutSvg({ sprite, cellPx }: { sprite: Sprite; cellPx: number }) {
    const px = PET_GRID * cellPx;
    const cell = (c: PetCell, i: number) => (
        <rect key={i} x={c.x * cellPx} y={c.y * cellPx} width={cellPx} height={cellPx} fill={`var(${c.token})`} />
    );
    return (
        <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden className="block">
            {sprite.back.map(cell)}
            {sprite.body.map(cell)}
            {sprite.overlay.map(cell)}
        </svg>
    );
}
