// frontend/app/view/agents/graphgutter.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The commit-graph lane gutter. The only place a lane index becomes a colour: gitgraphgeom returns
// lane indices and flags, and this maps them onto --color-graphlane-N so a runtime theme override
// still reaches the graph. Lane hue is positional, never identity — nothing is claimed by a colour.

import type { GraphGeometry } from "./gitgraphgeom";

const LANE_TOKENS = [
    "var(--color-graphlane-1)",
    "var(--color-graphlane-2)",
    "var(--color-graphlane-3)",
    "var(--color-graphlane-4)",
    "var(--color-graphlane-5)",
    "var(--color-graphlane-6)",
];
const FOLD_TOKEN = "var(--color-graphlane-fold)";
const FOLD_W = 14;

function laneColor(lane: number, folded: boolean): string {
    return folded ? FOLD_TOKEN : LANE_TOKENS[lane % LANE_TOKENS.length];
}

// selectedIndex indexes geom.nodes, which is one node per row in row order. It exists only so a hollow
// node can match the fill painted under it — see the z-10 note below.
export function GraphGutter({ geom, selectedIndex = -1 }: { geom: GraphGeometry; selectedIndex?: number }) {
    if (geom.nodes.length === 0) {
        return null;
    }
    return (
        <svg
            data-graph-gutter
            width={geom.width}
            height={geom.height}
            // z-10 because the rows are positioned too (they anchor the selection bar) and would
            // otherwise paint over this in DOM order — an opaque selected or hovered row erased the
            // lane lines and the node inside its band, cutting the graph in half wherever the cursor was.
            className="pointer-events-none absolute left-0 top-0 z-10"
            aria-hidden="true"
        >
            {geom.foldedCount > 0 ? (
                <>
                    <rect
                        x={geom.foldX}
                        y={0}
                        width={FOLD_W}
                        height={geom.height}
                        rx={4}
                        fill={FOLD_TOKEN}
                        opacity={0.13}
                    />
                    <text
                        x={geom.foldX}
                        y={11}
                        fill={FOLD_TOKEN}
                        fontSize={8}
                        fontWeight={600}
                        className="tabular-nums"
                    >
                        +{geom.foldedCount}
                    </text>
                </>
            ) : null}
            {geom.edges.map((e, i) => (
                <path
                    key={i}
                    d={e.d}
                    fill="none"
                    stroke={laneColor(e.lane, e.folded)}
                    strokeWidth={1.8}
                    strokeDasharray={e.dashed ? "3 3" : undefined}
                    opacity={e.folded ? 0.5 : 1}
                />
            ))}
            {geom.nodes.map((n, i) => (
                <circle
                    key={i}
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    // hollow for merges and for the working tree, so both read as "not an ordinary
                    // commit". The hole has to be whatever is painted beneath it, which on the selected
                    // row is the selection fill rather than the page background.
                    fill={
                        n.merge || n.workingTree
                            ? i === selectedIndex
                                ? "var(--color-surface-selected)"
                                : "var(--color-background)"
                            : laneColor(n.lane, n.folded)
                    }
                    stroke={laneColor(n.lane, n.folded)}
                    strokeWidth={2}
                    strokeDasharray={n.workingTree ? "2.5 2.5" : undefined}
                />
            ))}
        </svg>
    );
}
