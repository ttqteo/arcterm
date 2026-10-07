// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { knownRunVersions, mergeRunChanges } from "./channelruns";

function run(id: string, createdts: number, version = 1, status = "executing"): Run {
    return { otype: "run", oid: id, id, version, createdts, status, goal: id, meta: {} } as Run;
}

describe("knownRunVersions", () => {
    it("maps each held run to its row version", () => {
        expect(knownRunVersions([run("a", 1, 3), run("b", 2, 7)])).toEqual({ a: 3, b: 7 });
        expect(knownRunVersions([])).toEqual({});
    });
});

describe("mergeRunChanges", () => {
    const a = run("a", 10);
    const b = run("b", 20);
    const c = run("c", 30);

    it("returns the same list when no run changed and membership is the same", () => {
        const current = [a, b, c];
        expect(mergeRunChanges(current, ["c", "a", "b"], [])).toBe(current);
    });

    it("replaces a changed run and keeps the untouched rows as they were", () => {
        const b2 = run("b", 20, 2, "done");
        const next = mergeRunChanges([a, b, c], ["a", "b", "c"], [b2]);
        expect(next.map((r) => r.status)).toEqual(["executing", "done", "executing"]);
        expect(next[0]).toBe(a);
        expect(next[2]).toBe(c);
    });

    it("adds an appended run in createdts order, wherever it falls", () => {
        const late = run("d", 40);
        const backdated = run("e", 15);
        expect(mergeRunChanges([a, b, c], ["a", "b", "c", "d", "e"], [late, backdated]).map((r) => r.id)).toEqual([
            "a",
            "e",
            "b",
            "c",
            "d",
        ]);
    });

    it("drops a run that left the channel", () => {
        expect(mergeRunChanges([a, b, c], ["a", "c"], []).map((r) => r.id)).toEqual(["a", "c"]);
    });

    it("fills an empty list from a first read", () => {
        expect(mergeRunChanges([], ["a", "b"], [a, b])).toEqual([a, b]);
    });

    it("does not invent a run whose row did not come back", () => {
        expect(mergeRunChanges([a], ["a", "gone"], []).map((r) => r.id)).toEqual(["a"]);
    });
});
