// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import { buildScenario, RADAR_SCENARIOS, setRadarScenario } from "./radardevmock";
import {
    auditGroups,
    auditRows,
    auditSummary,
    auditTally,
    classifyWarning,
    failedAuditLabels,
    findingKind,
    findingSite,
    isNewFinding,
    radarView,
    selectingText,
    sourceFix,
    type RadarView,
} from "./radarmodel";
import { currentReportAtom, radarDevMockAtom, radarScopeAtom, shownReportIdAtom } from "./radarstore";

const reportOf = (name: string, opts?: { projectPath?: string }): RadarReport => {
    const mock = buildScenario(name, opts);
    if (mock == null || mock === "none") {
        throw new Error(`scenario ${name} builds no report`);
    }
    return mock;
};

describe("radar dev scenarios", () => {
    const VIEWS: Record<string, RadarView> = {
        selecting: "scanning",
        classifying: "scanning",
        scanning: "scanning",
        results: "report",
        partial: "report",
        "classify-failed": "report",
        carried: "report",
        failed: "audits",
        clean: "audits",
        "no-commits": "audits",
        fatal: "fatal",
        cancelled: "cancelled",
        "old-format": "old-format",
    };

    it("names every scenario, and each builds the view it is named for", () => {
        expect([...RADAR_SCENARIOS].sort()).toEqual(["never-scanned", "live", ...Object.keys(VIEWS)].sort());
        for (const [name, view] of Object.entries(VIEWS)) {
            expect([name, radarView(reportOf(name))]).toEqual([name, view]);
        }
    });

    it("never-scanned forces no report and live clears the mock", () => {
        expect(buildScenario("never-scanned")).toBe("none");
        expect(buildScenario("live")).toBeNull();
    });

    it("rejects a scenario it does not know", () => {
        expect(() => buildScenario("results-typo")).toThrow(/unknown radar scenario/);
    });

    it("overrides the project path", () => {
        expect(reportOf("results").projectname).toBe("waveterm");
        expect(reportOf("results", { projectPath: "C:/checkout" }).projectpath).toBe("C:/checkout");
    });

    const kindsOf = (r: RadarReport) => auditGroups(auditRows(r)).map((g) => [g.kind, g.rows.length]);
    // the two hot files share one revision, so their rows share a sha and differ by key
    const sharedRevision = (r: RadarReport) => {
        const hot = auditRows(r).filter((row) => row.kind === "hotspot");
        return hot.length === 2 && hot[0].sha === hot[1].sha && hot[0].key !== hot[1].key;
    };

    it("results is the Main board plus the other kinds: twelve audits, four with hits, eight findings", () => {
        const r = reportOf("results");
        expect(auditTally(auditRows(r))).toMatchObject({ total: 12, clean: 8, withHits: 4, failed: 0, hits: 6 });
        expect(auditSummary(auditTally(auditRows(r)))).toBe("12 audits, 8 clean");
        expect(kindsOf(r)).toEqual([
            ["sibling", 8],
            ["introduced", 2],
            ["hotspot", 2],
        ]);
        expect(sharedRevision(r)).toBe(true);
        const findings = r.findings ?? [];
        expect(findings.map((f) => [f.group, findingKind(f)])).toEqual([
            ["new", "sibling"],
            ["new", "sibling"],
            ["recurring", "sibling"],
            ["recurring", "sibling"],
            ["recurring", "introduced"],
            ["recurring", "hotspot"],
            ["dismissed", "sibling"],
            ["suppressed", "sibling"],
        ]);
        expect(findings.filter(isNewFinding)).toHaveLength(2);
        expect(findings[2].investigation?.status).toBe("executing");
        expect(findings[6].disposition).toMatchObject({ action: "dismiss", reason: "Low priority" });
        expect(findings[7].disposition?.action).toBe("suppress");
        expect(findingSite(findings[0])).toMatchObject({ path: "pkg/reporadar/scan.go", line: 122, more: 1 });
        const hot = findings[5];
        expect(hot.fixsubjects?.length).toBeGreaterThanOrEqual(3);
        expect(hot.mission).toContain(`${hot.files[0]} took ${hot.fixsubjects?.length} fix commits`);
        expect(findings[4].mission).toContain("changed behavior: ");
        expect(findings[4].mission).toContain("It introduced a defect still present at:");
        for (const f of findings) {
            expect(f.files).toHaveLength(1);
            expect(f.rootcause).toBeTruthy();
            // every finding cites a git signal the report carries, which is where its fix date comes from
            expect(sourceFix(f, r)?.ts).toBeGreaterThan(0);
        }
    });

    it("scanning is the live scan: each kind auditing one target, the rest queued", () => {
        const r = reportOf("scanning");
        const rows = auditRows(r);
        expect(rows.map((row) => row.state)).toEqual([
            "hits",
            "clean",
            "clean",
            "running",
            "queued",
            "queued",
            "queued",
            "queued",
            "running",
            "queued",
            "running",
            "queued",
        ]);
        expect(rows[0].hits).toBe(2);
        expect(kindsOf(r)).toEqual([
            ["sibling", 8],
            ["introduced", 2],
            ["hotspot", 2],
        ]);
        expect(sharedRevision(r)).toBe(true);
        expect(auditRows(reportOf("selecting"))).toEqual([]);
    });

    it("selecting and classifying draw the scan panel's two phases before any audit", () => {
        expect(selectingText(reportOf("selecting"))).toBe("selecting targets");
        expect(auditRows(reportOf("classifying"))).toEqual([]);
        expect(selectingText(reportOf("classifying"))).toBe("classifying commits");
    });

    it("partial fails two sibling audits and a hot file of results with a timeout", () => {
        const r = reportOf("partial");
        const failed = auditRows(r).filter((row) => row.state === "failed");
        expect(failed.map((row) => [row.label, row.detail])).toEqual([
            ["7927fb68", "Timed out after 10 minutes."],
            ["9caee0d3", "Timed out after 10 minutes."],
            ["pkg/orchestrate/land.go", "Timed out after 10 minutes."],
        ]);
        expect(failedAuditLabels(r)).toContain("pkg/orchestrate/land.go");
        expect(r.status).toBe("partial");
    });

    it("classify-failed is a finished report with findings and the classifier's warning", () => {
        const r = reportOf("classify-failed");
        expect(r.status).toBe("completed");
        expect(r.findings?.length).toBeGreaterThan(0);
        expect(classifyWarning(r)).toBe(
            "Commit classification failed, so 14 unprefixed commits were not considered. Re-scan tries them again."
        );
        expect(classifyWarning(reportOf("results"))).toBeNull();
    });

    it("carried keeps the recurring findings of every kind and no audits", () => {
        const r = reportOf("carried");
        expect(r.audits).toBeUndefined();
        expect((r.findings ?? []).map((f) => [f.group, findingKind(f)])).toEqual([
            ["recurring", "sibling"],
            ["recurring", "sibling"],
            ["recurring", "introduced"],
            ["recurring", "hotspot"],
        ]);
    });

    it("failed fails every audit, and clean is seven clean audits of the three kinds", () => {
        const failed = auditTally(auditRows(reportOf("failed")));
        expect(failed.failed).toBe(failed.total);
        expect(failed.total).toBeGreaterThan(0);
        const clean = reportOf("clean");
        expect(auditTally(auditRows(clean))).toMatchObject({ total: 7, clean: 7 });
        expect(kindsOf(clean)).toEqual([
            ["sibling", 5],
            ["introduced", 1],
            ["hotspot", 1],
        ]);
        expect(reportOf("fatal").fatalerror).toBe("not a readable git repository");
    });
});

describe("setRadarScenario", () => {
    const before = { name: "mine", path: "/mine" };

    beforeEach(() => {
        setRadarScenario("live");
        globalStore.set(radarScopeAtom, before);
    });

    it("scopes Radar to the fixture's project", () => {
        setRadarScenario("results");
        expect(globalStore.get(radarScopeAtom)).toEqual({ name: "waveterm", path: "/repos/waveterm" });
        expect(globalStore.get(shownReportIdAtom)).toBe("dev-report");
        setRadarScenario("clean", { projectPath: "C:/checkout" });
        expect(globalStore.get(radarScopeAtom)).toEqual({ name: "waveterm", path: "C:/checkout" });
    });

    it("never-scanned shows no report on the fixture's project", () => {
        setRadarScenario("never-scanned");
        expect(globalStore.get(radarDevMockAtom)).toBe("none");
        expect(globalStore.get(currentReportAtom)).toBeNull();
        expect(globalStore.get(shownReportIdAtom)).toBeUndefined();
        expect(globalStore.get(radarScopeAtom)?.name).toBe("waveterm");
    });

    it("live after two scenarios restores the scope from before the first", () => {
        setRadarScenario("results");
        setRadarScenario("clean");
        setRadarScenario("live");
        expect(globalStore.get(radarScopeAtom)).toEqual(before);
        expect(globalStore.get(radarDevMockAtom)).toBeNull();
    });

    it("live with no scenario set leaves the scope alone", () => {
        setRadarScenario("live");
        expect(globalStore.get(radarScopeAtom)).toEqual(before);
    });
});
