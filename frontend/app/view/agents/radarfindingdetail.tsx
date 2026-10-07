// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { openInCode } from "@/app/view/code/codestore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo } from "./agentsviewmodel";
import { ambientRefForFinding } from "./ambient";
import { AmbientTags, RelevantDecisions } from "./ambientviews";
import {
    dismissReasons,
    dispositionLabel,
    findingSite,
    investigationView,
    isNewFinding,
    listGroupMeta,
    listGroupOf,
    primaryAction,
    sourceFix,
    subsystemLabel,
    toPendingRunDraft,
    type DismissReason,
} from "./radarmodel";
import { setDisposition } from "./radarstore";
import { INVESTIGATION_DOT, INVESTIGATION_TEXT, LIST_TONE_DOT, LIST_TONE_TEXT, severityPill } from "./radarstyles";
import { pendingRunDraftAtom } from "./runactions";

// The finding's one accent action, shared with list-nav Enter: open the live run (a Ctrl+click peeks it), or
// hand the finding to the Run composer.
export function runPrimaryAction(
    model: AgentsViewModel,
    report: RadarReport,
    finding: RadarFinding,
    event?: React.MouseEvent
): void {
    const inv = finding.investigation;
    if (primaryAction(finding).kind === "open-run" && inv) {
        fireAndForget(() => openOrPeek(model, { kind: "run", runId: inv.runid }, event));
        return;
    }
    globalStore.set(pendingRunDraftAtom, toPendingRunDraft(report, finding));
    globalStore.set(model.surfaceAtom, "jarvis");
}

const LABEL = cn(REGION_LABEL, "text-muted");

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function investigationDetail(inv: RadarInvestigation, now: number): string {
    switch (inv.status) {
        case "executing":
            return `${inv.runid} · started ${formatAgo(now - inv.startedts)}`;
        case "done": {
            const fail = inv.verifsfail ? ` · ${inv.verifsfail} fail` : "";
            return `${plural(inv.filestouched ?? 0, "file")}  +${inv.addtotal ?? 0} −${inv.deltotal ?? 0}  ${inv.verifspass ?? 0} pass${fail}`;
        }
        case "orphaned":
            return inv.runid;
        default:
            return inv.completedts ? `${inv.runid} · ended ${formatAgo(now - inv.completedts)}` : inv.runid;
    }
}

function DismissMenu({ finding, onPick }: { finding: RadarFinding; onPick: (entry: DismissReason) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-edge-mid bg-surface-raised px-3 py-[7px] text-[13px] font-semibold text-secondary hover:border-edge-strong"
            >
                Dismiss
                <ChevronDown className="h-3 w-3 text-muted" />
            </button>
            {open ? <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} /> : null}
            <PopoverReveal open={open} origin="top left" className="absolute left-0 top-[calc(100%+6px)] z-[60]">
                <div
                    data-radar-dismiss-menu
                    className="flex w-[280px] flex-col gap-px rounded-xl border border-edge-strong bg-surface-raised p-1.5 shadow-popover"
                >
                    <div className={cn(LABEL, "px-2 py-1.5")}>Dismiss because</div>
                    {dismissReasons(finding).map((r) => (
                        <button
                            key={r.reason}
                            type="button"
                            data-radar-dismiss-reason={r.reason}
                            onClick={() => {
                                setOpen(false);
                                onPick(r);
                            }}
                            className="rounded-[7px] px-2 py-[7px] text-left text-[12.5px] text-ink-hi hover:bg-surface-hover"
                        >
                            {r.label}
                            {r.run ? <span className="ml-1 font-mono text-[11.5px] text-ink-mid">{r.run}</span> : null}
                        </button>
                    ))}
                    <div className="mt-1 border-t border-edge-mid px-2 pb-1 pt-[7px] text-[11.5px] leading-[1.45] text-muted">
                        Closes this finding. Its fix commit is audited once, so it stays closed until you reopen it from
                        Dismissed.
                    </div>
                </div>
            </PopoverReveal>
        </div>
    );
}

function SiteCard({ site }: { site: RadarSite }) {
    return (
        <div
            data-radar-site-card
            className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-edge-mid bg-edge-faint"
        >
            <div className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-3 bg-background px-3.5 py-[9px]">
                <span className="text-xs tabular-nums text-ink-hi">line {site.line}</span>
                <span className="text-[13.5px] font-semibold leading-normal text-primary">{site.trigger}</span>
            </div>
            <div className="grid grid-cols-2 gap-px">
                <div className="flex min-w-0 flex-col gap-[5px] bg-background px-3.5 pb-2.5 pt-[9px]">
                    <span className={cn(REGION_LABEL, "text-error")}>Actual</span>
                    <span className="text-[13px] leading-normal text-secondary">{site.actual}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-[5px] bg-background px-3.5 pb-2.5 pt-[9px]">
                    <span className={cn(REGION_LABEL, "text-success")}>Expected</span>
                    <span className="text-[13px] leading-normal text-secondary">{site.expected}</span>
                </div>
            </div>
            <div className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-3 bg-background px-3.5 pb-[9px] pt-2">
                <span className={LABEL}>Fix gap</span>
                <span className="text-[12.5px] leading-normal text-ink-mid">{site.whynotcovered}</span>
            </div>
        </div>
    );
}

export function RadarFindingDetail({
    model,
    report,
    finding,
}: {
    model: AgentsViewModel;
    report: RadarReport;
    finding: RadarFinding;
}) {
    const meta = listGroupMeta(listGroupOf(finding), []);
    const site = findingSite(finding);
    const sites = finding.sites ?? [];
    const fix = sourceFix(finding, report);
    const inv = finding.investigation;
    const iv = investigationView(finding);
    const disposition = finding.disposition;
    const now = Date.now();

    const dispose = (action: string, reason?: string, note?: string) =>
        fireAndForget(() => setDisposition(report.oid, finding.id, action, reason, note));
    const openRun = (e: React.MouseEvent) =>
        inv && fireAndForget(() => openOrPeek(model, { kind: "run", runId: inv.runid }, e));

    return (
        <div
            data-radar-finding-detail={finding.id}
            data-radar-report={report.oid}
            className="@container min-w-0 flex-1 overflow-y-auto"
        >
            {/* @container, not a media query: the list column eats window width, so only the pane's own
                width says whether a side column fits */}
            <div className="flex max-w-[880px] flex-col gap-[22px] px-[34px] pb-10 pt-[22px] @min-[1300px]:max-w-[1440px]">
                <div className="flex flex-col gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <span className={cn(REGION_LABEL, "flex items-center gap-1.5", LIST_TONE_TEXT[meta.tone])}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", LIST_TONE_DOT[meta.tone])} />
                            {meta.label}
                        </span>
                        {isNewFinding(finding) ? (
                            <span
                                data-radar-new
                                className="rounded bg-accent/10 px-[7px] py-px text-[10.5px] font-semibold text-accent-soft"
                            >
                                new in the latest scan
                            </span>
                        ) : null}
                        <span
                            className={cn(
                                "rounded px-[7px] py-px text-[10.5px] font-bold uppercase tracking-[0.06em]",
                                severityPill(finding.severity)
                            )}
                        >
                            {finding.severity} severity
                        </span>
                        {subsystemLabel(finding.subsystem) ? (
                            <span className="text-[11.5px] text-ink-mid">{finding.subsystem}</span>
                        ) : null}
                        <AmbientTags {...ambientRefForFinding(finding)} />
                    </div>
                    {site ? (
                        <button
                            type="button"
                            data-radar-site-link
                            aria-label="Open the sibling site in Code"
                            onClick={() =>
                                fireAndForget(() =>
                                    openInCode(model, {
                                        projectPath: report.projectpath,
                                        rel: site.path,
                                        line: site.line,
                                    })
                                )
                            }
                            className="flex items-center gap-2 self-start text-left text-[13px] text-accent-soft hover:text-accent"
                        >
                            {site.path}:{site.line}
                            <ArrowRight className="h-[13px] w-[13px] flex-none" />
                        </button>
                    ) : null}
                    <h2 className="text-[21px] font-bold leading-[1.32] tracking-[-0.01em] text-pretty text-primary">
                        {finding.risk}
                    </h2>
                </div>

                {inv && iv ? (
                    <div className="flex flex-col gap-2 rounded-[10px] border border-edge-mid bg-surface-raised px-3.5 py-2.5">
                        <div className="flex items-center gap-3">
                            <span
                                className={cn(
                                    "h-[7px] w-[7px] flex-none rounded-full",
                                    INVESTIGATION_DOT[iv.tone],
                                    iv.live && "pulse-dot"
                                )}
                            />
                            <span className={cn("text-[12.5px] font-semibold", INVESTIGATION_TEXT[iv.tone])}>
                                {iv.label}
                            </span>
                            <span className="min-w-0 truncate whitespace-pre text-[11.5px] tabular-nums text-ink-mid">
                                {investigationDetail(inv, now)}
                            </span>
                            <span className="flex-1" />
                            {iv.openable ? (
                                <button
                                    type="button"
                                    data-peek
                                    onClick={openRun}
                                    className="flex flex-none items-center gap-1.5 rounded-md border border-edge-mid px-2.5 py-1 text-[11.5px] font-semibold text-secondary hover:border-edge-strong"
                                >
                                    Open run <span className="font-mono font-medium text-muted">{inv.runid}</span>
                                </button>
                            ) : null}
                        </div>
                        {inv.summary ? (
                            <p className="text-xs leading-relaxed text-muted-foreground">{inv.summary}</p>
                        ) : null}
                    </div>
                ) : null}

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        data-peek={primaryAction(finding).kind === "open-run" ? "" : undefined}
                        onClick={(e) => runPrimaryAction(model, report, finding, e)}
                        className="flex items-center gap-[7px] rounded-lg bg-accent px-3.5 py-[7px] text-[13px] font-bold text-background hover:bg-accenthover"
                    >
                        {primaryAction(finding).label}
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                    {disposition ? (
                        <>
                            <span title={disposition.note} className="px-1 text-[12.5px] text-muted">
                                {dispositionLabel(disposition)}
                            </span>
                            <button
                                type="button"
                                onClick={() => dispose("reopen")}
                                className="rounded-lg border border-edge-mid bg-surface-raised px-3 py-[7px] text-[13px] font-semibold text-secondary hover:border-edge-strong"
                            >
                                Reopen finding
                            </button>
                        </>
                    ) : (
                        <DismissMenu finding={finding} onPick={(r) => dispose(r.action, r.reason, r.note)} />
                    )}
                    <span className="flex-1" />
                    <span className="font-mono text-[11px] text-muted">{finding.fingerprint}</span>
                </div>

                <div className="flex flex-col gap-[22px] @min-[1300px]:flex-row @min-[1300px]:items-start @min-[1300px]:gap-8">
                    <div className="flex min-w-0 flex-1 flex-col gap-[22px]">
                        {sites.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-baseline gap-2.5">
                                    <h3 className={LABEL}>{sites.length > 1 ? "Sibling sites" : "Sibling site"}</h3>
                                    <span className="text-[11px] text-muted">{site?.file}</span>
                                </div>
                                {sites.map((s, i) => (
                                    <SiteCard key={i} site={s} />
                                ))}
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-2">
                            <h3 className={LABEL}>Root cause</h3>
                            <p className="max-w-[72ch] text-[13.5px] leading-[1.65] text-pretty text-muted-foreground">
                                {finding.rootcause}
                            </p>
                        </div>

                        <RelevantDecisions {...ambientRefForFinding(finding)} />
                    </div>

                    <aside className="flex flex-col gap-[22px] @min-[1300px]:sticky @min-[1300px]:top-6 @min-[1300px]:w-[340px] @min-[1300px]:flex-none">
                        {fix ? (
                            <div data-radar-source-fix className="flex flex-col gap-2">
                                <h3 className={LABEL}>Found by auditing this fix</h3>
                                <div className="flex items-baseline gap-3 rounded-[10px] border border-edge-mid bg-surface px-3.5 py-2.5">
                                    <span className="flex-none font-mono text-xs text-ink-hi">{fix.sha}</span>
                                    <span className="min-w-0 flex-1 text-[13px] leading-[1.45] text-secondary">
                                        {fix.subject}
                                    </span>
                                    {fix.ts ? (
                                        <span className="flex-none text-[11px] tabular-nums text-muted">
                                            {formatDate(fix.ts)}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}

                        <p className="text-[11.5px] leading-normal text-muted">
                            Radar never edits files, runs tests or launches agents on its own. Starting an investigation
                            is the only action that opens a Run.
                        </p>
                    </aside>
                </div>
            </div>
        </div>
    );
}
