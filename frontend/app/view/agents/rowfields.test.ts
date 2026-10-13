// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_ROW_FIELDS, rowFieldsOf } from "./rowfields";

describe("rowFieldsOf", () => {
    it("shows every field when nothing is stored", () => {
        expect(rowFieldsOf(undefined)).toEqual(DEFAULT_ROW_FIELDS);
        expect(rowFieldsOf(null)).toEqual(DEFAULT_ROW_FIELDS);
        expect(rowFieldsOf("model")).toEqual(DEFAULT_ROW_FIELDS);
    });

    it("keeps what was turned off and defaults the rest", () => {
        expect(rowFieldsOf({ tokens: false })).toEqual({ model: true, branch: true, tokens: false, age: true });
        expect(rowFieldsOf({ model: false, age: false, branch: true })).toEqual({
            model: false,
            branch: true,
            tokens: true,
            age: false,
        });
    });

    it("ignores values that are not booleans and keys it does not know", () => {
        expect(rowFieldsOf({ model: "no", tokens: 0, cost: false })).toEqual(DEFAULT_ROW_FIELDS);
    });
});
