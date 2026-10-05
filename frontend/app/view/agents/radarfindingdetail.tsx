// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { openInCode } from "@/app/view/code/codestore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { ArrowRight, ChevronDown, Target } from "lucide-react";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo } from "./agentsviewmodel";
import { ambientRefForFinding } from "./ambient";
import { AmbientTags, RelevantDecisions } from "./ambientviews";
import { parseUnifiedDiff, type DiffLineKind } from "./gitdiff";
import { StrengthPips } from "./radarfindingslist";
import {
    dismissReasons,
    evidenceRows,
    findingMode,
    findingSignalCount,
    findingSourceCount,
    groupMeta,
    investigationView,
    missedLatestScan,
    MODE_META,
    primaryAction,
    subsystemLabel,
    toPendingRunDraft,
} from "./radarmodel";
import { setDisposition } from "./radarstore";
import { INVESTIGATION_DOT, INVESTIGATION_TEXT, modeBadge, severityPill, TONE_DOT, TONE_TEXT } from "./radarstyles";
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

const DIFF_TONE: Record<DiffLineKind, string> = {
    hunk: "text-accent-soft",
    add: "bg-success/10 text-success",
    del: "bg-error/10 text-error",
    ctx: "text-ink-mid",
};

const LABEL = cn(REGION_LABEL, "text-muted");

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function formatDate(ts: number): string {
    return ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
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

function dispositionText(d: RadarDisposition): string {
    return d.action === "suppress" ? "Pattern suppressed" : `Dismissed: ${(d.reason ?? "no reason").toLowerCase()}`;
}

function Snippet({ snippet }: { snippet: string }) {
    const lines = parseUnifiedDiff(snippet).lines;
    return (
        <div className="overflow-x-auto rounded-lg border border-edge-mid bg-surface-code py-2">
            <div className="flex min-w-max flex-col">
                {lines.map((ln, i) => (
                    <span
                        key={i}
                        className={cn("whitespace-pre px-3 font-mono text-[11.5px] leading-[1.6]", DIFF_TONE[ln.kind])}
                    >
                        {ln.kind === "hunk" ? ln.text : `${ln.sign || " "} ${ln.text}`}
                    </span>
                ))}
            </div>
        </div>
    );
}

function DismissMenu({ finding, onPick }: { finding: RadarFinding; onPick: (reason: string, note?: string) => void }) {
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
            <PopoverReveal
                open={open}
                origin="top left"
                className="absolute left-0 top-[calc(100%+6px)] z-[60] flex w-[280px] flex-col gap-px rounded-xl border border-edge-strong bg-surface-raised p-1.5 shadow-popover"
            >
                <div className={cn(LABEL, "px-2 py-1.5")}>Dismiss because</div>
                {dismissReasons(finding).map((r) => (
                    <button
                        key={r.reason}
                        type="button"
                        onClick={() => {
                            setOpen(false);
                            onPick(r.reason, r.note);
                        }}
                        className="rounded-[7px] px-2 py-[7px] text-left text-[12.5px] text-ink-hi hover:bg-surface-hover"
                    >
                        {r.label}
                        {r.run ? <span className="ml-1 font-mono text-[11.5px] text-ink-mid">{r.run}</span> : null}
                    </button>
                ))}
                <div className="mt-1 border-t border-edge-mid px-2 pb-1 pt-[7px] text-[11.5px] leading-[1.45] text-muted">
                    Closes this finding only. It comes back if new evidence arrives.
                </div>
            </PopoverReveal>
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
    const evidence = evidenceRows(finding, report);
    const meta = groupMeta(finding.group);
    const mode = findingMode(finding);
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
            <div className="flex max-w-[880px] flex-col gap-6 px-[34px] pb-10 pt-[22px] @min-[1300px]:max-w-[1440px]">
                <div className="flex flex-col gap-3.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <span className={cn(REGION_LABEL, "flex items-center gap-1.5", TONE_TEXT[meta.tone])}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[meta.tone])} />
                            {meta.label}
                        </span>
                        {missedLatestScan(finding) ? (
                            <span className="text-[11px] text-muted">not detected in the latest scan</span>
                        ) : null}
                        <span
                            className={cn(
                                "rounded px-[7px] py-px text-[10.5px] font-bold uppercase tracking-[0.06em]",
                                severityPill(finding.severity)
                            )}
                        >
                            {finding.severity} severity
                        </span>
                        {mode !== "correctness" ? (
                            <span
                                className={cn(
                                    "rounded border px-[7px] text-[10.5px] font-bold uppercase tracking-[0.06em]",
                                    modeBadge(mode)
                                )}
                            >
                                {MODE_META[mode].label}
                            </span>
                        ) : null}
                        {subsystemLabel(finding.subsystem) ? (
                            <span className="font-mono text-[11.5px] text-ink-mid">{finding.subsystem}</span>
                        ) : null}
                        <AmbientTags {...ambientRefForFinding(finding)} />
                        <span className="flex-1" />
                        <span className="flex items-center gap-[7px] text-[11.5px] text-muted">
                            <StrengthPips strength={finding.strength} tall />
                            {finding.strength} evidence
                        </span>
                    </div>
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

                {/* actions sit under the title, not after the evidence */}
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
                                {dispositionText(disposition)}
                            </span>
                            <button
                                type="button"
                                onClick={() => dispose(disposition.action === "suppress" ? "unsuppress" : "reopen")}
                                className="rounded-lg border border-edge-mid bg-surface-raised px-3 py-[7px] text-[13px] font-semibold text-secondary hover:border-edge-strong"
                            >
                                {disposition.action === "suppress" ? "Unsuppress pattern" : "Reopen finding"}
                            </button>
                        </>
                    ) : (
                        <>
                            <DismissMenu
                                finding={finding}
                                onPick={(reason, note) => dispose("dismiss", reason, note)}
                            />
                            <button
                                type="button"
                                title="Hide future findings with this fingerprint until materially different evidence appears"
                                onClick={() => dispose("suppress")}
                                className="rounded-lg px-3 py-[7px] text-[13px] font-semibold text-ink-mid hover:text-secondary"
                            >
                                Suppress pattern
                            </button>
                        </>
                    )}
                    <span className="flex-1" />
                    <span className="font-mono text-[11px] text-muted">{finding.fingerprint}</span>
                </div>

                <div className="flex flex-col gap-6 @min-[1300px]:flex-row @min-[1300px]:items-start @min-[1300px]:gap-8">
                    <div className="flex min-w-0 flex-1 flex-col gap-6">
                        <div className="flex flex-col gap-2">
                            <h3 className={LABEL}>Why it matters</h3>
                            <p className="max-w-[72ch] text-[13.5px] leading-[1.65] text-pretty text-muted-foreground">
                                {finding.why}
                            </p>
                        </div>

                        <RelevantDecisions {...ambientRefForFinding(finding)} />

                        {/* radar's own reading, kept apart from the evidence below */}
                        <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-accent/40 bg-surface px-4 pb-3.5 pt-[13px]">
                            <div className="flex items-center gap-2">
                                <Target className="h-[13px] w-[13px] text-accent-soft" />
                                <span className={cn(REGION_LABEL, "text-accent-soft")}>Suggested investigation</span>
                                <span className="flex-1" />
                                <span className="text-[11px] text-muted">Radar's interpretation, not evidence</span>
                            </div>
                            <p className="max-w-[72ch] text-[13.5px] leading-[1.6] text-pretty text-foreground">
                                {finding.mission}
                            </p>
                        </div>

                        {/* one evidence list: timeline order, collector, source ref, and the diff where there is one */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-baseline gap-2.5">
                                <h3 className={LABEL}>Evidence</h3>
                                <span className="text-[11px] tabular-nums text-muted">
                                    {plural(findingSignalCount(finding), "signal")} from{" "}
                                    {plural(findingSourceCount(finding, report), "collector")}
                                </span>
                            </div>
                            {evidence.length > 0 ? (
                                <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-edge-mid bg-edge-faint">
                                    {evidence.map((s) => (
                                        <div key={s.id} className="flex flex-col gap-[9px] bg-background px-3.5 py-2.5">
                                            <div className="grid grid-cols-[52px_92px_minmax(0,1fr)_auto] items-baseline gap-3">
                                                <span className="text-[11px] tabular-nums text-muted">
                                                    {formatDate(s.observedts)}
                                                </span>
                                                <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em] text-ink-mid">
                                                    {s.collector}
                                                </span>
                                                <span className="text-[13px] leading-[1.45] text-secondary">
                                                    {s.summary}
                                                </span>
                                                {/* transcript refs carry a whole session uuid; uncapped, they squeezed the summary into a wrap */}
                                                <span
                                                    title={s.sourceref}
                                                    className="max-w-[220px] truncate font-mono text-[11px] text-muted"
                                                >
                                                    {s.sourceref}
                                                </span>
                                            </div>
                                            {s.snippet ? <Snippet snippet={s.snippet} /> : null}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted">No linked signals.</p>
                            )}
                        </div>
                    </div>

                    <aside className="flex flex-col gap-6 @min-[1300px]:sticky @min-[1300px]:top-6 @min-[1300px]:w-[340px] @min-[1300px]:flex-none">
                        {finding.files.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-baseline gap-2.5">
                                    <h3 className={LABEL}>Affected files</h3>
                                    <span className="text-[11px] tabular-nums text-muted">{finding.files.length}</span>
                                </div>
                                <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-edge-mid bg-edge-faint">
                                    {finding.files.map((f) => (
                                        // findings carry no line numbers, so this lands at the top of the file
                                        <button
                                            key={f}
                                            type="button"
                                            aria-label={`Open ${f} in Code`}
                                            onClick={() =>
                                                fireAndForget(() =>
                                                    openInCode(model, { projectPath: report.projectpath, rel: f })
                                                )
                                            }
                                            className="group flex items-center gap-2.5 bg-background px-3.5 py-[7px] text-left hover:bg-surface-hover"
                                        >
                                            <span
                                                title={f}
                                                className="min-w-0 flex-1 truncate font-mono text-xs text-ink-hi"
                                            >
                                                {f}
                                            </span>
                                            <span className="text-[11px] text-muted group-hover:text-secondary @min-[1300px]:hidden">
                                                open in Code
                                            </span>
                                            <ArrowRight className="h-3 w-3 text-muted" />
                                        </button>
                                    ))}
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
