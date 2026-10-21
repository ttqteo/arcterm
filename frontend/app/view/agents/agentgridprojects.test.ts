// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    EMPTY_PROJECT_GRIDS,
    parseProjectGrids,
    projectGridsEquals,
    reconcileProjectGrids,
    shownGrid,
    withShownGrid,
    type GridState,
    type ProjectGrids,
} from "./agentgrid";

const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });
const pg = (project: string | null, grids: Record<string, GridState>): ProjectGrids => ({ project, grids });

// a roster: id -> project; every id is live with a terminal
function input(projects: Record<string, string>, focusId: string | undefined, seeded = true) {
    return {
        focusId,
        eligible: new Set(Object.keys(projects)),
        projectOf: new Map(Object.entries(projects)),
        seeded,
    };
}

describe("parseProjectGrids", () => {
    it("reads anything that is not the shape as no grids", () => {
        expect(parseProjectGrids(undefined)).toEqual(EMPTY_PROJECT_GRIDS);
        expect(parseProjectGrids(5)).toEqual(EMPTY_PROJECT_GRIDS);
        expect(parseProjectGrids({ project: 3, grids: "x" })).toEqual(EMPTY_PROJECT_GRIDS);
    });
    it("repairs each grid and drops the empty ones", () => {
        const raw = { project: "x", grids: { x: { ids: ["a", "a"], focused: "zz" }, y: { ids: [] }, z: 4 } };
        expect(parseProjectGrids(raw)).toEqual(pg("x", { x: g(["a"]) }));
    });
});

describe("shownGrid / withShownGrid", () => {
    it("shows the shown project's grid, and none when it has none", () => {
        expect(shownGrid(pg("x", { x: g(["a", "b"]), y: g(["c"]) }))).toEqual(g(["a", "b"]));
        expect(shownGrid(pg("y", { x: g(["a"]) }))).toEqual(g([]));
        expect(shownGrid(EMPTY_PROJECT_GRIDS)).toEqual(g([]));
    });
    it("writes the shown project's grid and leaves the others", () => {
        const next = withShownGrid(pg("x", { x: g(["a"]), y: g(["c"]) }), g(["a", "b"], "b"));
        expect(next).toEqual(pg("x", { x: g(["a", "b"], "b"), y: g(["c"]) }));
    });
    it("drops the shown project's grid when it is written empty", () => {
        expect(withShownGrid(pg("x", { x: g(["a"]), y: g(["c"]) }), g([]))).toEqual(pg("x", { y: g(["c"]) }));
    });
    it("files a grid written with no shown project under the fallback project", () => {
        expect(withShownGrid(EMPTY_PROJECT_GRIDS, g(["a"]), "home")).toEqual(pg("home", { home: g(["a"]) }));
    });
});

describe("reconcileProjectGrids", () => {
    const roster = { a: "x", b: "x", c: "y", d: "y" };

    it("shows the focused tab's project's grid, and keeps the other project's split for when it comes back", () => {
        const start = pg("x", { x: g(["a", "b"]), y: g(["c", "d"], "d") });
        const onY = reconcileProjectGrids(start, input(roster, "c"));
        expect(onY).toEqual(pg("y", { x: g(["a", "b"]), y: g(["c", "d"], "c") }));
        const backOnX = reconcileProjectGrids(onY, input(roster, "b"));
        expect(backOnX).toEqual(pg("x", { x: g(["a", "b"], "b"), y: g(["c", "d"], "c") }));
    });
    it("never puts another project's tab in the shown grid", () => {
        // a split saved before grids followed projects, or a tab whose project changed under it
        const start = pg("x", { x: g(["a", "c"]) });
        expect(reconcileProjectGrids(start, input(roster, "a"))).toEqual(pg("x", { x: g(["a"]) }));
    });
    it("starts a project with no grid on the focused tab alone", () => {
        const start = pg("x", { x: g(["a", "b"]) });
        expect(reconcileProjectGrids(start, input(roster, "d"))).toEqual(pg("y", { x: g(["a", "b"]), y: g(["d"]) }));
    });
    it("prunes the tabs that left from every project's grid, and drops a grid left empty", () => {
        const start = pg("x", { x: g(["a", "b"]), y: g(["c"]) });
        expect(reconcileProjectGrids(start, input({ a: "x", d: "y" }, "a"))).toEqual(pg("x", { x: g(["a"]) }));
    });
    it("keeps the shown project when the focus is not a cell (an ended worker, a tab with no terminal)", () => {
        const start = pg("x", { x: g(["a", "b"]) });
        expect(reconcileProjectGrids(start, input(roster, "ghost"))).toEqual(start);
        expect(reconcileProjectGrids(start, input(roster, undefined))).toEqual(start);
    });
    it("changes nothing before the roster is seeded", () => {
        const start = pg("x", { x: g(["a", "zz"]), y: g(["c"]) });
        expect(reconcileProjectGrids(start, input(roster, "c", false))).toEqual(start);
    });
    it("is idempotent", () => {
        const once = reconcileProjectGrids(pg("x", { x: g(["a", "c", "b"]) }), input(roster, "d"));
        expect(reconcileProjectGrids(once, input(roster, "d"))).toEqual(once);
    });
});

describe("projectGridsEquals", () => {
    it("compares the shown project and every grid, in any key order", () => {
        const a = pg("x", { x: g(["a"]), y: g(["c"]) });
        expect(projectGridsEquals(a, pg("x", { y: g(["c"]), x: g(["a"]) }))).toBe(true);
        expect(projectGridsEquals(a, pg("y", { x: g(["a"]), y: g(["c"]) }))).toBe(false);
        expect(projectGridsEquals(a, pg("x", { x: g(["a"]) }))).toBe(false);
        expect(projectGridsEquals(a, pg("x", { x: g(["a"]), y: g(["c", "d"]) }))).toBe(false);
    });
});
