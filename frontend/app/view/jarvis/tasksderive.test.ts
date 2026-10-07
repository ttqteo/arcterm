// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { allowedTransitions, groupDossiers, isTerminalTransition, validateDecisionDraft } from "./tasksderive";

const mk = (id: string, status: string): SpaceSummary => ({
    id,
    objective: id,
    ticket: "",
    status,
    updated: 0,
});

describe("groupDossiers", () => {
    it("groups by Active / Paused / Done and omits empty groups", () => {
        const groups = groupDossiers([mk("a", "active"), mk("p", "paused"), mk("c", "completed"), mk("r", "archived")]);
        expect(groups.map((g) => g.key)).toEqual(["active", "paused", "done"]);
        expect(groups[2].items.map((d) => d.id)).toEqual(["c", "r"]); // completed + archived collapse into Done
    });

    it("omits a group with no members", () => {
        const groups = groupDossiers([mk("a", "active")]);
        expect(groups.map((g) => g.key)).toEqual(["active"]);
    });

    it("returns no groups for an empty list", () => {
        expect(groupDossiers([])).toEqual([]);
    });
});

describe("status transitions", () => {
    it("offers the valid next statuses for active", () => {
        expect(allowedTransitions("active")).toEqual(["paused", "completed", "archived"]);
    });
    it("flags completed/archived as terminal (needs confirm)", () => {
        expect(isTerminalTransition("completed")).toBe(true);
        expect(isTerminalTransition("archived")).toBe(true);
        expect(isTerminalTransition("paused")).toBe(false);
    });
});

describe("validateDecisionDraft", () => {
    it("requires a non-empty rationale", () => {
        expect(validateDecisionDraft("summary", "  ")).toBe("Rationale is required.");
    });
    it("requires a non-empty summary", () => {
        expect(validateDecisionDraft("", "some rationale")).toBe("Summary is required.");
    });
    it("passes a complete draft", () => {
        expect(validateDecisionDraft("chose b", "b needs no migration")).toBeNull();
    });
});
