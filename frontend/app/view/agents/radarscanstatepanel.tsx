// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { AlertTriangle, Check, CheckCircle2, Loader2, Radar, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { formatTokens } from "./agentsviewmodel";
import {
    COLLECTORS,
    coverageRows,
    failedLenses,
    lensRows,
    type CoverageCell,
    type CoverageRow,
    type RadarScanState,
} from "./radarmodel";
import { cancelScan, retryClustering, startScan } from "./radarstore";
import { SubLabel } from "./sectionlabel";
import { SurfaceEmptyState } from "./surfacescaffold";

const GLYPH = "mb-[18px] h-[30px] w-[30px]";

const STATUS_TEXT: Record<CoverageCell, string> = {
    done: "done",
    running: "running",
    failed: "incomplete",
    queued: "queued",
};

const STATUS_TONE: Record<CoverageCell, string> = {
    done: "text-muted",
    running: "text-accent-soft",
    failed: "text-error",
    queued: "text-muted",
};

function CellGlyph({ cell }: { cell: CoverageCell }) {
    switch (cell) {
        case "done":
            return <Check className="h-[13px] w-[13px] text-success" strokeWidth={2.4} />;
        case "running":
            return (
                <Loader2
                    className="h-[13px] w-[13px] animate-spin text-accent-soft motion-reduce:animate-none"
                    strokeWidth={2.4}
                />
            );
        case "failed":
            return <X className="h-[13px] w-[13px] text-error" strokeWidth={2.4} />;
        default:
            return <span className="ml-[3px] h-[7px] w-[7px] rounded-full border-[1.5px] border-edge-strong" />;
    }
}

function CollectorTable({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-edge-mid bg-edge-faint text-left">
            {children}
        </div>
    );
}

// Before a scan: what each collector will examine.
function CollectorList() {
    return (
        <CollectorTable>
            {COLLECTORS.map((c) => (
                <div
                    key={c.name}
                    className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-3 bg-background px-3.5 py-2"
                >
                    <span className="text-[11.5px] text-ink-hi">{c.name}</span>
                    <span className="text-[12.5px] text-muted">{c.examines}</span>
                </div>
            ))}
        </CollectorTable>
    );
}

// ticks once a second, with seconds past the first minute, so a multi-minute model call visibly moves
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

// During a scan: each collector (or clustering lens) with its streamed status.
function ScanProgress({ title, rows, since }: { title: string; rows: CoverageRow[]; since?: number }) {
    const done = rows.filter((r) => r.cell === "done").length;
    return (
        <CollectorTable>
            <div className="flex items-center gap-2.5 bg-surface px-3.5 py-2">
                <SubLabel className="flex-1">{title}</SubLabel>
                <span className="text-[11px] tabular-nums text-ink-mid">
                    {done} of {rows.length} done
                    {since ? <Elapsed since={since} /> : null}
                </span>
            </div>
            {rows.map((r) => (
                <div
                    key={r.name}
                    className="grid grid-cols-[14px_84px_minmax(0,1fr)_72px] items-center gap-3 bg-background px-3.5 py-2"
                >
                    <CellGlyph cell={r.cell} />
                    <span className={cn("text-[11.5px]", r.cell === "queued" ? "text-muted" : "text-ink-hi")}>
                        {r.name}
                    </span>
                    <span className="truncate text-[12.5px] text-muted">{r.examines}</span>
                    <span
                        className={cn(
                            "text-right text-[10.5px] uppercase tracking-[0.06em]",
                            STATUS_TONE[r.cell]
                        )}
                    >
                        {STATUS_TEXT[r.cell]}
                    </span>
                </div>
            ))}
        </CollectorTable>
    );
}

function FailureFacts({ report }: { report: RadarReport }) {
    const rows = coverageRows(report);
    const kept = rows.filter((r) => r.cell === "done").length;
    const error = report.clustererror || failedLenses(report)[0]?.clustererror || report.fatalerror || "unknown error";
    const payload = report.payloadtokens ? ` · ${formatTokens(report.payloadtokens)}-token payload` : "";
    const fact = (label: string, value: string, tone: string) => (
        <div className="flex items-baseline gap-2.5">
            <span className={cn(REGION_LABEL, "w-16 text-muted")}>{label}</span>
            <span className={cn("text-xs", tone)}>{value}</span>
        </div>
    );
    return (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-edge-mid bg-surface-code px-3.5 py-2.5 text-left">
            {fact("Error", error, "font-mono text-error-soft")}
            {fact("Kept", `${kept} of ${rows.length} collectors${payload}`, "tabular-nums text-ink-mid")}
        </div>
    );
}

export function RadarScanStatePanel({
    state,
    report,
    scopeName,
    scopePath,
}: {
    state: RadarScanState;
    report: RadarReport | null;
    scopeName: string | undefined;
    scopePath: string | undefined;
}) {
    const scan = () => scopePath && fireAndForget(() => startScan(scopePath));
    const cancel = () => report && fireAndForget(() => cancelScan(report.oid));
    const retry = () => report && fireAndForget(() => retryClustering(report.oid));
    const subject = scopeName ?? "This repository";

    switch (state) {
        case "never-scanned":
            return (
                <SurfaceEmptyState
                    glyph={<Radar className={cn(GLYPH, "text-accent-soft")} strokeWidth={1.8} />}
                    title={`${subject} hasn't been scanned`}
                    body="Radar reads the current tree and recent engineering activity, turns it into compact signals, and groups them into evidence-backed findings. Nothing runs until you scan."
                    action={{
                        label: "Scan repository",
                        onClick: scan,
                        disabled: !scopePath,
                        hint: "Local collectors first, then one bounded model call.",
                    }}
                >
                    <CollectorList />
                </SurfaceEmptyState>
            );
        case "collecting":
            return (
                <SurfaceEmptyState
                    title="Collecting signals"
                    body="Local collectors are reading the tree and recent activity. No model budget is spent yet."
                    secondaryAction={{ label: "Cancel scan", onClick: cancel }}
                >
                    <ScanProgress title="Collectors" rows={coverageRows(report)} />
                </SurfaceEmptyState>
            );
        case "clustering": {
            // a scan started by an older backend streams no lens progress; show its collectors instead
            const lenses = lensRows(report);
            return (
                <SurfaceEmptyState
                    title="Clustering findings"
                    body={`Each lens is one bounded model call grouping ${report?.payloadtokens ? `a ${formatTokens(report.payloadtokens)}-token payload of ` : ""}signals into findings, compared with the previous scan. This usually takes a few minutes.`}
                    secondaryAction={{ label: "Cancel scan", onClick: cancel }}
                >
                    {lenses.length ? (
                        <ScanProgress title="Lenses" rows={lenses} since={report?.clusterstartedts} />
                    ) : (
                        <ScanProgress title="Collectors" rows={coverageRows(report)} />
                    )}
                </SurfaceEmptyState>
            );
        }
        case "model-failed":
            // without retained candidates there is nothing to recluster, so only a fresh scan helps
            if (!report?.candidates?.length) {
                return (
                    <SurfaceEmptyState
                        glyph={<AlertTriangle className={cn(GLYPH, "text-error")} strokeWidth={1.8} />}
                        title="The scan failed"
                        body="No signals were kept from this scan, so it has to run again from the start."
                        action={{ label: "Scan again", onClick: scan, disabled: !scopePath }}
                    >
                        {report ? <FailureFacts report={report} /> : null}
                    </SurfaceEmptyState>
                );
            }
            return (
                <SurfaceEmptyState
                    glyph={<AlertTriangle className={cn(GLYPH, "text-error")} strokeWidth={1.8} />}
                    title="Clustering failed. Your signals were kept."
                    body="Retrying reuses this scan's signals and only spends budget on clustering, so nothing is collected again."
                    action={{ label: "Retry clustering", onClick: retry }}
                    secondaryAction={{ label: "Discard and re-scan", onClick: scan }}
                >
                    <FailureFacts report={report} />
                </SurfaceEmptyState>
            );
        case "no-findings":
            return (
                <SurfaceEmptyState
                    glyph={<CheckCircle2 className={cn(GLYPH, "text-success")} strokeWidth={1.8} />}
                    title="Nothing met the evidence bar"
                    body="Radar clustered the collected signals and found no finding worth your attention. This is a snapshot of the current tree, not a guarantee."
                    action={{ label: "Scan again", onClick: scan, disabled: !scopePath }}
                />
            );
        case "cancelled":
            return (
                <SurfaceEmptyState
                    glyph={<XCircle className={cn(GLYPH, "text-muted")} strokeWidth={1.8} />}
                    title="Scan cancelled"
                    body="Signals collected before you cancelled were discarded. Findings from your previous scan are unchanged."
                    action={{ label: "Scan repository", onClick: scan, disabled: !scopePath }}
                />
            );
        default:
            return null;
    }
}
