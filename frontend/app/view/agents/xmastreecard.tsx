// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The lobby tree's close-up card, as board A of the Prototype lays it out (.superpowers/design/christmas-tree-game,
// A-closeup): the tree enlarged on the left with the dashed cursor ring, the lifted ornament raised and "▶ put here"
// by the ring; on the right the season's count, the milestone line and its bar, the lifted ornament and the key; the
// keys in the footer. It takes the view, the card state and callbacks: the Office owns the keys (officecontrols.ts's
// tree layer) and the state (xmastreecardmodel.ts's reducer), and persists a put-down.

import { cn } from "@/util/util";
import { useMemo } from "react";
import { useChristmasDecor } from "./christmasstore";
import { PixelFrame } from "./officedialog";
import { countText, keyRows, milestoneLine, ornamentDetail, ornamentName, type CardState } from "./xmastreecardmodel";
import { ORNAMENT_FILL, XMAS_TREE_FILL, XMAS_TREE_H, XMAS_TREE_W, treeGrid } from "./xmastreegrid";
import {
    branchTiers,
    hasLights,
    hasStar,
    progress,
    type Ornament,
    type Tier,
    type XmasTreeView,
} from "./xmastreemodel";

/** The enlarged tree's cell, in px. */
const CELL = 16;
/** How far a lifted ornament rises off its spot, in cells. */
const LIFT = 0.45;

const SNOW = "var(--color-xmas-snow)";

/** An ornament in a 1 x 1 cell, pixel-drawn by tier: a red bulb, a gold bauble, a cream diamond, a crimson star edged
 *  in gold. */
function OrnamentShape({ tier }: { tier: Tier }) {
    const fill = ORNAMENT_FILL[tier];
    switch (tier) {
        case 0:
            return <rect x={0.2} y={0.2} width={0.6} height={0.6} fill={fill} />;
        case 1:
            return <path d="M0.25 0.05H0.75V0.25H0.95V0.75H0.75V0.95H0.25V0.75H0.05V0.25H0.25Z" fill={fill} />;
        case 2:
            return <path d="M0.5 -0.05L1.05 0.5L0.5 1.05L-0.05 0.5Z" fill={fill} />;
        case 3:
            return (
                <path
                    d="M0.5 -0.1L0.64 0.3L1.08 0.32L0.73 0.58L0.86 1L0.5 0.76L0.14 1L0.27 0.58L-0.08 0.32L0.36 0.3Z"
                    fill={fill}
                    stroke="var(--color-accent)"
                    strokeWidth={0.08}
                />
            );
    }
}

/** A key or "Lifting" swatch: the ornament's shape at a size of its own. */
function Swatch({ tier, size }: { tier: Tier; size: number }) {
    return (
        <svg width={size} height={size} viewBox="-0.1 -0.1 1.2 1.2" aria-hidden className="shrink-0">
            <OrnamentShape tier={tier} />
        </svg>
    );
}

export interface XmasTreeCardProps {
    view: XmasTreeView;
    state: CardState;
    /** A click on a spot (an ornament, or a free spot while one is lifted): the Office moves the cursor there and
     *  lifts or puts down, as A would. B closes the card through the Office's keys. */
    onSpot?: (spot: number) => void;
    className?: string;
}

export function XmasTreeCard({ view, state, onSpot, className }: XmasTreeCardProps) {
    const decor = useChristmasDecor();
    const { arrangement, milestone, count, done } = view;
    const grid = useMemo(
        () => treeGrid(branchTiers(milestone), hasLights(milestone), hasStar(milestone), arrangement.spots.length),
        [milestone, arrangement.spots.length]
    );
    // the same cells cardPoints gives the reducer
    const points = grid.spots;
    if (!decor) {
        return null;
    }
    const { fraction } = progress(count);
    const lifted = state.lifted != null ? arrangement.spots[state.lifted] : null;
    const shown: Ornament | null | undefined = lifted ?? arrangement.spots[state.cursor];
    const ring = points[state.cursor];
    const w = XMAS_TREE_W * CELL;
    const h = XMAS_TREE_H * CELL;

    return (
        <PixelFrame
            data-xmas-tree-card
            className={cn("w-[720px] max-w-full", className)}
            innerClassName="flex flex-col"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex items-center justify-between gap-4 border-b border-edge-faint px-5 py-3">
                <div className="text-[16px] font-semibold text-primary">The lobby tree</div>
                <div className="font-mono text-[12px] text-muted">Season 1/11 → 1/1</div>
            </div>

            <div className="flex gap-7 px-5 py-5">
                {/* the tree, enlarged */}
                <div className="relative shrink-0" style={{ width: w, height: h }}>
                    <svg
                        width={w}
                        height={h}
                        viewBox={`0 0 ${XMAS_TREE_W} ${XMAS_TREE_H}`}
                        shapeRendering="crispEdges"
                        overflow="visible"
                        aria-label="The lobby tree"
                    >
                        {grid.rows.map((row, y) =>
                            Array.from(row).map((c, x) =>
                                c === "." ? null : (
                                    <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={XMAS_TREE_FILL[c]} />
                                )
                            )
                        )}
                        {arrangement.spots.map((o, i) => {
                            const p = points[i];
                            if (!o || !p) {
                                return null;
                            }
                            const up = i === state.lifted;
                            return (
                                <g
                                    key={i}
                                    data-xmas-spot={i}
                                    data-xmas-tier={o.tier}
                                    data-xmas-lifted={up ? "" : undefined}
                                    transform={`translate(${p.x} ${p.y - (up ? LIFT : 0)})`}
                                    onClick={onSpot ? () => onSpot(i) : undefined}
                                    className={onSpot ? "cursor-pointer" : undefined}
                                >
                                    {up && (
                                        <rect
                                            x={-0.2}
                                            y={-0.2}
                                            width={1.4}
                                            height={1.4}
                                            fill="none"
                                            stroke={SNOW}
                                            strokeWidth={0.12}
                                        />
                                    )}
                                    <OrnamentShape tier={o.tier} />
                                </g>
                            );
                        })}
                        {/* the free spots, clickable while an ornament is lifted */}
                        {onSpot &&
                            lifted &&
                            arrangement.spots.map((o, i) =>
                                o || !points[i] ? null : (
                                    <rect
                                        key={`free-${i}`}
                                        x={points[i].x}
                                        y={points[i].y}
                                        width={1}
                                        height={1}
                                        fill="transparent"
                                        className="cursor-pointer"
                                        onClick={() => onSpot(i)}
                                    />
                                )
                            )}
                        {ring && (
                            <circle
                                data-xmas-cursor
                                cx={ring.x + 0.5}
                                cy={ring.y + 0.5}
                                r={0.95}
                                fill="none"
                                stroke={SNOW}
                                strokeWidth={0.12}
                                strokeDasharray="0.3 0.2"
                                shapeRendering="geometricPrecision"
                                pointerEvents="none"
                            />
                        )}
                    </svg>
                    {ring && lifted && (
                        <div
                            data-xmas-put-here
                            className="pointer-events-none absolute whitespace-nowrap font-mono text-[12px] text-primary"
                            style={{ left: (ring.x + 1.7) * CELL, top: (ring.y - 1) * CELL }}
                        >
                            ▶ put here
                        </div>
                    )}
                </div>

                {/* the side column */}
                <div className="flex min-w-0 flex-1 flex-col gap-5">
                    <div className="flex flex-col gap-1.5">
                        <div className="text-[12px] text-muted">Finished this season</div>
                        <div className="text-[28px] font-semibold leading-tight text-primary">{countText(count)}</div>
                        <div className="text-[13px] text-secondary">{milestoneLine(count)}</div>
                        <div className="h-1.5 overflow-hidden rounded-[3px] bg-edge-mid">
                            <div className="h-full bg-accent" style={{ width: `${Math.round(fraction * 100)}%` }} />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 rounded-[4px] border border-edge-mid bg-surface p-3.5">
                        <div className="text-[12px] text-muted">{lifted ? "Lifting" : "Selected"}</div>
                        {shown ? (
                            <>
                                <div className="flex items-center gap-2.5">
                                    <Swatch tier={shown.tier} size={18} />
                                    <div className="text-[15px] font-medium text-primary">
                                        {ornamentName(shown.tier)}
                                    </div>
                                </div>
                                <div className="text-[13px] text-secondary">{ornamentDetail(shown, done)}</div>
                            </>
                        ) : (
                            <div className="text-[13px] text-secondary">No ornament hangs on the tree yet.</div>
                        )}
                    </div>

                    <div className="flex flex-col gap-2 text-[13px] text-secondary">
                        {keyRows(arrangement).map((r) => (
                            <div key={r.tier} className="flex items-center gap-2">
                                <Swatch tier={r.tier} size={10 + 2 * r.tier} />
                                {r.label}
                                <span className="text-ink-faint">· {r.onTree}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap gap-[18px] border-t border-edge-faint px-5 py-2.5 font-mono text-[12px] text-muted">
                <span>
                    <b className="text-primary">←↑→↓</b> pick
                </span>
                <span>
                    <b className="text-primary">A</b> lift / put down
                </span>
                <span>
                    <b className="text-primary">B</b> back to the hall
                </span>
            </div>
        </PixelFrame>
    );
}
