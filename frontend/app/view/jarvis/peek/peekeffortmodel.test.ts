// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { effortPeekFacts, effortPeekModel } from "./peekeffortmodel";

const chunk = (label: string, status: string, stage = ""): EffortChunk => ({ label, status, stage, updatedts: 0 });

const EFFORT = {
    otype: "effort",
    oid: "e1",
    version: 1,
    title: "Cockpit Focus and Peek",
    project: "waveterm",
    status: "active",
    notes: [
        { ts: 20, text: "later" },
        { ts: 10, text: "Surfaces agree on a subject." },
    ],
    chunks: [
        chunk("one", "done", "slice 1"),
        chunk("two", "done", "slice 1"),
        chunk("three", "active", "slice 2"),
        chunk("four", "pending"),
        chunk("five", "skipped"),
    ],
    createdts: 0,
    updatedts: 0,
} as Effort;

describe("effortPeekModel", () => {
    const m = effortPeekModel(EFFORT);

    it("counts done chunks, skips shrinking the total", () => {
        expect(m.progress).toBe("2 of 4 chunks done");
        expect(m.doneLine).toBe("2 done · slice 1");
    });

    it("lists the remaining chunks in plan order with the active one marked", () => {
        expect(m.remaining.map((c) => [c.n, c.label, c.active])).toEqual([
            [3, "three", true],
            [4, "four", false],
        ]);
    });

    it("draws one segment per chunk", () => {
        expect(m.segments).toEqual(["done", "done", "active", "pending", "skipped"]);
    });

    it("reads the objective from the first note and omits what is unknown", () => {
        expect(m.objective).toBe("Surfaces agree on a subject.");
        const bare = effortPeekModel({ ...EFFORT, notes: [], project: undefined, chunks: [] } as Effort);
        expect(bare.objective).toBeNull();
        expect(bare.project).toBeNull();
        expect(bare.doneLine).toBeNull();
    });
});

describe("effortPeekFacts", () => {
    it("is gone when the effort is missing", () => {
        expect(effortPeekFacts(undefined)).toEqual({ gone: true });
    });
    it("has no focus when present", () => {
        expect(effortPeekFacts(EFFORT)).toEqual({ gone: false });
    });
});
