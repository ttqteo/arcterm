// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pet's teleport drawn (petteleport.ts): the ring, the beam, the pet scaled from its feet under its light, and the
// sparks, as svg layers in place of the pet's cells, so the walking pet (petview.tsx) and the folded one
// (sprout-mini.tsx) draw it alike. Its own frame clock runs while it plays, so only these layers redraw.

import { useEffect, useState } from "react";
import { PET_GRID, type PetCell, type spriteFor } from "./petsprite";
import {
    BEAM_CELLS,
    DISC_CELLS,
    FEET,
    ringCells,
    TELEPORT_TAIL_MS,
    teleportFrame,
    type TeleportCell,
} from "./petteleport";
import type { TeleportRun } from "./teleportstore";

type Sprite = ReturnType<typeof spriteFor>;

function useTeleportClock(run: TeleportRun): number {
    const [t, setT] = useState(() => performance.now() - run.at);
    useEffect(() => {
        if (run.kind === "gone") {
            return;
        }
        const tail = TELEPORT_TAIL_MS[run.kind];
        let raf = 0;
        const tick = () => {
            const now = performance.now() - run.at;
            setT(now);
            if (now < tail) {
                raf = requestAnimationFrame(tick);
            }
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [run]);
    return t;
}

// scale about a point
function about(x: number, y: number, sx: number, sy: number): string {
    return `translate(${x} ${y}) scale(${sx} ${sy}) translate(${-x} ${-y})`;
}

export function PetTeleportLayers({
    run,
    sprite,
    cellPx,
    flip = false,
}: {
    run: TeleportRun;
    sprite: Sprite;
    cellPx: number;
    flip?: boolean;
}) {
    const t = useTeleportClock(run);
    if (run.kind === "gone") {
        return null;
    }
    const f = teleportFrame(run.kind, t);
    const px = PET_GRID * cellPx;
    const mid = px / 2;
    const fx = (c: TeleportCell, i: number) => (
        <rect
            key={i}
            x={c.x * cellPx}
            y={c.y * cellPx}
            width={cellPx}
            height={cellPx}
            fill={`var(${c.token})`}
            opacity={c.opacity}
        />
    );
    // the pet's own cells, or all of them in one token for its light; only the body turns to face left (petview.tsx)
    const pet = (token: string | null) => {
        const cell = (c: PetCell, i: number) => (
            <rect
                key={i}
                x={c.x * cellPx}
                y={c.y * cellPx}
                width={cellPx}
                height={cellPx}
                fill={`var(${token ?? c.token})`}
            />
        );
        return (
            <>
                {sprite.back.map(cell)}
                <g transform={flip ? `matrix(-1 0 0 1 ${px} 0)` : undefined}>{sprite.body.map(cell)}</g>
                {sprite.overlay.map(cell)}
            </>
        );
    };
    const ring = ringCells(t);
    const ringAt = about(mid, (FEET + 0.5) * cellPx, f.ring.scaleX, 1);
    const beamY = f.beam.from === "ground" ? (FEET + 1) * cellPx : cellPx;
    return (
        <>
            <g opacity={f.ring.opacity} transform={ringAt}>
                {DISC_CELLS.map(fx)}
                {ring.back.map(fx)}
            </g>
            <g opacity={f.beam.opacity} transform={about(mid, beamY, f.beam.scaleX, f.beam.scaleY)}>
                {BEAM_CELLS.map(fx)}
            </g>
            <g opacity={f.pet.opacity} transform={about(mid, px, f.pet.scaleX, f.pet.scaleY)}>
                {pet(null)}
                <g opacity={f.pet.light}>{pet("--color-teleport-soft")}</g>
            </g>
            <g opacity={f.ring.opacity} transform={ringAt}>
                {ring.front.map(fx)}
            </g>
            {f.sparks.map(fx)}
        </>
    );
}

/** The folded pet's svg while it teleports, in SproutSvg's place: the ring and the sparks draw past its box. */
export function PetTeleportSvg({ run, sprite, cellPx }: { run: TeleportRun; sprite: Sprite; cellPx: number }) {
    const px = PET_GRID * cellPx;
    return (
        <svg
            width={px}
            height={px}
            viewBox={`0 0 ${px} ${px}`}
            overflow="visible"
            shapeRendering="crispEdges"
            aria-hidden
            className="block"
        >
            <PetTeleportLayers run={run} sprite={sprite} cellPx={cellPx} />
        </svg>
    );
}
