// frontend/app/view/agents/gitgraphgeom.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SVG geometry for the commit graph gutter. Pure. Returns lane indices and flags, never colours —
// the component maps lane -> --color-graphlane-N so runtime theming still applies.

import type { LanedRow } from "./gitgraph";

const LANE_W = 15;
const PAD_L = 13;
const CURVE = 13;
const DIVIDER_H = 30;
const NODE_R = 4.5;
const MERGE_R = 5.5;
const BOTTOM_PAD = 8;

export interface GeometryOpts {
    rowH: number;
    // lanes past this fold into the last drawable column; keeps a 9-lane repo inside a fixed gutter
    maxLanes: number;
    // a parent outside the rows draws a dashed stub one row down (the rail's scoped list), instead of nothing (the Log's paged one)
    stubs?: boolean;
}

export interface GraphEdge {
    d: string;
    // lane the segment is tinted by — the leftmost of the two it joins
    lane: number;
    folded: boolean;
    dashed: boolean;
    boundary: boolean;
}

export interface GraphNode {
    x: number;
    y: number;
    r: number;
    lane: number;
    merge: boolean;
    folded: boolean;
    workingTree: boolean;
    boundary: boolean;
}

export interface GraphGeometry {
    width: number;
    height: number;
    gutter: number;
    edges: GraphEdge[];
    nodes: GraphNode[];
    foldedCount: number;
    // x of the fold indicator, centred on the last drawable lane. Meaningful only when foldedCount > 0.
    foldX: number;
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
    if (x1 === x2) {
        return `M${x1} ${y1} L${x2} ${y2}`;
    }
    const dir = x2 > x1 ? 1 : -1;
    return `M${x1} ${y1} L${x1} ${y2 - CURVE} Q${x1} ${y2} ${x1 + dir * CURVE} ${y2} L${x2} ${y2}`;
}

export function graphGeometry(rows: LanedRow[], opts: GeometryOpts): GraphGeometry {
    const { rowH, maxLanes } = opts;
    const lastLane = Math.max(0, maxLanes - 1);

    // row tops, so a divider under row i pushes everything below it down
    const tops: number[] = [];
    let acc = 0;
    for (const r of rows) {
        tops.push(acc);
        acc += rowH + (r.divider ? DIVIDER_H : 0);
    }

    const rowOf = new Map<string, number>();
    rows.forEach((r, i) => {
        if (r.hash) {
            rowOf.set(r.hash, i);
        }
    });

    const x = (lane: number) => PAD_L + Math.min(lane, lastLane) * LANE_W;
    const y = (i: number) => tops[i] + rowH / 2;

    const edges: GraphEdge[] = [];
    const nodes: GraphNode[] = [];
    let foldedCount = 0;
    // the lowest y a stub reaches, which can be past the last row
    let stubBottom = 0;

    rows.forEach((row, i) => {
        const folded = row.lane > lastLane;
        if (folded) {
            foldedCount++;
        }
        const x1 = x(row.lane);
        const y1 = y(i);
        for (const parent of row.parents) {
            const pi = rowOf.get(parent);
            if (pi === undefined) {
                // parent not in this page: the Log keeps the lane reserved and draws nothing; a scoped list runs on dashed
                if (opts.stubs) {
                    edges.push({
                        d: `M${x1} ${y1} L${x1} ${y1 + rowH}`,
                        lane: row.lane,
                        folded,
                        dashed: true,
                        boundary: false,
                    });
                    stubBottom = Math.max(stubBottom, y1 + rowH);
                }
                continue;
            }
            const par = rows[pi];
            edges.push({
                d: edgePath(x1, y1, x(par.lane), y(pi)),
                lane: Math.min(row.lane, par.lane),
                folded: folded || par.lane > lastLane,
                dashed: !!row.workingTree || !!par.boundary,
                boundary: !!par.boundary,
            });
        }
        nodes.push({
            x: x1,
            y: y1,
            r: row.merge ? MERGE_R : NODE_R,
            lane: row.lane,
            merge: row.merge,
            folded,
            workingTree: !!row.workingTree,
            boundary: !!row.boundary,
        });
    });

    const gutter = PAD_L + maxLanes * LANE_W + 4;
    return {
        width: gutter,
        height: rows.length === 0 ? 0 : Math.max(acc + BOTTOM_PAD, stubBottom),
        gutter,
        edges,
        nodes,
        foldedCount,
        foldX: x(lastLane) - 7,
    };
}
