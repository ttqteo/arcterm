// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import { buildScenario, RADAR_SCENARIOS, setRadarScenario } from "./radardevmock";
import { auditRows, auditTally, findingSite, isNewFinding, radarView, sourceFix, type RadarView } from "./radarmodel";
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
        scanning: "scanning",
        results: "report",
        partial: "report",
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

    it("results is the Main board: eight audits, two with hits, six findings", () => {
        const r = reportOf("results");
        expect(auditTally(auditRows(r))).toMatchObject({ total: 8, clean: 6, withHits: 2, failed: 0, hits: 3 });
        const findings = r.findings ?? [];
        expect(findings.map((f) => f.group)).toEqual([
            "new",
            "new",
            "recurring",
            "recurring",
            "dismissed",
            "suppressed",
        ]);
        expect(findings.filter(isNewFinding)).toHaveLength(2);
        expect(findings[2].investigation?.status).toBe("executing");
        expect(findings[4].disposition).toMatchObject({ action: "dismiss", reason: "Low priority" });
        expect(findings[5].disposition?.action).toBe("suppress");
        expect(findingSite(findings[0])).toMatchObject({ path: "pkg/reporadar/scan.go", line: 122, more: 1 });
        for (const f of findings) {
            expect(f.files).toHaveLength(1);
            expect(f.rootcause).toBeTruthy();
            // every finding cites a git signal the report carries, which is where its fix date comes from
            expect(sourceFix(f, r)?.ts).toBeGreaterThan(0);
        }
    });

    it("scanning is the Scanning board: three done, three running, two queued", () => {
        const rows = auditRows(reportOf("scanning"));
        expect(rows.map((row) => row.state)).toEqual([
            "hits",
            "clean",
            "clean",
            "running",
            "running",
            "running",
            "queued",
            "queued",
        ]);
        expect(rows[0].hits).toBe(2);
        expect(auditRows(reportOf("selecting"))).toEqual([]);
    });

    it("partial fails two audits of results with a timeout", () => {
        const failed = auditRows(reportOf("partial")).filter((row) => row.state === "failed");
        expect(failed.map((row) => [row.sha, row.detail])).toEqual([
            ["7927fb68", "Timed out after 10 minutes."],
            ["9caee0d3", "Timed out after 10 minutes."],
        ]);
        expect(reportOf("partial").status).toBe("partial");
    });

    it("carried keeps the two recurring findings and no audits", () => {
        const r = reportOf("carried");
        expect(r.audits).toBeUndefined();
        expect((r.findings ?? []).map((f) => f.group)).toEqual(["recurring", "recurring"]);
    });

    it("failed fails every audit, and clean is five clean audits", () => {
        const failed = auditTally(auditRows(reportOf("failed")));
        expect(failed.failed).toBe(failed.total);
        expect(failed.total).toBeGreaterThan(0);
        expect(auditTally(auditRows(reportOf("clean")))).toMatchObject({ total: 5, clean: 5 });
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
