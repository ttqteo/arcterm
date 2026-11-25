// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    CAP_MAX_MILLIONS,
    CAP_MIN_MILLIONS,
    capTokens,
    DEFAULT_CAP_MILLIONS,
    newDraft,
    sheetSides,
    startData,
    swapSides,
} from "./pairsheetmodel";

const picked = {
    worker: { id: "61483cd6-5c1e-4b2a-9d3f-1a2b3c4d5e6f", name: "Plan oracle-tightening" },
    judge: { id: "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6", name: "mit-thesis" },
};

describe("newDraft", () => {
    it("holds heavy commands, takes no note and caps the pair at 3 million tokens", () => {
        expect(newDraft()).toEqual({ swapped: false, hold: true, note: "", cap: "3" });
        expect(DEFAULT_CAP_MILLIONS).toBe(3);
    });
});

describe("swap", () => {
    it("trades who works and who judges, and trades back", () => {
        expect(sheetSides(picked, newDraft())).toEqual(picked);
        const swapped = swapSides(newDraft());
        expect(swapped.swapped).toBe(true);
        expect(sheetSides(picked, swapped)).toEqual({ worker: picked.judge, judge: picked.worker });
        expect(sheetSides(picked, swapSides(swapped))).toEqual(picked);
    });

    it("leaves the box, the note and the cap as they were", () => {
        const draft = { swapped: false, hold: false, note: "read loop.py", cap: "5" };
        expect(swapSides(draft)).toEqual({ ...draft, swapped: true });
    });
});

describe("capTokens", () => {
    it("reads millions: whole, with a decimal point, or with the decimal comma a Vietnamese keyboard types", () => {
        expect(capTokens("3")).toBe(3_000_000);
        expect(capTokens("1.5")).toBe(1_500_000);
        expect(capTokens("1,5")).toBe(1_500_000);
        expect(capTokens("0.5")).toBe(500_000);
        expect(capTokens(" 12 ")).toBe(12_000_000);
        // no float residue: 1.1 * 1e6 is 1100000.0000000002
        expect(capTokens("1.1")).toBe(1_100_000);
    });

    it("keeps to the bounds, ends included", () => {
        expect(capTokens(String(CAP_MIN_MILLIONS))).toBe(CAP_MIN_MILLIONS * 1_000_000);
        expect(capTokens(String(CAP_MAX_MILLIONS))).toBe(CAP_MAX_MILLIONS * 1_000_000);
        expect(capTokens("0.4")).toBeNull();
        expect(capTokens("0")).toBeNull();
        expect(capTokens("100.1")).toBeNull();
        expect(capTokens("1000")).toBeNull();
    });

    it("refuses what is no plain number: empty, text, a sign, an exponent, two points", () => {
        for (const bad of ["", "  ", "abc", "-3", "+3", "1e1", "1.2.3", "3M", ".5", "5."]) {
            expect(capTokens(bad)).toBeNull();
        }
    });
});

describe("startData", () => {
    it("is what PairStart takes: the picked order, the box, the trimmed note and the cap in tokens", () => {
        expect(startData(picked, { swapped: false, hold: true, note: "  read the real code \n", cap: "3" })).toEqual({
            workertab: picked.worker.id,
            judgetab: picked.judge.id,
            holdheavy: true,
            tokencap: 3_000_000,
            note: "read the real code",
            briefed: false,
        });
    });

    it("follows a swap and an unticked box", () => {
        expect(startData(picked, { swapped: true, hold: false, note: "", cap: "2,5" })).toEqual({
            workertab: picked.judge.id,
            judgetab: picked.worker.id,
            holdheavy: false,
            tokencap: 2_500_000,
            note: "",
            briefed: false,
        });
    });

    it("is null while the cap is not valid, so the sheet cannot send it", () => {
        expect(startData(picked, { ...newDraft(), cap: "" })).toBeNull();
        expect(startData(picked, { ...newDraft(), cap: "0" })).toBeNull();
    });
});
