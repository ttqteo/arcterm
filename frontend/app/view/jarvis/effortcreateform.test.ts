// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { followUpOps, parseChunkLines } from "./effortcreateform";

describe("parseChunkLines", () => {
    it("splits lines and defaults unchecked", () => {
        expect(parseChunkLines("Phase 1\nPhase 2 — N1 WAF\n")).toEqual([
            { label: "Phase 1", stage: "", checked: false },
            { label: "Phase 2 — N1 WAF", stage: "", checked: false },
        ]);
    });
    it("drops blank lines and trims", () => {
        expect(parseChunkLines("  \nP1  \n\n  P2")).toEqual([
            { label: "P1", stage: "", checked: false },
            { label: "P2", stage: "", checked: false },
        ]);
    });
});

describe("parseChunkLines stages", () => {
    it("splits on the first colon-space", () => {
        expect(parseChunkLines("Phase 1: WAF scan\nPhase 1: Rule diff: prod\nloose")).toEqual([
            { label: "WAF scan", stage: "Phase 1", checked: false },
            { label: "Rule diff: prod", stage: "Phase 1", checked: false },
            { label: "loose", stage: "", checked: false },
        ]);
    });
    it("keeps a trailing colon or a colon with no space as part of the label", () => {
        expect(parseChunkLines("Note:\nhttp://x")).toEqual([
            { label: "Note:", stage: "", checked: false },
            { label: "http://x", stage: "", checked: false },
        ]);
    });
});

describe("followUpOps", () => {
    it("sends a stage and a done tick against the chunk's label", () => {
        const lines = parseChunkLines("A: first\nsecond").map((l, i) => ({ ...l, checked: i === 1 }));
        expect(followUpOps(lines)).toEqual([
            { op: "setChunkStage", chunk: "first", stage: "A" },
            { op: "setChunkStatus", chunk: "second", status: "done" },
        ]);
    });

    it("sends an all-digit label as its position, which is how the server reads it", () => {
        const lines = parseChunkLines("Phase: 3\n1\n2").map((l, i) => ({ ...l, checked: i >= 1 }));
        expect(followUpOps(lines)).toEqual([
            { op: "setChunkStage", chunk: "1", stage: "Phase" },
            { op: "setChunkStatus", chunk: "2", status: "done" },
            { op: "setChunkStatus", chunk: "3", status: "done" },
        ]);
    });

    it("has nothing to send for plain pending, unstaged chunks", () => {
        expect(followUpOps(parseChunkLines("one\ntwo"))).toEqual([]);
    });
});
