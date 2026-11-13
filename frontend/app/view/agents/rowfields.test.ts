// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { AGENT_TREE_NARROW_PX, AGENT_TREE_WIDE_PX, agentTreeWidth, DEFAULT_ROW_FIELDS, rowFieldsOf, type RowFields } from "./rowfields";

describe("agentTreeWidth", () => {
    it("widens the tree only while all three number columns are on", () => {
        expect(agentTreeWidth(DEFAULT_ROW_FIELDS)).toBe(AGENT_TREE_WIDE_PX);
        const namesOff: RowFields = { ...DEFAULT_ROW_FIELDS, model: false, branch: false };
        expect(agentTreeWidth(namesOff)).toBe(AGENT_TREE_WIDE_PX);
    });

    it("keeps the tree narrow once any number column is off", () => {
        expect(agentTreeWidth({ ...DEFAULT_ROW_FIELDS, ram: false })).toBe(AGENT_TREE_NARROW_PX);
        expect(agentTreeWidth({ ...DEFAULT_ROW_FIELDS, tokens: false })).toBe(AGENT_TREE_NARROW_PX);
        expect(agentTreeWidth({ ...DEFAULT_ROW_FIELDS, age: false })).toBe(AGENT_TREE_NARROW_PX);
        expect(agentTreeWidth({ ram: false, tokens: false, age: false })).toBe(AGENT_TREE_NARROW_PX);
    });
});

describe("rowFieldsOf", () => {
    it("shows every field when nothing is stored", () => {
        expect(rowFieldsOf(undefined)).toEqual(DEFAULT_ROW_FIELDS);
        expect(rowFieldsOf(null)).toEqual(DEFAULT_ROW_FIELDS);
        expect(rowFieldsOf("model")).toEqual(DEFAULT_ROW_FIELDS);
    });

    it("keeps what was turned off and defaults the rest", () => {
        expect(rowFieldsOf({ tokens: false })).toEqual({
            model: true,
            branch: true,
            ram: true,
            tokens: false,
            age: true,
        });
        expect(rowFieldsOf({ model: false, age: false, branch: true, ram: false })).toEqual({
            model: false,
            branch: true,
            ram: false,
            tokens: true,
            age: false,
        });
    });

    it("ignores values that are not booleans and keys it does not know", () => {
        expect(rowFieldsOf({ model: "no", tokens: 0, cost: false })).toEqual(DEFAULT_ROW_FIELDS);
    });
});
