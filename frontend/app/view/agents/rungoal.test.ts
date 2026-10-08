// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { splitGoal } from "./rungoal";

describe("splitGoal", () => {
    it("is all lead for a one-line goal", () => {
        expect(splitGoal("design the agy harness")).toEqual({ lead: "design the agy harness", rest: "" });
    });
    it("keeps a paragraph's inner line breaks in the lead", () => {
        expect(splitGoal("line one\nline two")).toEqual({ lead: "line one\nline two", rest: "" });
    });
    it("splits the first paragraph from the rest", () => {
        expect(splitGoal("Title\n\nfirst para\n\nsecond para")).toEqual({
            lead: "Title",
            rest: "first para\n\nsecond para",
        });
    });
    it("treats a whitespace-only line as a paragraph break", () => {
        expect(splitGoal("Title\n   \nmore")).toEqual({ lead: "Title", rest: "more" });
    });
    it("leaves the rest verbatim, a code block's blank lines included", () => {
        expect(splitGoal("Title\n\n```\na\n\n  b\n```")).toEqual({ lead: "Title", rest: "```\na\n\n  b\n```" });
    });
    it("ignores blank lines around the goal", () => {
        expect(splitGoal("\n\nTitle\n\nmore\n\n")).toEqual({ lead: "Title", rest: "more" });
    });
    it("is empty for an empty goal", () => {
        expect(splitGoal("")).toEqual({ lead: "", rest: "" });
    });
});
