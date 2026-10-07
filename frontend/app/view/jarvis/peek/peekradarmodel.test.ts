// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { peekInvestigation, peekSites, radarPeekFacts } from "./peekradarmodel";

function finding(id: string, extra: Partial<RadarFinding> = {}): RadarFinding {
    return {
        id,
        fingerprint: `fp-${id}`,
        group: "new",
        riskkind: "",
        subsystem: "",
        risk: "risk",
        why: "why",
        severity: "high",
        signalids: [],
        files: [],
        mission: "",
        ...extra,
    };
}

function report(findings: RadarFinding[]): RadarReport {
    return { oid: "rr-1", findings } as unknown as RadarReport;
}

describe("radarPeekFacts", () => {
    it("is gone when the report is missing", () => {
        expect(radarPeekFacts(undefined, "f-1")).toEqual({ gone: true });
        expect(radarPeekFacts(null)).toEqual({ gone: true });
    });

    it("is gone when the finding is absent from its report", () => {
        expect(radarPeekFacts(report([finding("f-2")]), "f-1")).toEqual({ gone: true });
    });

    it("is present when the finding is in its report", () => {
        expect(radarPeekFacts(report([finding("f-1")]), "f-1")).toEqual({ gone: false });
    });

    it("a report peeked without a finding is present while the report is", () => {
        expect(radarPeekFacts(report([]))).toEqual({ gone: false });
    });
});

describe("peekSites", () => {
    const site = (line: number, trigger: string): RadarSite => ({
        line,
        trigger,
        actual: "",
        expected: "",
        whynotcovered: "",
    });

    it("gives one file:line row per site with its trigger", () => {
        const f = finding("f-1", { files: ["pkg/x.go"], sites: [site(10, "a"), site(42, "b")] });
        expect(peekSites(f)).toEqual([
            { key: "0:10", place: "pkg/x.go:10", trigger: "a" },
            { key: "1:42", place: "pkg/x.go:42", trigger: "b" },
        ]);
    });

    it("keeps keys unique for two sites on the same line", () => {
        const f = finding("f-1", { files: ["pkg/x.go"], sites: [site(7, "a"), site(7, "b")] });
        const keys = peekSites(f).map((r) => r.key);
        expect(new Set(keys).size).toBe(2);
    });

    it("is empty with no sites or no file", () => {
        expect(peekSites(finding("f-1", { files: ["pkg/x.go"] }))).toEqual([]);
        expect(peekSites(finding("f-1", { sites: [site(1, "a")] }))).toEqual([]);
    });
});

describe("peekInvestigation", () => {
    const inv = (status: string): RadarInvestigation => ({ runid: "run-9", channelid: "c1", status, startedts: 1 });

    it("is absent for a finding never investigated", () => {
        expect(peekInvestigation(finding("f-1"))).toBeNull();
    });

    it("names the run and its state when there is one", () => {
        expect(peekInvestigation(finding("f-1", { investigation: inv("executing") }))).toEqual({
            runId: "run-9",
            state: "investigating",
            tone: "live",
            live: true,
            runnable: true,
        });
        expect(peekInvestigation(finding("f-1", { investigation: inv("done") }))).toMatchObject({
            runId: "run-9",
            state: "still detected",
            runnable: true,
        });
    });

    it("does not offer a run an orphaned investigation no longer has", () => {
        expect(peekInvestigation(finding("f-1", { investigation: inv("orphaned") }))).toMatchObject({
            state: "run gone",
            runnable: false,
        });
    });
});
