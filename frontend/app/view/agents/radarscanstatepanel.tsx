// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { AlertTriangle, CheckCircle2, Radar, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { RadarAuditList } from "./radarauditlist";
import {
    auditDuration,
    auditRows,
    auditsPanel,
    auditTally,
    plural,
    type AuditTally,
    type RadarView,
} from "./radarmodel";
import { cancelScan, startScan } from "./radarstore";
import { SurfaceEmptyState } from "./surfacescaffold";

const GLYPH = "mb-[18px] h-[30px] w-[30px]";

const AUDIT_ONCE_NOTE = "A commit is audited once. The next scan picks up fix commits made after these.";

// ticks once a second, with seconds past the first minute, so a multi-minute audit visibly moves
function Elapsed({ since }: { since: number }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    const secs = Math.max(0, Math.floor((now - since) / 1000));
    const text = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return <> · {text} elapsed</>;
}

// commit selection (status collecting) has no rows yet, so there is nothing to count
function ScanTally({ tally, since }: { tally: AuditTally; since?: number }) {
    if (tally.total === 0) {
        return <>selecting fix commits</>;
    }
    return (
        <>
            {tally.audited} of {tally.total} audited
            {tally.hits > 0 ? (
                <>
                    {" · "}
                    <span className="text-accent-soft">{plural(tally.hits, "hit")}</span>
                </>
            ) : null}
            {since ? <Elapsed since={since} /> : null}
        </>
    );
}

function ErrorFact({ error }: { error: string }) {
    return (
        <div className="flex items-baseline gap-2.5 rounded-[10px] border border-edge-mid bg-surface-code px-3.5 py-2.5 text-left">
            <span className={cn(REGION_LABEL, "w-16 text-muted")}>Error</span>
            <span className="font-mono text-xs text-error-soft">{error}</span>
        </div>
    );
}

function AuditsPanel({ report }: { report: RadarReport }) {
    const rows = auditRows(report);
    const panel = auditsPanel(auditTally(rows), auditDuration(report));
    return (
        <SurfaceEmptyState
            glyph={
                panel.kind === "failed" ? undefined : (
                    <CheckCircle2 className={cn(GLYPH, "text-success")} strokeWidth={1.8} />
                )
            }
            title={panel.title}
            body={
                panel.kind === "clean"
                    ? "Radar read the code around each fix and found the same bug nowhere else. Most scans end this way."
                    : undefined
            }
        >
            {rows.length > 0 ? <RadarAuditList rows={rows} title="Audited" tally={panel.tally} /> : null}
            {panel.kind === "failed" ? null : (
                <div className="mx-auto mt-[18px] max-w-[420px] text-xs leading-[1.55] text-muted">
                    {AUDIT_ONCE_NOTE}
                </div>
            )}
        </SurfaceEmptyState>
    );
}

export function RadarScanStatePanel({
    view,
    report,
    scopeName,
    scopePath,
}: {
    view: RadarView;
    report: RadarReport | null;
    scopeName: string | undefined;
    scopePath: string | undefined;
}) {
    const scan = () => scopePath && fireAndForget(() => startScan(scopePath));
    const cancel = () => report && fireAndForget(() => cancelScan(report.oid));
    const subject = scopeName ?? "This repository";

    switch (view) {
        case "never-scanned":
            return (
                <SurfaceEmptyState
                    glyph={<Radar className={cn(GLYPH, "text-accent-soft")} strokeWidth={1.8} />}
                    title={`${subject} hasn't been scanned`}
                    body="Radar picks the recent fix commits and runs one read-only session on each, looking for the same bug at sibling sites. Nothing runs until you scan."
                    action={{ label: "Scan repository", onClick: scan, disabled: !scopePath }}
                />
            );
        case "scanning": {
            const rows = auditRows(report);
            return (
                <SurfaceEmptyState
                    title="Auditing fix commits"
                    body="One read-only session per commit reads the code around the fix and looks for the same bug at sibling sites. Three run at a time, about a minute each."
                    secondaryAction={{ label: "Cancel scan", onClick: cancel }}
                >
                    <RadarAuditList
                        rows={rows}
                        title="Fix commits"
                        tally={<ScanTally tally={auditTally(rows)} since={report?.clusterstartedts} />}
                        live
                    />
                </SurfaceEmptyState>
            );
        }
        case "audits":
            return report ? <AuditsPanel report={report} /> : null;
        case "fatal":
            return (
                <SurfaceEmptyState
                    glyph={<AlertTriangle className={cn(GLYPH, "text-error")} strokeWidth={1.8} />}
                    title="The scan failed"
                    action={{ label: "Scan again", onClick: scan, disabled: !scopePath }}
                >
                    <ErrorFact error={report?.fatalerror ?? ""} />
                </SurfaceEmptyState>
            );
        case "cancelled":
            return (
                <SurfaceEmptyState
                    glyph={<XCircle className={cn(GLYPH, "text-muted")} strokeWidth={1.8} />}
                    title="Scan cancelled"
                    body="Audits that finished before you cancelled were discarded."
                    action={{ label: "Scan repository", onClick: scan, disabled: !scopePath }}
                />
            );
        case "old-format":
            return (
                <SurfaceEmptyState
                    title="This report was written by an older Radar"
                    body="It predates the fix-commit audit and cannot be shown. Scan again to replace it."
                    action={{ label: "Re-scan", onClick: scan, disabled: !scopePath }}
                />
            );
        default:
            return null;
    }
}
