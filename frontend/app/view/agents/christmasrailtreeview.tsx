// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas pine in the bottom right corner of the Agent details rail's Overview tab (its grid is
// christmasrailtree.ts): CollapsibleRail's footer, so it sits in the corner while the sections leave room and follows
// them once they scroll, never over one. Static, aria-hidden, catching no pointer; nothing off the theme or its effects.

import { RAIL_TREE, RAIL_TREE_FILL, RAIL_TREE_H, RAIL_TREE_W } from "./christmasrailtree";
import { useChristmasDecor } from "./christmasstore";

const CELL_PX = 3;

export function RailTree() {
    const decorOn = useChristmasDecor();
    if (!decorOn) return null;
    const cells: { x: number; y: number; c: string }[] = [];
    RAIL_TREE.forEach((row, y) => {
        [...row].forEach((c, x) => {
            if (c !== ".") cells.push({ x, y, c });
        });
    });
    return (
        <svg
            data-rail-tree
            width={RAIL_TREE_W * CELL_PX}
            height={RAIL_TREE_H * CELL_PX}
            viewBox={`0 0 ${RAIL_TREE_W} ${RAIL_TREE_H}`}
            shapeRendering="crispEdges"
            aria-hidden="true"
            className="pointer-events-none block flex-none"
        >
            {cells.map(({ x, y, c }) => (
                <rect key={`${x}:${y}`} x={x} y={y} width={1} height={1} fill={RAIL_TREE_FILL[c]} />
            ))}
        </svg>
    );
}
