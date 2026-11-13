// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ramReading, rowCols, sameRamReading } from "./rowcols";
import { DEFAULT_ROW_FIELDS } from "./rowfields";

const MB = 1024 * 1024;

describe("ramReading", () => {
    it("words the figure as the Resource Manager does, plain under a GB", () => {
        expect(ramReading(412 * MB)).toEqual({ label: "412 MB", warn: false });
        expect(ramReading(999 * MB)).toEqual({ label: "999 MB", warn: false });
    });

    it("warns from the first figure that reads in GB", () => {
        expect(ramReading(1000 * MB)).toEqual({ label: "1.0 GB", warn: true });
        expect(ramReading(1.6 * 1024 * MB)).toEqual({ label: "1.6 GB", warn: true });
    });

    it("has nothing for no figure", () => {
        expect(ramReading(null)).toBeNull();
    });
});

describe("sameRamReading", () => {
    it("matches readings that say the same", () => {
        expect(sameRamReading(ramReading(412 * MB), ramReading(412 * MB + 10))).toBe(true);
        expect(sameRamReading(null, null)).toBe(true);
        expect(sameRamReading(ramReading(412 * MB), ramReading(500 * MB))).toBe(false);
        expect(sameRamReading(ramReading(412 * MB), null)).toBe(false);
    });
});

describe("rowCols", () => {
    it("ends the row with RAM, tokens and age in that order", () => {
        expect(rowCols(DEFAULT_ROW_FIELDS, { ram: ramReading(820 * MB), tokens: 7_900_000, age: "2m" })).toEqual([
            { key: "ram", text: "820 MB", warn: false },
            { key: "tokens", text: "7.9M", warn: false },
            { key: "age", text: "2m", warn: false },
        ]);
    });

    it("keeps an empty cell for a figure the row does not have, so the columns stay put", () => {
        expect(rowCols(DEFAULT_ROW_FIELDS, {})).toEqual([
            { key: "ram", text: "", warn: false },
            { key: "tokens", text: "", warn: false },
            { key: "age", text: "", warn: false },
        ]);
        expect(rowCols(DEFAULT_ROW_FIELDS, { ram: null, tokens: 0, age: "16m" }).map((c) => c.text)).toEqual([
            "",
            "",
            "16m",
        ]);
    });

    it("carries the RAM warning, and only on the RAM cell", () => {
        const cells = rowCols(DEFAULT_ROW_FIELDS, { ram: ramReading(1.6 * 1024 * MB), tokens: 96_300_000, age: "3h" });
        expect(cells.map((c) => [c.key, c.warn])).toEqual([
            ["ram", true],
            ["tokens", false],
            ["age", false],
        ]);
    });

    it("takes a field that is off out of the row, with its column", () => {
        const fields = { ...DEFAULT_ROW_FIELDS, ram: false, age: false };
        expect(rowCols(fields, { ram: ramReading(412 * MB), tokens: 38_000, age: "2m" })).toEqual([
            { key: "tokens", text: "38k", warn: false },
        ]);
        expect(rowCols({ ...fields, tokens: false }, { tokens: 38_000 })).toEqual([]);
    });
});
