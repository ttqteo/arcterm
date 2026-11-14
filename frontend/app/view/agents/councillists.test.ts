// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { spliceCouncil } from "./councillists";

const c = (id: string, project: string, updated: number, extra: Partial<Council> = {}): Council => ({
    id,
    project,
    feature: `feature ${id}`,
    experts: [],
    state: "done",
    round: 1,
    tokens: 0,
    calls: 0,
    created: 1,
    updated,
    ...extra,
});

const ids = (list: Council[]) => list.map((x) => x.id);

describe("spliceCouncil", () => {
    // what council.List answers for /p: newest save first
    const list = [c("a", "/p", 30), c("b", "/p", 20), c("d", "/p", 10)];

    it("moves a council that was saved to the top, never keeping its old slot", () => {
        expect(ids(spliceCouncil(list, c("d", "/p", 40, { round: 2 }), "/p"))).toEqual(["d", "a", "b"]);
        expect(spliceCouncil(list, c("d", "/p", 40, { round: 2 }), "/p")[0].round).toBe(2);
    });

    it("keeps a council in the middle when its save is still older than the one above", () => {
        expect(ids(spliceCouncil(list, c("d", "/p", 25), "/p"))).toEqual(["a", "d", "b"]);
    });

    it("lands a new council by its updated time, at either end too", () => {
        expect(ids(spliceCouncil(list, c("n", "/p", 25), "/p"))).toEqual(["a", "n", "b", "d"]);
        expect(ids(spliceCouncil(list, c("n", "/p", 99), "/p"))).toEqual(["n", "a", "b", "d"]);
        expect(ids(spliceCouncil(list, c("n", "/p", 1), "/p"))).toEqual(["a", "b", "d", "n"]);
        expect(ids(spliceCouncil([], c("n", "/p", 1), "/p"))).toEqual(["n"]);
    });

    it("orders a tie on updated by id, ascending", () => {
        const tie = [c("b", "/p", 20), c("d", "/p", 20)];
        expect(ids(spliceCouncil(tie, c("a", "/p", 20), "/p"))).toEqual(["a", "b", "d"]);
        expect(ids(spliceCouncil(tie, c("c", "/p", 20), "/p"))).toEqual(["b", "c", "d"]);
        expect(ids(spliceCouncil(tie, c("e", "/p", 20), "/p"))).toEqual(["b", "d", "e"]);
        // a council that stays tied with its neighbour keeps the place its id gives
        expect(ids(spliceCouncil(tie, c("d", "/p", 20, { round: 2 }), "/p"))).toEqual(["b", "d"]);
    });

    it("drops a council that moved to another project from this project's list", () => {
        expect(ids(spliceCouncil(list, c("b", "/q", 50), "/p"))).toEqual(["a", "d"]);
    });

    it("adds a council that moved into this project", () => {
        expect(ids(spliceCouncil(list, c("m", "/p", 50), "/p"))).toEqual(["m", "a", "b", "d"]);
    });

    it("reads two spellings of one project path as one project", () => {
        const win = [c("a", "D:\\code\\a", 30)];
        expect(ids(spliceCouncil(win, c("n", "d:/code/a/", 40), "D:\\code\\a"))).toEqual(["n", "a"]);
    });

    it("never adds a bench council, and removes one already listed", () => {
        expect(ids(spliceCouncil(list, c("n", "/p", 50, { bench: true }), "/p"))).toEqual(["a", "b", "d"]);
        expect(ids(spliceCouncil(list, c("b", "/p", 50, { bench: true }), "/p"))).toEqual(["a", "d"]);
        expect(ids(spliceCouncil(list, c("n", "/p", 50, { bench: true }), ""))).toEqual(["a", "b", "d"]);
    });

    it("holds every non-bench council in the empty project's list, whatever its project", () => {
        const all = [c("a", "/p", 30), c("x", "/q", 25)];
        expect(ids(spliceCouncil(all, c("y", "/r", 27), ""))).toEqual(["a", "y", "x"]);
        expect(ids(spliceCouncil(all, c("x", "/q", 40), ""))).toEqual(["x", "a"]);
    });

    it("answers the very list it was given when nothing in it changes", () => {
        expect(spliceCouncil(list, c("z", "/q", 50), "/p")).toBe(list);
        expect(spliceCouncil(list, c("z", "/p", 50, { bench: true }), "/p")).toBe(list);
    });

    it("leaves the list it was given as it was", () => {
        const before = ids(list);
        spliceCouncil(list, c("d", "/p", 40), "/p");
        expect(ids(list)).toEqual(before);
    });
});
