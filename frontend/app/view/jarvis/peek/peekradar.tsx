// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as WOS from "@/app/store/wos";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { INVESTIGATION_DOT, INVESTIGATION_TEXT, severityPill } from "@/app/view/agents/radarstyles";
import { cn, fireAndForget } from "@/util/util";
import { useEffect } from "react";
import { REGION_LABEL } from "../briefstyle";
import { openTarget } from "../openref";
import { kindNoun } from "../peekitemmodel";
import { reportPeekFacts, type PeekTarget } from "../peekstore";
import { peekInvestigation, peekSites, radarPeekFacts } from "./peekradarmodel";

const LABEL = cn(REGION_LABEL, "text-muted");

function Header({ title, severity }: { title: string; severity?: string }) {
    return (
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
            <span className={cn(REGION_LABEL, "text-accent-soft")}>{kindNoun("radar")}</span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-primary">{title}</span>
            {severity ? (
                <span
                    className={cn(
                        "flex-none rounded px-[7px] py-px text-[10.5px] font-semibold",
                        severityPill(severity)
                    )}
                >
                    {severity}
                </span>
            ) : null}
        </div>
    );
}

function FindingBody({ model, finding }: { model: AgentsViewModel; finding: RadarFinding }) {
    const sites = peekSites(finding);
    const inv = peekInvestigation(finding);
    // depth 1: a link inside a peek opens in full, never peeks again
    const openRun = (runId: string) => fireAndForget(() => openTarget(model, { kind: "run", runId }));
    return (
        <>
            <Header title={finding.risk} severity={finding.severity} />
            <div className="flex flex-col gap-3.5 px-3.5 py-3">
                {finding.rootcause ? (
                    <div className="flex flex-col gap-1">
                        <span className={LABEL}>Root cause</span>
                        <p className="text-[13px] leading-[1.6] text-secondary">{finding.rootcause}</p>
                    </div>
                ) : null}
                {sites.length > 0 ? (
                    <div
                        data-peek-radar-sites
                        className="flex flex-col overflow-hidden rounded-[9px] border border-border bg-background"
                    >
                        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
                            <span className={cn(REGION_LABEL, "text-ink-mid")}>Sibling sites</span>
                            <span className="h-px flex-1 bg-border" />
                            <span className="flex-none text-[10.5px] tabular-nums text-muted">
                                {sites.length} {sites.length === 1 ? "site" : "sites"}
                            </span>
                        </div>
                        {sites.map((row) => (
                            <div
                                key={row.key}
                                title={row.trigger}
                                className="truncate px-3 py-[7px] text-[11.5px] text-secondary"
                            >
                                {row.place}
                            </div>
                        ))}
                    </div>
                ) : null}
                {inv ? (
                    <div className="flex items-center gap-2.5 rounded-[9px] border border-edge-mid px-3 py-2.5">
                        <span className={LABEL}>Investigation</span>
                        <span
                            className={cn(
                                "h-[7px] w-[7px] flex-none rounded-full",
                                INVESTIGATION_DOT[inv.tone],
                                inv.live && "pulse-dot"
                            )}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">
                            run{" "}
                            {inv.runnable ? (
                                <button
                                    type="button"
                                    onClick={() => openRun(inv.runId)}
                                    className="font-mono text-accent-soft hover:underline"
                                >
                                    {inv.runId}
                                </button>
                            ) : (
                                <span className="font-mono">{inv.runId}</span>
                            )}{" "}
                            · <span className={INVESTIGATION_TEXT[inv.tone]}>{inv.state}</span>
                        </span>
                    </div>
                ) : null}
            </div>
        </>
    );
}

// a report peeked without a finding: there is no one finding to show, so it says which scan it is
function ReportBody({ report }: { report: RadarReport }) {
    const count = (report.findings ?? []).length;
    return (
        <>
            <Header title={report.projectname || report.projectpath} />
            <p className="px-3.5 py-3 text-[12px] text-secondary">
                {count} {count === 1 ? "finding" : "findings"} in this scan
            </p>
        </>
    );
}

export function PeekRadarBody({ model, target }: { model: AgentsViewModel; target: PeekTarget }) {
    const reportId = target.kind === "radar" ? target.reportId : "";
    const findingId = target.kind === "radar" ? target.findingId : undefined;
    // the load pinned the report, so this reads the cache and follows its updates and deletion
    const [report, loading] = WOS.useWaveObjectValue<RadarReport>(WOS.makeORef("radarreport", reportId));
    const facts = loading ? null : radarPeekFacts(report, findingId);
    useEffect(() => {
        if (facts != null) {
            reportPeekFacts(target, facts);
        }
    }, [target, facts?.gone]);
    if (report == null || facts == null || facts.gone) {
        return null;
    }
    const finding = findingId != null ? report.findings?.find((f) => f.id === findingId) : undefined;
    return finding != null ? <FindingBody model={model} finding={finding} /> : <ReportBody report={report} />;
}
