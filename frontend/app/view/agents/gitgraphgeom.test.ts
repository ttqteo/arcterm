// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { assignLanes, type GraphCommit, type LanedRow } from "./gitgraph";
import { graphGeometry } from "./gitgraphgeom";

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, parents });
const OPTS = { rowH: 34, maxLanes: 7 };

describe("graphGeometry", () => {
    it("draws a straight segment between commits in the same lane", () => {
        const g = graphGeometry(assignLanes([c("a", "b"), c("b")]), OPTS);
        expect(g.edges).toHaveLength(1);
        // same lane => a plain move-line, no curve
        expect(g.edges[0].d).toBe("M13 17 L13 51");
        expect(g.edges[0].d).not.toContain("Q");
    });

    it("curves a segment that crosses lanes", () => {
        const g = graphGeometry(assignLanes([c("m", "a", "b"), c("a", "c"), c("b", "c"), c("c")]), OPTS);
        const crossing = g.edges.filter((e) => e.d.includes("Q"));
        expect(crossing.length).toBeGreaterThan(0);
    });

    it("skips a parent that is outside the loaded window", () => {
        const g = graphGeometry(assignLanes([c("a", "notloaded")]), OPTS);
        expect(g.edges).toHaveLength(0);
        expect(g.nodes).toHaveLength(1);
    });

    it("gives a merge node a larger radius", () => {
        const g = graphGeometry(assignLanes([c("m", "a", "b"), c("a", "c"), c("b", "c"), c("c")]), OPTS);
        expect(g.nodes[0].r).toBeGreaterThan(g.nodes[1].r);
    });

    it("derives gutter width from the lane cap, not the lane count", () => {
        const linear = graphGeometry(assignLanes([c("a", "b"), c("b")]), { rowH: 34, maxLanes: 1 });
        expect(linear.gutter).toBe(13 + 1 * 15 + 4);
        const wide = graphGeometry(assignLanes([c("a", "b"), c("b")]), { rowH: 34, maxLanes: 7 });
        expect(wide.gutter).toBeGreaterThan(linear.gutter);
    });

    it("folds lanes past the cap and counts them", () => {
        // six commits each on their own lane; cap at 3 so three fold
        const rows = assignLanes([c("a", "p1"), c("b", "p2"), c("c", "p3"), c("d", "p4"), c("e", "p5"), c("f", "p6")]);
        const g = graphGeometry(rows, { rowH: 34, maxLanes: 3 });
        expect(g.foldedCount).toBe(3);
        const xs = g.nodes.map((n) => n.x);
        // folded nodes clamp to the last drawable lane rather than running off the gutter
        expect(Math.max(...xs)).toBe(13 + 2 * 15);
        expect(g.nodes.filter((n) => n.folded)).toHaveLength(3);
    });

    it("adds divider height to the row below and to the total", () => {
        const plain = graphGeometry(assignLanes([c("a", "b"), c("b")]), OPTS);
        const withDiv = graphGeometry(
            assignLanes([{ hash: "a", parents: ["b"], divider: "session start" }, c("b")]),
            OPTS
        );
        expect(withDiv.height).toBe(plain.height + 30);
        expect(withDiv.nodes[1].y).toBe(plain.nodes[1].y + 30);
    });

    it("marks the working-tree row's edge as dashed", () => {
        const g = graphGeometry(assignLanes([{ hash: "wt", parents: ["a"], workingTree: true }, c("a")]), OPTS);
        expect(g.edges[0].dashed).toBe(true);
        expect(g.nodes[0].workingTree).toBe(true);
    });

    it("returns zero-size geometry for no rows", () => {
        const g = graphGeometry([], OPTS);
        expect(g.edges).toEqual([]);
        expect(g.nodes).toEqual([]);
        expect(g.foldedCount).toBe(0);
        expect(g.height).toBe(0);
    });

    it("is as tall as its rows plus the bottom padding", () => {
        // two 34px rows and 8px of padding
        expect(graphGeometry(assignLanes([c("a", "b"), c("b")]), OPTS).height).toBe(76);
    });

    it("curves a crossing segment from the child's lane toward the parent's, in either direction", () => {
        const g = graphGeometry(assignLanes([c("m", "a", "b"), c("a", "c"), c("b", "c"), c("c")]), OPTS);
        expect(g.edges.map((e) => e.d)).toEqual([
            "M13 17 L13 51",
            "M13 17 L13 72 Q13 85 26 85 L28 85",
            "M13 51 L13 119",
            "M28 85 L28 106 Q28 119 15 119 L13 119",
        ]);
    });

    it("tints a segment by the leftmost lane it joins", () => {
        const g = graphGeometry(assignLanes([c("m", "a", "b"), c("a", "c"), c("b", "c"), c("c")]), OPTS);
        expect(g.edges.map((e) => e.lane)).toEqual([0, 0, 0, 0]);
    });

    it("marks which nodes sit past the lane cap", () => {
        const rows = assignLanes([c("a", "p1"), c("b", "p2"), c("c", "p3"), c("d", "p4"), c("e", "p5"), c("f", "p6")]);
        const g = graphGeometry(rows, { rowH: 34, maxLanes: 3 });
        expect(g.nodes.map((n) => n.folded)).toEqual([false, false, false, true, true, true]);
    });

    it("folds a segment when either end is past the lane cap, and not when both are on drawable lanes", () => {
        const row = (hash: string, lane: number, ...parents: string[]): LanedRow => ({
            hash,
            parents,
            lane,
            merge: parents.length > 1,
        });
        // cap of 2 lanes: lane 1 is the last drawable one, lanes 2 and 3 fold into it
        const rows = [
            row("a", 0, "b", "c"),
            row("b", 1),
            row("c", 2, "e", "g"),
            row("e", 0, "f"),
            row("f", 1),
            row("g", 3),
        ];
        const g = graphGeometry(rows, { rowH: 34, maxLanes: 2 });
        // a-b, a-c (parent folded), c-e (child folded), c-g (both folded), e-f
        expect(g.edges.map((e) => [e.lane, e.folded])).toEqual([
            [0, false],
            [0, true],
            [0, true],
            [2, true],
            [0, false],
        ]);
    });

    it("draws no segment into a row with an empty hash, the working tree's", () => {
        const rows = assignLanes([c("a", ""), { hash: "", parents: [], workingTree: true }]);
        expect(graphGeometry(rows, OPTS).edges).toEqual([]);
    });

    it("reports where to draw the fold indicator, just left of the last drawable lane", () => {
        const rows = assignLanes([
            { hash: "a", parents: ["b"] },
            { hash: "b", parents: [] },
        ]);
        // lanes are 15px wide starting at a 13px left pad, and the indicator is centred on the last
        // drawable lane: 13 + (3 - 1) * 15 - 7 = 36
        expect(graphGeometry(rows, { rowH: 34, maxLanes: 3 }).foldX).toBe(36);
    });
});
