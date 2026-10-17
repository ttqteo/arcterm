// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { planReviewReviewers } from "./runtimeline";

describe("planReviewReviewers", () => {
    it("reads each reviewer's verdict off a plan review, in the detail's order", () => {
        const detail = {
            state: "failed",
            round: 1,
            reviewers: [
                { lens: "full", state: "passed", text: "ok" },
                { lens: "spec", state: "failed", text: "Task 3 misses the retry rule" },
                { lens: "order", state: "lost" },
            ],
        };
        expect(planReviewReviewers(detail)).toEqual([
            { lens: "full", state: "passed", text: "ok" },
            { lens: "spec", state: "failed", text: "Task 3 misses the retry rule" },
            { lens: "order", state: "lost", text: "" },
        ]);
    });

    it("parses a detail stored as a JSON string", () => {
        const detail = JSON.stringify({ reviewers: [{ lens: "followup", state: "passed", text: "fixed" }] });
        expect(planReviewReviewers(detail)).toEqual([{ lens: "followup", state: "passed", text: "fixed" }]);
    });

    it("is empty for a review stored before reviewers, and drops malformed entries", () => {
        expect(planReviewReviewers({ state: "passed", round: 1, findings: "ok" })).toEqual([]);
        expect(planReviewReviewers(undefined)).toEqual([]);
        expect(planReviewReviewers("not json")).toEqual([]);
        expect(planReviewReviewers({ reviewers: "full passed" })).toEqual([]);
        const reviewers = [
            null,
            3,
            { lens: 2, state: "passed" },
            { state: "passed" },
            { lens: "spec", state: "passed" },
        ];
        expect(planReviewReviewers({ reviewers })).toEqual([{ lens: "spec", state: "passed", text: "" }]);
    });
});
