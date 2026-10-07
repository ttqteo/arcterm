// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The radar finding peek, decided: a compact read of what radarfindingdetail.tsx shows, built on its model
// (radarmodel.ts). Pure; peekradar.tsx renders it.

import { findingSite, investigationView, type InvestigationTone } from "@/app/view/agents/radarmodel";
import type { PeekFacts } from "../peekstore";

// A report that is gone, or a finding no longer in it, is gone.
export function radarPeekFacts(report: RadarReport | null | undefined, findingId?: string): PeekFacts {
    if (report == null) {
        return { gone: true };
    }
    if (findingId != null && !(report.findings ?? []).some((f) => f.id === findingId)) {
        return { gone: true };
    }
    return { gone: false };
}

// one row per sibling site; the index in the key keeps two sites on one line apart
export type PeekSiteRow = { key: string; place: string; trigger: string };

export function peekSites(finding: RadarFinding): PeekSiteRow[] {
    const site = findingSite(finding);
    if (site == null) {
        return [];
    }
    return (finding.sites ?? []).map((s, i) => ({
        key: `${i}:${s.line}`,
        place: `${site.path}:${s.line}`,
        trigger: s.trigger,
    }));
}

// runnable: a run exists to open; an orphaned investigation names a run that does not
export type PeekInvestigation = {
    runId: string;
    state: string;
    tone: InvestigationTone;
    live: boolean;
    runnable: boolean;
};

export function peekInvestigation(finding: RadarFinding): PeekInvestigation | null {
    const inv = finding.investigation;
    const view = investigationView(finding);
    if (inv == null || view == null) {
        return null;
    }
    return {
        runId: inv.runid,
        state: view.rowLabel,
        tone: view.tone,
        live: view.live,
        runnable: view.live || view.openable,
    };
}
