// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { assignLanes, laneCount, type GraphCommit } from "./gitgraph";

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, parents });

describe("assignLanes", () => {
    it("keeps a linear history in one lane", () => {
        const rows = assignLanes([c("a", "b"), c("b", "c"), c("c")]);
        expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
        expect(laneCount(rows)).toBe(1);
    });

    it("puts a side branch in its own lane and rejoins at the merge base", () => {
        // m is a merge of a and b; both descend from c
        const rows = assignLanes([c("m", "a", "b"), c("a", "c"), c("b", "c"), c("c")]);
        expect(rows.map((r) => `${r.hash}:${r.lane}`)).toEqual(["m:0", "a:0", "b:1", "c:0"]);
        expect(laneCount(rows)).toBe(2);
    });

    it("flags merge commits by parent count", () => {
        const rows = assignLanes([c("m", "a", "b"), c("a", "c"), c("b", "c"), c("c")]);
        expect(rows.map((r) => r.merge)).toEqual([true, false, false, false]);
    });

    it("frees a lane at a root commit so a later branch reuses it", () => {
        // two disconnected roots: r1 ends, so r2 takes lane 0 rather than lane 1
        const rows = assignLanes([c("r1"), c("r2")]);
        expect(rows.map((r) => r.lane)).toEqual([0, 0]);
        expect(laneCount(rows)).toBe(1);
    });

    it("holds a lane open for a parent outside the loaded window", () => {
        // 'z' is never loaded; its lane stays reserved so a sibling does not steal it
        const rows = assignLanes([c("a", "z"), c("b", "y")]);
        expect(rows.map((r) => r.lane)).toEqual([0, 1]);
        expect(laneCount(rows)).toBe(2);
    });

    it("gives a freed lane to the next commit that needs one, not a new column", () => {
        // z is a root, so its lane frees while lane 1 stays reserved for y; n takes the freed lane 0
        const rows = assignLanes([c("a", "z"), c("b", "y"), c("z"), c("n", "m")]);
        expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
    });

    it("frees the lane a merged branch was waiting in once its commit is drawn", () => {
        // b and a both wait on c; after c, lane 1 is free again, so x opens lane 1 rather than lane 2
        const rows = assignLanes([c("m", "a", "b"), c("a", "c"), c("b", "c"), c("c", "d"), c("x", "y")]);
        expect(rows.map((r) => `${r.hash}:${r.lane}`)).toEqual(["m:0", "a:0", "b:1", "c:0", "x:1"]);
    });

    it("leaves the lanes waiting on other commits alone when one commit is drawn", () => {
        // m reserves lanes 1 and 2 for b and c; drawing a must not release them, so c still sits in lane 2
        const rows = assignLanes([c("m", "a", "b", "c"), c("a", "a2"), c("c", "c2")]);
        expect(rows.map((r) => `${r.hash}:${r.lane}`)).toEqual(["m:0", "a:0", "c:2"]);
    });

    it("reserves a lane for every parent of a merge, so an unrelated commit goes beside them", () => {
        const rows = assignLanes([c("m", "a", "b"), c("x"), c("a"), c("b")]);
        expect(rows.map((r) => `${r.hash}:${r.lane}`)).toEqual(["m:0", "x:2", "a:0", "b:1"]);
    });

    it("carries the original commit through unchanged", () => {
        const rows = assignLanes([c("a", "b"), c("b")]);
        expect(rows[0].hash).toBe("a");
        expect(rows[0].parents).toEqual(["b"]);
    });

    it("returns an empty result for empty input", () => {
        expect(assignLanes([])).toEqual([]);
        expect(laneCount([])).toBe(0);
    });
});
