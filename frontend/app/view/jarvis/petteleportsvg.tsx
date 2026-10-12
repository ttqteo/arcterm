// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pet's teleport drawn (petteleport.ts): the ring, the beam, the pet scaled from its feet under its light, and the
// sparks, as svg layers in place of the pet's cells, so the walking pet (petview.tsx) and the folded one
// (sprout-mini.tsx) draw it alike. Its own frame clock runs while it plays, so only these layers redraw. Spider-Man's
// is a web-swing instead (petwebswing.ts), drawn by WebSwingLayers.

import { useEffect, useState } from "react";
import { PET_GRID, SPIDEY_SWING, spriteOfRows, type PetCell, type PetCharacter, type PetSprite } from "./petsprite";
import {
    BEAM_CELLS,
    DISC_CELLS,
    FEET,
    ringCells,
    TELEPORT_TAIL_MS,
    teleportFrame,
    type TeleportCell,
} from "./petteleport";
import { WEB_TOKEN, webSwingFrame } from "./petwebswing";
import type { TeleportRun } from "./teleportstore";

// at: a fixed ms into the run in place of its clock — the DEV contract's force({ swing }) (petview.tsx), so a CDP step
// can show the swing mid-fold
type LayerProps = { run: TeleportRun; sprite: PetSprite; cellPx: number; flip?: boolean; at?: number };

// the swing's body, the same whatever the pose he left or will land in
const SWING_BODY = spriteOfRows(SPIDEY_SWING, []).body;

function useTeleportClock(run: TeleportRun): number {
    const [clock, setClock] = useState(() => ({ run, t: performance.now() - run.at }));
    useEffect(() => {
        if (run.kind === "gone") {
            return;
        }
        const tail = TELEPORT_TAIL_MS[run.kind];
        let raf = 0;
        const tick = () => {
            const now = performance.now() - run.at;
            setClock({ run, t: now });
            if (now < tail) {
                raf = requestAnimationFrame(tick);
            }
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [run]);
    // a run that has just replaced another (gone, then an arrival) starts from its own beginning, not the last one's t
    return clock.run === run ? clock.t : performance.now() - run.at;
}

// scale about a point
function about(x: number, y: number, sx: number, sy: number): string {
    return `translate(${x} ${y}) scale(${sx} ${sy}) translate(${-x} ${-y})`;
}

function BeamLayers({ run, sprite, cellPx, flip = false }: LayerProps) {
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

// Spider-Man's teleport (petwebswing.ts): the strand, and the swing's body moved along it
function WebSwingLayers({ run, cellPx, flip, at }: LayerProps) {
    const clock = useTeleportClock(run);
    const t = at ?? clock;
    if (run.kind === "gone") {
        return null;
    }
    const f = webSwingFrame(run.kind, t);
    const px = PET_GRID * cellPx;
    const cell = (c: PetCell, i: number) => (
        <rect key={i} x={c.x * cellPx} y={c.y * cellPx} width={cellPx} height={cellPx} fill={`var(${c.token})`} />
    );
    return (
        <>
            {f.strand.map((c, i) => (
                <rect
                    key={`web${i}`}
                    x={c.x * cellPx}
                    y={c.y * cellPx}
                    width={cellPx}
                    height={cellPx}
                    fill={`var(${WEB_TOKEN})`}
                />
            ))}
            <g opacity={f.pet.opacity} transform={`translate(${f.pet.dx * cellPx} ${f.pet.dy * cellPx})`}>
                <g transform={flip ? `matrix(-1 0 0 1 ${px} 0)` : undefined}>{SWING_BODY.map(cell)}</g>
            </g>
        </>
    );
}

// character is optional, Sprout's beam by default, so a caller that does not pass it still draws what it always did
export function PetTeleportLayers({ character = "sprout", ...props }: LayerProps & { character?: PetCharacter }) {
    return character === "spidey" ? <WebSwingLayers {...props} /> : <BeamLayers {...props} />;
}

/** The folded pet's svg while it teleports, in SproutSvg's place: the ring and the sparks draw past its box. */
export function PetTeleportSvg({
    run,
    sprite,
    cellPx,
    character = "sprout",
}: {
    run: TeleportRun;
    sprite: PetSprite;
    cellPx: number;
    character?: PetCharacter;
}) {
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
            <PetTeleportLayers run={run} sprite={sprite} cellPx={cellPx} character={character} />
        </svg>
    );
}
