// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    appendInStageAt,
    canRemove,
    chunkRef,
    moveTarget,
    stageMoveTarget,
    stageRunLabels,
    stageRuns,
    stepChunk,
} from "./trackeredit";

const c = (label: string, stage = "") => ({ label, stage });
// runs: 0 = A[a,b], 1 = B[c], 2 = A[d]  (the same name can head two runs)
const plan = [c("a", "A"), c("b", "A"), c("c", "B"), c("d", "A")];

describe("stageRuns", () => {
    it("splits consecutive stages into position-keyed runs", () => {
        expect(stageRuns(plan)).toEqual([
            { at: 0, stage: "A", start: 0, end: 2 },
            { at: 1, stage: "B", start: 2, end: 3 },
            { at: 2, stage: "A", start: 3, end: 4 },
        ]);
    });
});

describe("moveTarget", () => {
    it("moves within the run", () => {
        expect(moveTarget(plan, "a", "down")).toBe(2);
        expect(moveTarget(plan, "b", "up")).toBe(1);
    });
    it("stops at the run's edges", () => {
        expect(moveTarget(plan, "a", "up")).toBeNull();
        expect(moveTarget(plan, "b", "down")).toBeNull();
        expect(moveTarget(plan, "c", "up")).toBeNull();
    });
    it("is null for an unknown label", () => {
        expect(moveTarget(plan, "zz", "up")).toBeNull();
    });
});

describe("stageMoveTarget", () => {
    it("lands after the first run of the target stage", () => {
        // without c: [a,b,d] -> first A run is a,b -> insert at index 2 -> at 3
        expect(stageMoveTarget(plan, "c", "A")).toBe(3);
    });
    it("lands at the end for a stage with no run", () => {
        expect(stageMoveTarget(plan, "a", "")).toBe(4);
    });
    it("is null when the chunk is already in that stage", () => {
        expect(stageMoveTarget(plan, "a", "A")).toBeNull();
    });
});

describe("stageRunLabels / appendInStageAt", () => {
    it("names only the run at that position", () => {
        expect(stageRunLabels(plan, 0)).toEqual(["a", "b"]);
        expect(stageRunLabels(plan, 2)).toEqual(["d"]);
        expect(stageRunLabels(plan, 9)).toEqual([]);
    });
    it("inserts after the run's last chunk", () => {
        expect(appendInStageAt(plan, 0)).toBe(3);
        expect(appendInStageAt(plan, 2)).toBe(5);
    });
});

describe("canRemove", () => {
    it("refuses a removal that would empty the plan", () => {
        expect(canRemove(plan, ["a", "b", "c", "d"])).toBe(false);
        expect(canRemove(plan, ["a", "b", "c"])).toBe(true);
    });
    it("counts duplicates once", () => {
        expect(canRemove([c("a"), c("b")], ["a", "a"])).toBe(true);
    });
});

describe("chunkRef", () => {
    it("passes a normal label through", () => {
        expect(chunkRef(plan, "b")).toBe("b");
    });
    it("sends an all-digit label as an exact label, never a position the server could read as another chunk", () => {
        const odd = [c("2"), c("x")];
        expect(chunkRef(odd, "2")).toBe("=2");
        // a label no longer in the list still goes by label, so the server refuses it instead of picking position 7
        expect(chunkRef(odd, "7")).toBe("=7");
        expect(chunkRef(odd, "=x")).toBe("==x");
    });
});

describe("stepChunk", () => {
    it("steps across runs and reports the run to open", () => {
        expect(stepChunk(plan, "b", "next")).toEqual({ label: "c", runAt: 1 });
        expect(stepChunk(plan, "c", "prev")).toEqual({ label: "b", runAt: 0 });
    });
    it("is null past either end", () => {
        expect(stepChunk(plan, "a", "prev")).toBeNull();
        expect(stepChunk(plan, "d", "next")).toBeNull();
    });
});
