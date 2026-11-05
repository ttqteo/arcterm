// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas pine in the bottom right corner of the Agent details rail's Overview tab: CollapsibleRail's footer, so
// it sits in the corner while the sections leave room and follows them once they scroll, never over one. It is the
// lobby tree (xmastreegrid.ts at 3 px a cell): the season's stage and ornaments in season and on 1 January, the full
// tree bare out of season (spec "The rail's pine out of season"), nothing before wavesrv's first answer. Static,
// aria-hidden, catching no pointer; nothing off the theme or its effects.

import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useChristmasDecor } from "./christmasstore";
import { ORNAMENT_FILL, treeGrid, XMAS_TREE_FILL, XMAS_TREE_H, XMAS_TREE_W } from "./xmastreegrid";
import { branchTiers, hasLights, hasStar, spotCount } from "./xmastreemodel";
import { railPine, xmasTreeAtom } from "./xmastreestore";

const CELL_PX = 3;

export function RailTree() {
    const decorOn = useChristmasDecor();
    const view = useAtomValue(xmasTreeAtom);
    const pine = view == null ? null : railPine(view);
    const cells = useMemo(() => {
        if (pine == null) return [];
        const { milestone, arrangement } = pine;
        const grid = treeGrid(branchTiers(milestone), hasLights(milestone), hasStar(milestone), spotCount(milestone));
        const out: { x: number; y: number; fill: string }[] = [];
        grid.rows.forEach((row, y) => {
            [...row].forEach((c, x) => {
                if (c !== ".") out.push({ x, y, fill: XMAS_TREE_FILL[c] });
            });
        });
        grid.spots.forEach((p, k) => {
            const o = arrangement?.spots[k];
            if (o != null) out.push({ x: p.x, y: p.y, fill: ORNAMENT_FILL[o.tier] });
        });
        return out;
    }, [pine?.milestone, pine?.arrangement]);
    if (!decorOn || pine == null) return null;
    return (
        <svg
            data-rail-tree
            data-rail-tree-milestone={pine.milestone}
            width={XMAS_TREE_W * CELL_PX}
            height={XMAS_TREE_H * CELL_PX}
            viewBox={`0 0 ${XMAS_TREE_W} ${XMAS_TREE_H}`}
            shapeRendering="crispEdges"
            aria-hidden="true"
            className="pointer-events-none block flex-none"
        >
            {cells.map(({ x, y, fill }, i) => (
                <rect key={i} x={x} y={y} width={1} height={1} fill={fill} />
            ))}
        </svg>
    );
}
