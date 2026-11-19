// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    GLYPH_END_PX,
    GRAPH_GAP_PX,
    LANDING_STEP_PX,
    edgePath,
    edgePointAt,
    edgeStays,
    ideaMark,
    parseMark,
    placeGraph,
    relatedTo,
    seatMark,
    stanceTally,
    tallyWords,
} from "./councilargumentgeometry";
import {
    GRAPH_HEADING_PX,
    GRAPH_ROW_PX,
    type GraphEdge,
    type GraphIdea,
    type GraphSeat,
    type IdeaGroup,
} from "./councilfiguresmodel";

const seat = (id: string): GraphSeat => ({ id, name: id.toUpperCase(), replies: 0, you: id === "you" });
const idea = (id: string, y: number): GraphIdea => ({
    id,
    title: `Idea ${id}`,
    label: "",
    merged: false,
    dim: false,
    y,
});
const edge = (seat: string, idea: string, stance: GraphEdge["stance"], count = 1): GraphEdge => ({
    seat,
    idea,
    stance,
    count,
});

// D1 holds P1 and P2 (heading at 0, ideas at 28 and 56); Also raised holds P3 (heading at 84, idea at 112)
const groups: IdeaGroup[] = [
    {
        key: "d1",
        heading: "D1 · First",
        ideas: [idea("P1", GRAPH_HEADING_PX), idea("P2", GRAPH_HEADING_PX + GRAPH_ROW_PX)],
    },
    { key: "raised", heading: "Also raised", ideas: [idea("P3", 4 * GRAPH_ROW_PX)] },
];

describe("edgePath", () => {
    it("leaves and arrives level, crossing the gap", () => {
        expect(edgePath(14, 98, 100)).toBe("M0 14 C50 14 50 98 100 98");
    });
});

describe("edgePointAt", () => {
    it("starts on the seat, ends on the idea, and crosses the middle halfway", () => {
        const start = edgePointAt(0, 10, 90, 100);
        expect(start.x).toBe(0);
        expect(start.y).toBeCloseTo(10, 6);
        const end = edgePointAt(100, 10, 90, 100);
        expect(end.x).toBe(100);
        expect(end.y).toBeCloseTo(90, 4);
        // the curve is point-symmetric about its middle
        const mid = edgePointAt(50, 10, 90, 100);
        expect(mid.y).toBeCloseTo(50, 4);
    });

    it("lies on the curve: a point nearer the idea is nearer its y", () => {
        const a = edgePointAt(120, 0, 200);
        const b = edgePointAt(160, 0, 200);
        expect(b.y).toBeGreaterThan(a.y);
        expect(b.y).toBeLessThanOrEqual(200);
    });

    it("clamps x into the gap", () => {
        expect(edgePointAt(-5, 3, 9).x).toBe(0);
        expect(edgePointAt(9999, 3, 9).x).toBe(GRAPH_GAP_PX);
    });
});

describe("placeGraph", () => {
    const seats = [seat("a"), seat("b"), seat("you")];

    it("puts a seat's end at its row's middle and an idea's at its y's middle", () => {
        const { edges } = placeGraph(seats, groups, [edge("b", "P1", "challenge")]);
        expect(edges).toHaveLength(1);
        expect(edges[0].y1).toBe(1 * GRAPH_ROW_PX + GRAPH_ROW_PX / 2);
        expect(edges[0].y2).toBe(GRAPH_HEADING_PX + GRAPH_ROW_PX / 2);
        expect(edges[0].key).toBe("b->P1:challenge");
    });

    it("takes each group's heading from its first idea and the height from the taller column", () => {
        const layout = placeGraph(seats, groups, []);
        expect(layout.headings).toEqual([
            { key: "d1", heading: "D1 · First", top: 0 },
            { key: "raised", heading: "Also raised", top: 3 * GRAPH_ROW_PX },
        ]);
        // P3's row ends at 5 rows: taller than the 3 seat rows
        expect(layout.height).toBe(5 * GRAPH_ROW_PX);
        const tall = placeGraph(
            [...seats, seat("c"), seat("d"), seat("e"), seat("f"), seat("g"), seat("h")],
            groups,
            []
        );
        expect(tall.height).toBe(9 * GRAPH_ROW_PX);
    });

    it("leaves an empty group's heading out and an edge with no row to land on", () => {
        const layout = placeGraph(
            seats,
            [...groups, { key: "cut", heading: "Cut", ideas: [] }],
            [edge("a", "P1", "accept"), edge("zz", "P1", "accept"), edge("a", "nope", "accept")]
        );
        expect(layout.headings.map((h) => h.key)).toEqual(["d1", "raised"]);
        expect(layout.edges.map((e) => e.key)).toEqual(["a->P1:accept"]);
    });

    it("spreads the edges that end at one idea and keeps their glyphs apart along their own curves", () => {
        const into = [
            edge("b", "P2", "oppose"),
            edge("a", "P2", "proposed"),
            edge("you", "P2", "accept"),
            edge("a", "P2", "challenge", 2),
        ];
        const { edges } = placeGraph(seats, groups, into);
        expect(edges.map((e) => e.key)).toEqual([
            "b->P2:oppose",
            "a->P2:proposed",
            "you->P2:accept",
            "a->P2:challenge",
        ]);
        const mid = GRAPH_HEADING_PX + GRAPH_ROW_PX + GRAPH_ROW_PX / 2;
        // landing: the author first, then accept, challenge, oppose; centred on the row, LANDING_STEP_PX apart
        const byKey = Object.fromEntries(edges.map((e) => [e.key, e]));
        expect(byKey["a->P2:proposed"].y2).toBeCloseTo(mid - 1.5 * LANDING_STEP_PX);
        expect(byKey["you->P2:accept"].y2).toBeCloseTo(mid - 0.5 * LANDING_STEP_PX);
        expect(byKey["a->P2:challenge"].y2).toBeCloseTo(mid + 0.5 * LANDING_STEP_PX);
        expect(byKey["b->P2:oppose"].y2).toBeCloseTo(mid + 1.5 * LANDING_STEP_PX);
        // the first lands its glyph nearest the idea, the rest step back along the gap
        const xs = ["a->P2:proposed", "you->P2:accept", "a->P2:challenge", "b->P2:oppose"].map((k) => byKey[k].glyph.x);
        expect(xs[0]).toBeCloseTo(GRAPH_GAP_PX - GLYPH_END_PX);
        for (let i = 1; i < xs.length; i++) {
            expect(xs[i - 1] - xs[i]).toBeGreaterThanOrEqual(12);
        }
    });

    it("packs the glyphs of many edges into the gap instead of past it", () => {
        const many = Array.from({ length: 12 }, (_, i) => seat(`s${i}`));
        const into = many.map((s) => edge(s.id, "P1", "accept"));
        const { edges } = placeGraph(many, groups, into);
        const xs = edges.map((e) => e.glyph.x);
        expect(Math.min(...xs)).toBeGreaterThan(GRAPH_GAP_PX * 0.3);
        expect(new Set(xs.map((x) => Math.round(x))).size).toBe(xs.length);
    });

    it("keeps the model's edge order", () => {
        const into = [edge("b", "P3", "accept"), edge("a", "P1", "accept"), edge("a", "P3", "challenge")];
        const { edges } = placeGraph(seats, groups, into);
        expect(edges.map((e) => e.key)).toEqual(["b->P3:accept", "a->P1:accept", "a->P3:challenge"]);
    });
});

describe("marks", () => {
    it("round-trips an idea and a seat, and reads anything else as no mark", () => {
        expect(parseMark(ideaMark("P5"))).toEqual({ kind: "idea", id: "P5" });
        expect(parseMark(seatMark("ux:2"))).toEqual({ kind: "seat", id: "ux:2" });
        expect(parseMark(null)).toBeNull();
        expect(parseMark("P5")).toBeNull();
    });

    it("keeps every edge at full strength with nothing active, else only the active mark's edges", () => {
        const e1 = edge("a", "P1", "accept");
        const e2 = edge("b", "P1", "challenge");
        const e3 = edge("a", "P2", "oppose");
        expect([e1, e2, e3].map((e) => edgeStays(null, e))).toEqual([true, true, true]);
        const onIdea = parseMark(ideaMark("P1"));
        expect([e1, e2, e3].map((e) => edgeStays(onIdea, e))).toEqual([true, true, false]);
        const onSeat = parseMark(seatMark("a"));
        expect([e1, e2, e3].map((e) => edgeStays(onSeat, e))).toEqual([true, false, true]);
    });

    it("names the nodes an active mark connects, itself included", () => {
        const edges = [edge("a", "P1", "accept"), edge("b", "P1", "challenge"), edge("a", "P2", "oppose")];
        expect(relatedTo(null, edges)).toBeNull();
        const idea1 = relatedTo(parseMark(ideaMark("P1")), edges);
        expect([...(idea1?.seats ?? [])].sort()).toEqual(["a", "b"]);
        expect([...(idea1?.ideas ?? [])]).toEqual(["P1"]);
        const seatA = relatedTo(parseMark(seatMark("a")), edges);
        expect([...(seatA?.seats ?? [])]).toEqual(["a"]);
        expect([...(seatA?.ideas ?? [])].sort()).toEqual(["P1", "P2"]);
        // an idea nobody touched still names itself
        const lone = relatedTo(parseMark(ideaMark("P3")), edges);
        expect([...(lone?.ideas ?? [])]).toEqual(["P3"]);
        expect(lone?.seats.size).toBe(0);
    });
});

describe("stanceTally and tallyWords", () => {
    const edges = [
        edge("a", "P1", "proposed"),
        edge("b", "P1", "accept", 2),
        edge("you", "P1", "challenge"),
        edge("b", "P2", "accept"),
        edge("a", "P2", "oppose", 3),
    ];

    it("adds the replies of the edges kept, counting an edge by its count and leaving the author's out", () => {
        expect(stanceTally(edges, (e) => e.idea === "P1")).toEqual({ accept: 2, challenge: 1, oppose: 0 });
        expect(stanceTally(edges, (e) => e.seat === "b")).toEqual({ accept: 3, challenge: 0, oppose: 0 });
        expect(stanceTally(edges, () => true)).toEqual({ accept: 3, challenge: 1, oppose: 3 });
    });

    it("words it as the tooltip does, leaving a stance with none out", () => {
        expect(tallyWords({ accept: 3, challenge: 1, oppose: 2 })).toBe("3 accept, 1 challenge, 2 oppose");
        expect(tallyWords({ accept: 0, challenge: 4, oppose: 0 })).toBe("4 challenge");
        expect(tallyWords({ accept: 0, challenge: 0, oppose: 0 })).toBe("no replies");
    });
});
