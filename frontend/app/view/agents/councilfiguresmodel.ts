// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council's six figures draw (docs/superpowers/plans/2026-11-19-council-figures.md), derived from the `Council`
// the cockpit already holds, and from the bench's rows for the benchmark: the glance quadrant (A), the stance grid (B),
// what each seat spent (C), when each seat worked (D), the argument map (E) and the benchmark chart (F). Every number and
// every takeaway is computed; no model call words a figure. Pure, no React, no Wave runtime imports.
//
// This file is the contract the views (councilglancefigures.tsx, councilspendfigures.tsx, councilargumentmap.tsx,
// councilbenchchart.tsx) and the model are built against side by side: the types below, and every function a stub until
// the model lands. A function returns `null` when its figure has nothing to show, and the view then draws no frame. The
// section predicates (`hasGlanceFigures`, `hasSpendFigures`) are in councilsummarymodel.ts, which never imports this
// file.

/** Go's MaxTimelineSteps (pkg/council/types.go), which no generated file carries; the model's golden test holds it equal. */
export const MAX_TIMELINE_STEPS = 200;

/** The argument map's geometry, in px, shared by the model and the view so the edges are drawn in one pass from
 *  `GraphIdea.y` and a seat row's top (`index * GRAPH_ROW_PX`) without measuring the DOM. */
export const GRAPH_ROW_PX = 28; // an idea row and a seat row
export const GRAPH_HEADING_PX = 28; // a group heading row, in the right column above its ideas
export const GRAPH_SEAT_TOP_PX = 0; // the seat column's first row's top

export type FigureStance = "accept" | "challenge" | "oppose";
export type CellKind = "proposed" | FigureStance | "builds" | "none";

export type GlancePoint = {
    rank: number;
    title: string;
    x: number;
    y: number;
    hollow: boolean;
    held: number;
    evidence: number;
    backers: number;
    sides: number;
};
export type StanceCell = { seat: string; kind: CellKind };
export type StanceRow = {
    rank: number;
    title: string;
    cells: StanceCell[];
    backers: number;
    sides: number;
    agreed: boolean;
};

export type SpendRow = {
    id: string | null; // null: the "Memory check · outside the seats" row
    name: string;
    model: string;
    tokens: number;
    calls: number;
    perCall: number;
    ms: number;
    coordinator: boolean;
};

export type StepShape = "tick" | "dot" | "square" | "flag";
export type LaneStep = { ts: number; shape: StepShape; target: string; shared: boolean };
export type LaneSpan = { start: number; end: number; steps: number; top: string[] };
export type Lane = { seat: CouncilExpert; spans: LaneSpan[]; steps: LaneStep[]; capped: boolean };
export type RoundMark = { round: number; ts: number };
export type SharedRead = { path: string; seats: string[]; reads: number }; // `seats` holds expert ids

export type GraphSeat = { id: string; name: string; replies: number; you: boolean };
/** `y` is the idea row's top in px from the column top: the group headings and the idea rows summed in group order
 *  (`GRAPH_HEADING_PX`, `GRAPH_ROW_PX`). */
export type GraphIdea = { id: string; title: string; label: string; merged: boolean; dim: boolean; y: number };
export type IdeaGroup = { key: string; heading: string; ideas: GraphIdea[] };
export type GraphEdge = { seat: string; idea: string; stance: FigureStance | "proposed"; count: number };

/** `x` is `log10(tokens per run)`. */
export type BenchPoint = {
    harness: string;
    variant: string;
    mode: string;
    x: number;
    y: number;
    hollow: boolean;
    newest: boolean;
    label: string;
    row: CouncilBenchRow;
};
export type BenchPanel = {
    mode: "review" | "brainstorm";
    points: BenchPoint[];
    frontier: BenchPoint[];
    takeaway: string;
};

/** Figure A, At a glance: evidence × agreement, one point per direction (a Review's Report only). */
export function glancePoints(c: Council): { points: GlancePoint[]; takeaway: string } | null {
    // Task 3 implements
    void c;
    return null;
}

/** Figure B, the stance grid: direction × seat (both modes). */
export function stanceGrid(c: Council): { seats: CouncilExpert[]; rows: StanceRow[]; takeaway: string } | null {
    // Task 3 implements
    void c;
    return null;
}

/** Figure C, what each seat spent. */
export function seatSpend(
    c: Council
): { rows: SpendRow[]; total: number; calls: number; ms: number; takeaway: string } | null {
    // Task 3 implements
    void c;
    return null;
}

/** Figure D, when each seat worked and what it read twice. */
export function seatLanes(c: Council): {
    lanes: Lane[];
    rounds: RoundMark[];
    shared: SharedRead[];
    more: SharedRead | null;
    moreCount: number;
    t0: number;
    t1: number;
    takeaway: string;
} | null {
    // Task 3 implements
    void c;
    return null;
}

/** Figure E, the argument map. */
export function argumentGraph(
    c: Council
): { seats: GraphSeat[]; groups: IdeaGroup[]; edges: GraphEdge[]; takeaway: string } | null {
    // Task 3 implements
    void c;
    return null;
}

/** Figure F, the benchmark: key lines found against tokens per run, one small multiple per mode. */
export function benchPoints(rows: CouncilBenchRow[]): {
    review: BenchPanel | null;
    brainstorm: BenchPanel | null;
    runs: number;
    modes: number;
    takeaway: string;
} {
    // Task 3 implements
    void rows;
    return { review: null, brainstorm: null, runs: 0, modes: 0, takeaway: "" };
}
