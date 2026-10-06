// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { peekEvidence, peekInvestigation, radarPeekFacts } from "./peekradarmodel";

function signal(id: string, observedts: number, extra: Partial<RadarSignal> = {}): RadarSignal {
    return {
        id,
        collector: "git",
        sourceref: `commit:${id}`,
        observedts,
        summary: `s ${id}`,
        contenthash: id,
        ...extra,
    };
}

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
        strength: "strong",
        signalids: [],
        files: [],
        mission: "",
        ...extra,
    };
}

function report(findings: RadarFinding[], signals: RadarSignal[] = []): RadarReport {
    return { oid: "rr-1", findings, signals } as unknown as RadarReport;
}

describe("radarPeekFacts", () => {
    it("is gone when the report is missing", () => {
        expect(radarPeekFacts(undefined, "f-1")).toEqual({ gone: true });
        expect(radarPeekFacts(null)).toEqual({ gone: true });
    });

    it("is gone when the finding is absent from its report", () => {
        expect(radarPeekFacts(report([finding("f-2")]), "f-1")).toEqual({ gone: true });
    });

    it("is present, with nothing to focus, when the finding is in its report", () => {
        expect(radarPeekFacts(report([finding("f-1")]), "f-1")).toEqual({ gone: false });
    });

    it("a report peeked without a finding is present while the report is", () => {
        expect(radarPeekFacts(report([]))).toEqual({ gone: false });
    });
});

describe("peekEvidence", () => {
    it("lists the finding's signals oldest first, each with where it points", () => {
        const f = finding("f-1", { signalids: ["b", "a", "missing", "c"] });
        const r = report(
            [f],
            [
                signal("a", 300, { paths: ["pkg/x.go"] }),
                signal("b", 100, { paths: ["frontend/y.ts", "frontend/z.ts", "frontend/w.ts"] }),
                signal("c", 200),
                signal("unreferenced", 50, { paths: ["nope.go"] }),
            ]
        );
        expect(peekEvidence(f, r)).toEqual([
            { id: "b", place: "frontend/y.ts +2", summary: "s b" },
            { id: "c", place: "commit:c", summary: "s c" },
            { id: "a", place: "pkg/x.go", summary: "s a" },
        ]);
    });

    it("is empty for a finding with no linked signals", () => {
        const f = finding("f-1");
        expect(peekEvidence(f, report([f], [signal("a", 1)]))).toEqual([]);
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
