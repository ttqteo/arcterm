// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { RunConfig } from "./newrun";
import { launchOptsFromConfig } from "./newrun";

const base: RunConfig = {
    shape: "orchestrator",
    parallelism: 3,
    workerRoute: null,
    start: "goal",
    planPath: "",
    reviewerPicks: false,
    reviewerRoute: null,
    lightReviewerRoute: null,
    autonomous: false,
};
const opus: RoutePin = { runtime: "claude", model: "opus" };

describe("launchOptsFromConfig reviewer fields", () => {
    it("sends Reviewer picks for an orchestrator on picks", () => {
        expect(launchOptsFromConfig({ ...base, reviewerPicks: true })).toEqual({
            mode: "orchestrator",
            parallelism: 3,
            reviewerPicks: true,
            autonomous: false,
        });
    });

    it("sends the reviewer route when one is set", () => {
        expect(launchOptsFromConfig({ ...base, reviewerRoute: opus })).toEqual({
            mode: "orchestrator",
            parallelism: 3,
            reviewerPicks: false,
            reviewerRoute: opus,
            autonomous: false,
        });
    });

    // an unset workers setting reads the profile server-side, so false has to be said out loud to mean
    // Same as lead over a profile that picks
    it("still sends reviewerPicks false with neither set", () => {
        const opts = launchOptsFromConfig(base);
        expect(opts).toEqual({ mode: "orchestrator", parallelism: 3, reviewerPicks: false, autonomous: false });
        expect(opts).not.toHaveProperty("reviewerRoute");
    });

    it("sends neither for a quick launch", () => {
        expect(launchOptsFromConfig({ ...base, shape: "quick", reviewerPicks: true, reviewerRoute: opus })).toEqual({
            mode: "quick",
        });
    });
});

describe("launchOptsFromConfig Light reviewers route", () => {
    const haiku: RoutePin = { runtime: "claude", model: "haiku" };

    it("carries the route when one is set", () => {
        expect(launchOptsFromConfig({ ...base, lightReviewerRoute: haiku }).lightReviewerRoute).toEqual(haiku);
    });

    // unset is the server's claude/sonnet default, so nothing goes out for it
    it("omits it when unset and on a quick launch", () => {
        expect(launchOptsFromConfig(base)).not.toHaveProperty("lightReviewerRoute");
        expect(launchOptsFromConfig({ ...base, shape: "quick", lightReviewerRoute: haiku })).toEqual({ mode: "quick" });
    });
});
