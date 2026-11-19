// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where the argument map (councilargumentmap.tsx, figure E of docs/superpowers/plans/2026-11-19-council-figures.md)
// puts its marks, and what a hover keeps at full strength. Pure, no React: the view draws what this computes, so every
// edge is placed in one pass from the model's fixed rows (`GraphIdea.y`, `index * GRAPH_ROW_PX` for a seat), never from
// a measured DOM.
//
// An edge is a horizontal cubic from a seat's row (the left column) to an idea's row (the right column), across a gap
// `GRAPH_GAP_PX` wide: it leaves the seat flat, crosses the gap and arrives flat. Where several edges end at one idea,
// each lands a few px apart and carries its stance glyph at a different x along its own curve, so the glyphs never sit
// on top of one another and each still belongs to a line the eye can follow.

import {
    GRAPH_HEADING_PX,
    GRAPH_ROW_PX,
    GRAPH_SEAT_TOP_PX,
    type FigureStance,
    type GraphEdge,
    type GraphSeat,
    type IdeaGroup,
} from "./councilfiguresmodel";

/** The width of the gap the edges cross, between the seat column and the idea column. */
export const GRAPH_GAP_PX = 176;
/** How far apart two edges that end at one idea land on its row. */
export const LANDING_STEP_PX = 3;
/** The spacing of the glyphs of edges that end at one idea, along their curves; it shrinks when many edges meet. */
export const GLYPH_STEP_PX = 14;
/** The nearest glyph's distance from the idea column. */
export const GLYPH_END_PX = 10;
/** The glyphs of one idea take at most this share of the gap, counted from the idea column. */
const GLYPH_SPAN = 0.6;

/** Pure: the SVG path of an edge from `(0, y1)` to `(w, y2)`: a cubic whose control points sit halfway across, level with
 *  each end, so it leaves and arrives horizontally. */
export function edgePath(y1: number, y2: number, w = GRAPH_GAP_PX): string {
    const mid = w / 2;
    return `M0 ${y1} C${mid} ${y1} ${mid} ${y2} ${w} ${y2}`;
}

/** Pure: the point of that edge at horizontal position `x` (0 to `w`). The curve's x only grows with its parameter
 *  (`w * (1.5t - 1.5t² + t³)`, whose slope never reaches zero), so one bisection finds it. */
export function edgePointAt(x: number, y1: number, y2: number, w = GRAPH_GAP_PX): { x: number; y: number } {
    const want = Math.min(Math.max(x, 0), w);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
        const t = (lo + hi) / 2;
        const cx = w * (1.5 * t - 1.5 * t * t + t * t * t);
        if (cx < want) {
            lo = t;
        } else {
            hi = t;
        }
    }
    const t = (lo + hi) / 2;
    const s = 3 * t * t - 2 * t * t * t;
    return { x: want, y: y1 + (y2 - y1) * s };
}

export type PlacedEdge = {
    /** `<seat>-><idea>` plus the stance: unique even when a seat both proposed an idea and replied to it */
    key: string;
    edge: GraphEdge;
    /** where it leaves the seat's row, and where it lands on the idea's: y in px from the top of the graph */
    y1: number;
    y2: number;
    /** the stance glyph's centre on the curve, in the gap's own coordinates (0 to `GRAPH_GAP_PX`) */
    glyph: { x: number; y: number };
};

export type PlacedHeading = { key: string; heading: string; top: number };

export type GraphLayout = {
    edges: PlacedEdge[];
    headings: PlacedHeading[];
    /** the height the graph needs: the taller of the seat column and the idea column */
    height: number;
};

const STANCE_ORDER: Record<GraphEdge["stance"], number> = { proposed: 0, accept: 1, challenge: 2, oppose: 3 };

/** Pure: every edge's ends and glyph, every group heading's top, and the graph's height, from the model's rows. An edge
 *  whose seat or idea the model does not list is left out (it would have nowhere to be drawn). */
export function placeGraph(
    seats: readonly GraphSeat[],
    groups: readonly IdeaGroup[],
    edges: readonly GraphEdge[]
): GraphLayout {
    const seatTop = new Map<string, number>();
    seats.forEach((s, i) => seatTop.set(s.id, GRAPH_SEAT_TOP_PX + i * GRAPH_ROW_PX));
    const seatIndex = new Map<string, number>();
    seats.forEach((s, i) => seatIndex.set(s.id, i));
    const ideaTop = new Map<string, number>();
    const headings: PlacedHeading[] = [];
    let ideasEnd = 0;
    for (const g of groups) {
        if (g.ideas.length === 0) {
            continue;
        }
        headings.push({ key: g.key, heading: g.heading, top: g.ideas[0].y - GRAPH_HEADING_PX });
        for (const idea of g.ideas) {
            ideaTop.set(idea.id, idea.y);
            ideasEnd = Math.max(ideasEnd, idea.y + GRAPH_ROW_PX);
        }
    }

    // the edges that end at each idea, the author's first, then by seat order: the landing and the glyph's place follow it
    const byIdea = new Map<string, GraphEdge[]>();
    for (const e of edges) {
        if (!seatTop.has(e.seat) || !ideaTop.has(e.idea)) {
            continue;
        }
        byIdea.set(e.idea, [...(byIdea.get(e.idea) ?? []), e]);
    }
    const placed: PlacedEdge[] = [];
    for (const [ideaId, incoming] of byIdea) {
        const sorted = [...incoming].sort(
            (a, b) =>
                STANCE_ORDER[a.stance] - STANCE_ORDER[b.stance] ||
                (seatIndex.get(a.seat) ?? 0) - (seatIndex.get(b.seat) ?? 0)
        );
        const k = sorted.length;
        const step = k > 1 ? Math.min(GLYPH_STEP_PX, (GRAPH_GAP_PX * GLYPH_SPAN) / (k - 1)) : 0;
        const rowMid = (ideaTop.get(ideaId) ?? 0) + GRAPH_ROW_PX / 2;
        sorted.forEach((edge, j) => {
            const y1 = (seatTop.get(edge.seat) ?? 0) + GRAPH_ROW_PX / 2;
            const y2 = rowMid + (j - (k - 1) / 2) * LANDING_STEP_PX;
            placed.push({
                key: `${edge.seat}->${edge.idea}:${edge.stance}`,
                edge,
                y1,
                y2,
                glyph: edgePointAt(GRAPH_GAP_PX - GLYPH_END_PX - j * step, y1, y2),
            });
        });
    }
    // the model's own order is kept (React keeps an element in place while its siblings do not move)
    const order = new Map(edges.map((e, i) => [e, i] as const));
    placed.sort((a, b) => (order.get(a.edge) ?? 0) - (order.get(b.edge) ?? 0));

    return { edges: placed, headings, height: Math.max(GRAPH_SEAT_TOP_PX + seats.length * GRAPH_ROW_PX, ideasEnd) };
}

// ── what a hover keeps ────────────────────────────────────────────────────────────────────────────────────────────

/** What is hovered or focused: an idea or a seat, as one string for `useHoverDim` (`i:P5`, `s:ux`). */
export type Mark = { kind: "idea" | "seat"; id: string };

export const ideaMark = (id: string) => `i:${id}`;
export const seatMark = (id: string) => `s:${id}`;

/** Pure: the mark an active string names; `null` for none, or a string neither helper wrote. */
export function parseMark(active: string | null): Mark | null {
    if (active == null) {
        return null;
    }
    if (active.startsWith("i:")) {
        return { kind: "idea", id: active.slice(2) };
    }
    if (active.startsWith("s:")) {
        return { kind: "seat", id: active.slice(2) };
    }
    return null;
}

/** Pure: whether an edge stays at full strength: always when nothing is active, else when it touches the active idea or
 *  seat. */
export function edgeStays(mark: Mark | null, edge: Pick<GraphEdge, "seat" | "idea">): boolean {
    if (mark == null) {
        return true;
    }
    return mark.kind === "idea" ? edge.idea === mark.id : edge.seat === mark.id;
}

/** Pure: the seats and ideas an active mark connects (itself included), which stay readable while the rest of the nodes
 *  fade with the edges; `null` when nothing is active. */
export function relatedTo(
    mark: Mark | null,
    edges: readonly Pick<GraphEdge, "seat" | "idea">[]
): { seats: ReadonlySet<string>; ideas: ReadonlySet<string> } | null {
    if (mark == null) {
        return null;
    }
    const seats = new Set<string>();
    const ideas = new Set<string>();
    if (mark.kind === "idea") {
        ideas.add(mark.id);
    } else {
        seats.add(mark.id);
    }
    for (const e of edges) {
        if (edgeStays(mark, e)) {
            seats.add(e.seat);
            ideas.add(e.idea);
        }
    }
    return { seats, ideas };
}

// ── counts ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StanceTally = Record<FigureStance, number>;

/** Pure: how many replies of each stance the edges that pass `keep` carry (an edge is one or more replies: `count`);
 *  the author's own edge is a proposal, not a stance, and is left out. */
export function stanceTally(edges: readonly GraphEdge[], keep: (e: GraphEdge) => boolean): StanceTally {
    const tally: StanceTally = { accept: 0, challenge: 0, oppose: 0 };
    for (const e of edges) {
        if (e.stance !== "proposed" && keep(e)) {
            tally[e.stance] += e.count;
        }
    }
    return tally;
}

/** Pure: a tally in words, `3 accept, 1 challenge, 2 oppose`, a stance with none left out; `no replies` for an empty one. */
export function tallyWords(t: StanceTally): string {
    const parts = (["accept", "challenge", "oppose"] as const).filter((s) => t[s] > 0).map((s) => `${t[s]} ${s}`);
    return parts.length === 0 ? "no replies" : parts.join(", ");
}
