// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The lobby Christmas tree in the Office hall (spec 2026-11-05-christmas-tree-game-design.md, "The Office" and
// "1 January"): xmastreegrid.ts's grid at XMAS_TREE_PX a cell, at the season's stage with this viewer's ornaments, and a
// button over it that walks the boss there. On 1 January pixel fireworks go off over the hall, stepping while the
// Christmas motion runs and one still frame otherwise, and a sign under the tree gives the season's total. The plan
// places it (officeplanmodel.ts `xmasTree`) only while the decor shows and the phase is not off; nothing here draws
// without the decor either.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import { useChristmasDecor, useChristmasMotion } from "./christmasstore";
import { TREE_KEY, XMAS_TREE_PX, type Box, type Point } from "./officeplanmodel";
import {
    FIREWORK_FRAMES,
    fireworkCells,
    ORNAMENT_FILL,
    treeGrid,
    XMAS_TREE_FILL,
    XMAS_TREE_H,
    XMAS_TREE_W,
} from "./xmastreegrid";
import { branchTiers, hasLights, hasStar, spotCount, type Arrangement } from "./xmastreemodel";
import { xmasTreeAtom } from "./xmastreestore";

// the fireworks' cell over the hall, twice the tree's so the bursts read from across the floor, and a frame's length
const FIREWORK_PX = 6;
const FIREWORK_FRAME_MS = 140;
// the still frame under reduced motion: bursts in the air (xmastreegrid.ts)
const FIREWORK_STILL = 4;
// the sign's top below the boss's feet at the tree, so the boss standing there never covers it
const SIGN_DY = 4;
const SIGN_WALL_GAP = 4; // the sign's right edge off the hall's right wall

const at = (b: Box) => ({ left: b.x, top: b.y, width: b.w, height: b.h });

// the tree's cells: the grid at the stage, then each spot's ornament over its needle
function treeCells(milestone: number, arrangement: Arrangement): { x: number; y: number; fill: string }[] {
    const grid = treeGrid(branchTiers(milestone), hasLights(milestone), hasStar(milestone), spotCount(milestone));
    const out: { x: number; y: number; fill: string }[] = [];
    grid.rows.forEach((row, y) => {
        [...row].forEach((c, x) => {
            if (c !== ".") out.push({ x, y, fill: XMAS_TREE_FILL[c] });
        });
    });
    grid.spots.forEach((p, k) => {
        const o = arrangement.spots[k];
        if (o != null) out.push({ x: p.x, y: p.y, fill: ORNAMENT_FILL[o.tier] });
    });
    return out;
}

const tasksText = (n: number) => `${n.toLocaleString("en-US")} task${n === 1 ? "" : "s"}`;

/** The hall's tree, its button, and on 1 January the fireworks and the sign. `front` draws the tree over the boss (its
 *  feet are behind it, officeboss.ts behindXmasTree). */
export const XmasTreeHall = memo(function XmasTreeHall(p: {
    tree: { box: Box; spot: Point };
    hall: Box;
    front: boolean;
    onPick: (key: string) => void;
}) {
    const { tree, hall, front, onPick } = p;
    const decorOn = useChristmasDecor();
    const view = useAtomValue(xmasTreeAtom);
    const cells = useMemo(
        () => (view == null ? [] : treeCells(view.milestone, view.arrangement)),
        [view?.milestone, view?.arrangement]
    );
    if (!decorOn || view == null || view.phase === "off") {
        return null;
    }
    const label = `Christmas tree, ${tasksText(view.count)} this season`;
    return (
        <>
            <svg
                data-xmas-tree=""
                data-xmas-tree-milestone={view.milestone}
                width={XMAS_TREE_W * XMAS_TREE_PX}
                height={XMAS_TREE_H * XMAS_TREE_PX}
                viewBox={`0 0 ${XMAS_TREE_W} ${XMAS_TREE_H}`}
                shapeRendering="crispEdges"
                aria-hidden="true"
                className={cn("pointer-events-none absolute block", front ? "z-[7]" : "z-[2]")}
                style={at(tree.box)}
            >
                {cells.map(({ x, y, fill }, i) => (
                    <rect key={i} x={x} y={y} width={1} height={1} fill={fill} />
                ))}
            </svg>
            <button
                type="button"
                data-xmas-tree-button=""
                title={`${label} (Space at the tree)`}
                aria-label={label}
                onClick={() => onPick(TREE_KEY)}
                className="absolute z-[3] cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={at(tree.box)}
            />
            {view.phase === "newyear" ? (
                <>
                    <Fireworks hall={hall} />
                    {/* the hall's width, the plate at its right under the tree: a sign too wide to centre there stays
                        in the hall */}
                    <div
                        className="pointer-events-none absolute z-[6] flex justify-end"
                        style={{ left: hall.x, width: hall.w - SIGN_WALL_GAP, top: tree.spot.y + SIGN_DY }}
                    >
                        <span
                            data-xmas-sign=""
                            className="whitespace-nowrap rounded-[3px] border border-accent bg-office-plate px-[5px] text-[11px] font-bold leading-[14px] tabular-nums text-accent"
                        >
                            This season: {tasksText(view.count)}
                        </span>
                    </div>
                </>
            ) : null}
        </>
    );
});

// the 1 January fireworks over the whole hall, one rect a cell: stepping while the Christmas motion runs, one still
// frame of bursts otherwise
function Fireworks({ hall }: { hall: Box }) {
    const motion = useChristmasMotion();
    const [frame, setFrame] = useState(FIREWORK_STILL);
    useEffect(() => {
        if (!motion) {
            setFrame(FIREWORK_STILL);
            return;
        }
        const t = window.setInterval(() => setFrame((f) => (f + 1) % FIREWORK_FRAMES), FIREWORK_FRAME_MS);
        return () => window.clearInterval(t);
    }, [motion]);
    const w = Math.floor(hall.w / FIREWORK_PX);
    const h = Math.floor(hall.h / FIREWORK_PX);
    const cells = fireworkCells(frame, w, h);
    return (
        <svg
            data-xmas-fireworks=""
            data-xmas-fireworks-moving={motion ? "" : undefined}
            width={w * FIREWORK_PX}
            height={h * FIREWORK_PX}
            viewBox={`0 0 ${w} ${h}`}
            shapeRendering="crispEdges"
            aria-hidden="true"
            className="pointer-events-none absolute z-[6] block"
            style={{ left: hall.x, top: hall.y }}
        >
            {cells.map(({ x, y, fill }, i) => (
                <rect key={i} x={x} y={y} width={1} height={1} fill={fill} />
            ))}
        </svg>
    );
}
