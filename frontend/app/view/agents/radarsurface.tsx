// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MOTION } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { Skeleton, SkeletonLine, SkeletonRows } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { DivergenceBanner } from "./divergencebanner";
import { subjectDecision } from "./focussubject";
import { projectListAtom, projectsAtom } from "./projectsstore";
import { RadarAuditList } from "./radarauditlist";
import { RadarFindingDetail, runPrimaryAction } from "./radarfindingdetail";
import { RadarFindingsList } from "./radarfindingslist";
import {
    auditRows,
    auditSummary,
    auditTally,
    auditTallyText,
    failedAuditShas,
    failedAuditsSentence,
    plural,
    primaryAction,
    radarLoadPhase,
    radarView,
    reportMetaAge,
    resolveSelection,
    type RadarView,
} from "./radarmodel";
import { RadarScanStatePanel } from "./radarscanstatepanel";
import {
    currentReportAtom,
    initRadarScope,
    initRadarScopeFromNewest,
    lastRadarProjectAtom,
    pickInitialScope,
    radarLoadErrorAtom,
    radarReportsAtom,
    radarScopeAtom,
    radarSelectedIdAtom,
    resolveScope,
    retryFailedAudits,
    retryRadarLoad,
    shownReportIdAtom,
    startScan,
    type RadarScope,
} from "./radarstore";
import { SurfaceError } from "./surfacescaffold";

const POPOVER =
    "absolute top-[calc(100%+6px)] z-[60] box-border flex flex-col rounded-xl border border-edge-strong bg-surface-raised p-1.5 shadow-popover";

// Scan-scope selector: the Radar surface owns its scanned repo, initialized from the cockpit's global
// project but explicitly selectable here so the surface is self-contained. Reuses the project registry —
// no second path validator.
function ScopeSelector({ scope, onSelect }: { scope: RadarScope | null; onSelect: (s: RadarScope) => void }) {
    const entries = useAtomValue(projectListAtom);
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            <button
                type="button"
                aria-label={scope ? `Scanned project: ${scope.name}` : "Select a project to scan"}
                onClick={() => setOpen((v) => !v)}
                className="flex w-[210px] items-center gap-2 rounded-[9px] border border-edge-mid bg-surface px-[11px] py-1.5 text-left hover:border-edge-strong"
            >
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-hi">
                    {scope?.name ?? "Select project"}
                </span>
                <span className="text-[10.5px] text-muted">project</span>
                <ChevronDown className="h-3 w-3 text-muted" />
            </button>
            {open ? <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} /> : null}
            <PopoverReveal open={open} origin="top left" className={cn(POPOVER, "left-0 w-[240px]")}>
                {entries.length === 0 ? (
                    <div className="px-2 py-3 text-center text-xs text-muted">No registered projects.</div>
                ) : (
                    entries.map(({ name, path }) => (
                        <button
                            key={name}
                            type="button"
                            onClick={() => {
                                onSelect({ name, path });
                                setOpen(false);
                            }}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-surface-hover",
                                scope?.name === name && "bg-surface-selected"
                            )}
                        >
                            <span className="truncate text-secondary">{name}</span>
                        </button>
                    ))
                )}
            </PopoverReveal>
        </div>
    );
}

// The line under the subject bar. With findings on screen the audit summary opens the audited-commit list,
// which is otherwise the body itself.
function MetaLine({ report, view }: { report: RadarReport; view: RadarView }) {
    const [open, setOpen] = useState(false);
    const rows = auditRows(report);
    const tally = auditTally(rows);
    const summary = auditSummary(tally);
    return (
        <div className="relative flex items-center gap-[7px] pb-[11px] text-[11.5px] tabular-nums text-muted">
            <span>{reportMetaAge(report, Date.now())} ·</span>
            {view === "report" && rows.length > 0 ? (
                <button
                    type="button"
                    data-radar-audits-toggle
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-[5px] text-secondary"
                >
                    {summary}
                    <ChevronDown className="h-3 w-3 text-muted" />
                </button>
            ) : (
                <span>{summary}</span>
            )}
            <span>· {plural(report.findings?.length ?? 0, "finding")}</span>
            {open ? <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} /> : null}
            <PopoverReveal open={open} origin="top left" className={cn(POPOVER, "left-0 top-[22px] w-[660px]")}>
                <div data-radar-audits-popover className="font-sans">
                    <RadarAuditList
                        rows={rows}
                        title="Audited in the last scan"
                        tally={auditTallyText(tally)}
                        framed={false}
                    />
                </div>
            </PopoverReveal>
        </div>
    );
}

// A failed audit read nothing, so its commit's sibling bugs are unknown rather than absent.
function FailedAuditsStrip({ report }: { report: RadarReport }) {
    const shas = failedAuditShas(report);
    if (shas.length === 0) {
        return null;
    }
    return (
        <div
            data-radar-health-strip
            className="flex flex-none items-center gap-[11px] border-t border-edge-faint bg-warning/5 px-[18px] pb-[11px] pt-2.5"
        >
            <AlertTriangle className="h-[15px] w-[15px] flex-none text-warning" />
            <span className="min-w-0 flex-1 text-[12.5px] text-secondary">
                {failedAuditsSentence(shas).map((part, i) =>
                    part.sha ? (
                        <span key={i} className="font-mono text-[11.5px] text-ink-hi">
                            {part.text}
                        </span>
                    ) : (
                        part.text
                    )
                )}
            </span>
            <button
                type="button"
                data-radar-retry-audits
                onClick={() => fireAndForget(() => retryFailedAudits(report.oid))}
                className="flex-none rounded-md border border-warning/40 px-2.5 py-1 text-[11.5px] font-semibold text-warning-soft hover:bg-warning/10"
            >
                Retry failed audits
            </button>
        </div>
    );
}

export function RadarSurface({ model }: { model: AgentsViewModel }) {
    const filter = useAtomValue(model.projectFilterAtom);
    const projects = useAtomValue(projectsAtom);
    const scope = useAtomValue(radarScopeAtom);
    const report = useAtomValue(currentReportAtom);
    const [selectedId, setSelectedId] = useAtom(radarSelectedIdAtom);
    const reports = useAtomValue(radarReportsAtom);
    const currentReportId = useAtomValue(shownReportIdAtom);
    const loadError = useAtomValue(radarLoadErrorAtom);
    const persisted = useAtomValue(lastRadarProjectAtom);
    const scopeBlocked = pickInitialScope(scope, persisted, filter, projects).action === "wait";
    const phase = radarLoadPhase({ reports, currentReportId, report, loadError, scopeBlocked });

    // Initialize the owned scope from the persisted pick (falling back to the cockpit's global project
    // selection); after that the header selector owns it. An already-owned scope is kept as-is so a
    // remount — RadarSurface unmounts on every navigation away — never re-derives and wipes the scan.
    const initialized = useRef(false);
    useEffect(() => {
        if (initialized.current) {
            return;
        }
        const decision = pickInitialScope(
            globalStore.get(radarScopeAtom),
            globalStore.get(lastRadarProjectAtom),
            filter,
            projects
        );
        if (decision.action === "wait") {
            return; // desired project not resolvable yet — wait for the registry
        }
        initialized.current = true;
        if (decision.action === "keep") {
            return;
        }
        if (decision.scope != null) {
            fireAndForget(() => initRadarScope(decision.scope));
            return;
        }
        // No persisted/filter project to scope to: prefer landing on the most-recently-scanned project so
        // the surface opens on real findings, falling back to the empty picker only when nothing was scanned.
        fireAndForget(initRadarScopeFromNewest);
    }, [filter, projects]);

    const selectScope = (s: RadarScope) => {
        initialized.current = true;
        fireAndForget(() => initRadarScope(s));
    };

    // Radar declares "subject" project posture: it seeds once (the initialized ref above, which exists so
    // a remount never wipes an in-progress scan) and then owns its scope. The guard's silence is what let
    // it drift from the app bar unremarked; this says so, and offers the one click back. Compared by
    // registry NAME, not path — that is the identity the app-bar filter carries, and it is what the
    // banner shows the user.
    const focusScope = resolveScope(filter, projects);
    const decision = subjectDecision(scope?.name ?? null, focusScope?.name ?? null);
    const rejoin = () => {
        if (focusScope != null) {
            selectScope(focusScope);
        }
    };

    // DEV-ONLY: expose the scenario driver so CDP can render each scan state without a live scan.
    useEffect(() => {
        if (import.meta.env.DEV) {
            void import("./radardevmock").then((m) => {
                (window as any).__setRadarScenario = m.setRadarScenario;
            });
        }
    }, []);

    const view = radarView(report);
    // the report views carry the meta line and the failed-audit strip; an old-format report has neither
    const isReport = view === "report" || view === "audits";
    const findings = report?.findings ?? [];
    const effectiveSelected = resolveSelection(findings, selectedId);
    const selectedFinding = findings.find((f) => f.id === effectiveSelected);

    // list-nav Enter fires the selected finding's primary action, the same as its accent button
    const activate = useCallback(() => {
        if (report && selectedFinding) {
            runPrimaryAction(model, report, selectedFinding);
        }
    }, [report, selectedFinding, model]);

    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-full w-full flex-col bg-background">
                {/* Above the subject bar, as on Diff: a divergence is worth saying whether or not this
                    project has ever been scanned. */}
                <DivergenceBanner decision={decision} onRejoin={rejoin} />
                {loadError != null ? (
                    <SurfaceError message={loadError} onRetry={() => fireAndForget(retryRadarLoad)} />
                ) : null}
                {/* subject bar: which repository, and what its last scan audited */}
                <div className="flex-none px-[18px] pt-3.5">
                    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 pb-1.5">
                        <h1 className="flex-none text-[16px] font-bold text-primary">Radar</h1>
                        <ScopeSelector scope={scope} onSelect={selectScope} />
                        <span className="flex-1" />
                        {(isReport || view === "old-format") && scope ? (
                            <button
                                type="button"
                                data-radar-rescan
                                onClick={() => fireAndForget(() => startScan(scope.path))}
                                className="flex items-center gap-[7px] rounded-[7px] border border-edge-mid bg-surface-raised px-[11px] py-[5px] text-[11.5px] font-semibold text-secondary hover:border-edge-strong"
                            >
                                <RefreshCw className="h-3 w-3" />
                                Re-scan
                            </button>
                        ) : null}
                    </div>
                    {isReport && report ? <MetaLine report={report} view={view} /> : <div className="pb-2" />}
                </div>

                {phase === "ready" && isReport && report ? <FailedAuditsStrip report={report} /> : null}
                <div data-radar-view={phase === "ready" ? view : undefined} className="min-h-0 flex-1">
                    <AnimatePresence mode="wait" initial={false}>
                        {phase === "loading" ? (
                            <motion.div
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                className="h-full"
                            >
                                <RadarBodySkeleton />
                            </motion.div>
                        ) : phase === "error" ? null : view === "report" && report ? (
                            <motion.div
                                key="results"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                className="flex h-full border-t border-edge-faint"
                            >
                                <RadarFindingsList
                                    reportId={report.oid}
                                    findings={findings}
                                    selectedId={effectiveSelected}
                                    onSelect={setSelectedId}
                                    onActivate={selectedFinding ? activate : undefined}
                                    activateLabel={
                                        selectedFinding ? primaryAction(selectedFinding).label.toLowerCase() : undefined
                                    }
                                />
                                {selectedFinding ? (
                                    <RadarFindingDetail model={model} report={report} finding={selectedFinding} />
                                ) : (
                                    <div className="flex flex-1 items-center justify-center text-muted-foreground">
                                        Select a finding
                                    </div>
                                )}
                            </motion.div>
                        ) : (
                            <motion.div
                                key="panel"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                className="h-full border-t border-edge-faint"
                            >
                                <RadarScanStatePanel
                                    view={view}
                                    report={report}
                                    scopeName={scope?.name}
                                    scopePath={scope?.path}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </MotionConfig>
    );
}

// the findings list beside the detail pane, so results land where the skeleton was
function RadarBodySkeleton() {
    return (
        <div aria-hidden="true" className="flex h-full border-t border-edge-faint">
            <SkeletonRows className="w-[360px] shrink-0 space-y-2.5 border-r border-edge-faint p-3.5">
                {(i) => <SkeletonLine key={i} className="h-[46px] w-full rounded-[9px]" />}
            </SkeletonRows>
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-6">
                <SkeletonLine className="h-[20px] w-[55%]" />
                <SkeletonLine className="h-[11px] w-[80%]" />
                <SkeletonLine className="h-[11px] w-[70%]" />
                <Skeleton className="mt-2 min-h-0 w-full flex-1 rounded-[10px]" />
            </div>
        </div>
    );
}
