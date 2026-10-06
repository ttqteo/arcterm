// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "vitest";
import { divergenceText, subjectDecision } from "./focussubject";

test("no local target and a focus: seed from focus", () => {
    expect(subjectDecision(null, "waveterm")).toEqual({ kind: "seed", target: "waveterm" });
});

test("local target equals focus: aligned, so the surface says nothing", () => {
    expect(subjectDecision("waveterm", "waveterm")).toEqual({ kind: "aligned" });
});

test("local target differs from focus: diverged, carrying both labels", () => {
    expect(subjectDecision("wavesrv", "waveterm")).toEqual({ kind: "diverged", focus: "waveterm", local: "wavesrv" });
});

test("no focus at all: aligned, never diverged — Global is not something to rejoin", () => {
    expect(subjectDecision("wavesrv", null)).toEqual({ kind: "aligned" });
    expect(subjectDecision(null, null)).toEqual({ kind: "aligned" });
});

test("an empty-string local target counts as no target, not as a divergence", () => {
    expect(subjectDecision("", "waveterm")).toEqual({ kind: "seed", target: "waveterm" });
});

test("divergenceText names what is shown and the app bar's project", () => {
    expect(divergenceText("cyber_anomaly_detector", "waveterm")).toBe(
        "Showing waveterm · project is cyber_anomaly_detector"
    );
});
