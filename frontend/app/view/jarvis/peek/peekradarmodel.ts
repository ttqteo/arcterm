// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The radar finding peek, decided: a compact read of what radarfindingdetail.tsx shows, built on its model
// (radarmodel.ts). Pure; peekradar.tsx renders it.

import { evidenceRows, investigationView, type InvestigationTone } from "@/app/view/agents/radarmodel";
import type { PeekFacts } from "../peekstore";

// A report that is gone, or a finding no longer in it, is gone. A radar finding has nothing to focus on.
export function radarPeekFacts(report: RadarReport | null | undefined, findingId?: string): PeekFacts {
    if (report == null) {
        return { gone: true };
    }
    if (findingId != null && !(report.findings ?? []).some((f) => f.id === findingId)) {
        return { gone: true };
    }
    return { gone: false };
}

// place: where the signal points. Findings carry no line numbers, so a signal's first path stands in for the
// mockup's path:line, and a signal with no path (a run, a transcript) shows its source ref.
export type PeekEvidenceRow = { id: string; place: string; summary: string };

export function peekEvidence(finding: RadarFinding, report: RadarReport): PeekEvidenceRow[] {
    return evidenceRows(finding, report).map((s) => {
        const paths = s.paths ?? [];
        const more = paths.length > 1 ? ` +${paths.length - 1}` : "";
        return { id: s.id, place: paths.length > 0 ? paths[0] + more : s.sourceref, summary: s.summary };
    });
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
