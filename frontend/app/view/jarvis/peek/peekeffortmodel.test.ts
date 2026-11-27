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

// a chunk saved for later is kept on Jarvis, not worked: the peek's bar, its count and its list read the plan alone
describe("effortPeekModel with chunks saved for later", () => {
    const later = (label: string, status: string): EffortChunk => ({ ...chunk(label, status), later: true });
    const withLater = {
        ...EFFORT,
        chunks: [
            later("saved A", "pending"),
            chunk("one", "done", "slice 1"),
            later("saved B", "active"),
            chunk("two", "active", "slice 2"),
            chunk("three", "pending"),
            later("saved C", "done"),
        ],
    } as Effort;
    const m = effortPeekModel(withLater);

    it("draws one segment per plan chunk", () => {
        expect(m.segments).toEqual(["done", "active", "pending"]);
    });

    it("counts the plan's done chunks only", () => {
        expect(m.progress).toBe("1 of 3 chunks done");
        expect(m.doneLine).toBe("1 done · slice 1");
    });

    it("lists the plan's remaining chunks numbered by their place in the plan, never a later one", () => {
        expect(m.remaining.map((c) => [c.n, c.label, c.active])).toEqual([
            [2, "two", true],
            [3, "three", false],
        ]);
    });

    it("has nothing remaining and no bar when every chunk is later", () => {
        const only = effortPeekModel({ ...EFFORT, chunks: [later("saved A", "pending")] } as Effort);
        expect(only).toMatchObject({ segments: [], remaining: [], doneLine: null, progress: "0 of 0 chunks done" });
    });
});

describe("effortPeekFacts", () => {
    it("is gone when the effort is missing", () => {
        expect(effortPeekFacts(undefined)).toEqual({ gone: true });
    });
    it("is present when the effort exists", () => {
        expect(effortPeekFacts(EFFORT)).toEqual({ gone: false });
    });
});
