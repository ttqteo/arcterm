// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MOTION } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { Skeleton, SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { AlertTriangle, Check, ChevronDown, RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { DivergenceBanner } from "./divergencebanner";
import { subjectDecision } from "./focussubject";
import { projectListAtom, projectsAtom } from "./projectsstore";
import { RadarFindingDetail, runPrimaryAction } from "./radarfindingdetail";
import { RadarFindingsList } from "./radarfindingslist";
import {
    classifyScanState,
    coverageRows,
    filterByMode,
    isResultsState,
    lensHealthText,
    lensTabs,
    MODE_META,
    primaryAction,
    radarLoadPhase,
    rescanLabel,
    resolveLens,
    resolveSelection,
    scanHealth,
    scanMetaLine,
    type CoverageCell,
    type HealthLine,
    type LensKey,
} from "./radarmodel";
import { RadarScanStatePanel } from "./radarscanstatepanel";
import {
    currentReportAtom,
    currentReportIdAtom,
    initRadarScope,
    initRadarScopeFromNewest,
    lastRadarProjectAtom,
    pickInitialScope,
    radarLensPickAtom,
    radarLoadErrorAtom,
    radarReportsAtom,
    radarScopeAtom,
    radarSelectedIdAtom,
    resolveScope,
    retryClustering,
    retryRadarLoad,
    startScan,
    type RadarScope,
} from "./radarstore";
import { SubLabel } from "./sectionlabel";
import { SurfaceError } from "./surfacescaffold";

const COVERAGE_STATUS: Record<CoverageCell, string> = {
    done: "done",
    failed: "incomplete",
    running: "running",
    queued: "not run",
};

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

function LensTabs({ report, lens, onPick }: { report: RadarReport; lens: LensKey; onPick: (l: LensKey) => void }) {
    const tabs = lensTabs(report);
    if (tabs.length === 0) {
        return null;
    }
    return (
        <div
            role="group"
            aria-label="Lens"
            className="flex items-center gap-0.5 rounded-[9px] border border-edge-mid bg-surface p-0.5"
        >
            {tabs.map((t) => {
                const on = lens === t.key;
                return (
                    <button
                        key={t.key}
                        type="button"
                        aria-pressed={on}
                        disabled={t.disabled}
                        onClick={() => onPick(t.key)}
                        className={cn(
                            "flex items-center gap-[7px] rounded-[7px] px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150 disabled:cursor-default",
                            on
                                ? "bg-surface-selected text-ink-hi"
                                : t.disabled
                                  ? "text-ink-faint"
                                  : "text-muted hover:text-secondary"
                        )}
                    >
                        {t.label}
                        <span
                            className={cn(
                                "text-[10.5px] font-medium tabular-nums",
                                t.failed ? "text-warning" : on ? "text-accent-soft" : "text-muted"
                            )}
                        >
                            {t.failed && t.count === 0 ? "failed" : t.count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

// Collector coverage, collapsed to a count until asked: the full table is detail, the count is the signal.
function CoveragePopover({ report }: { report: RadarReport }) {
    const [open, setOpen] = useState(false);
    const rows = coverageRows(report);
    // a collector absent from coverage never ran (a report older than the collector), which is not a failure
    const ran = rows.filter((r) => r.cell !== "queued");
    const done = ran.filter((r) => r.cell === "done").length;
    return (
        <div className="relative">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-[7px] rounded-[7px] border border-edge-mid bg-surface px-2.5 py-[5px] text-[11.5px] font-semibold text-ink-mid hover:border-edge-strong"
            >
                <span className={cn("h-1.5 w-1.5 rounded-full", done === ran.length ? "bg-success" : "bg-warning")} />
                <span className="font-medium tabular-nums">
                    {done}/{ran.length}
                </span>
                collectors
                <ChevronDown className="h-3 w-3 text-muted" />
            </button>
            {open ? <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} /> : null}
            <PopoverReveal open={open} origin="top right" className={cn(POPOVER, "right-0 w-[400px]")}>
                <SubLabel className="px-2 pb-2 pt-1.5">Last scan coverage</SubLabel>
                {rows.map((r) => (
                    <div
                        key={r.name}
                        className="grid grid-cols-[16px_88px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] px-2 py-[7px]"
                    >
                        {r.cell === "done" ? (
                            <Check className="h-[13px] w-[13px] text-success" strokeWidth={2.4} />
                        ) : r.cell === "queued" ? (
                            <span />
                        ) : (
                            <X className="h-[13px] w-[13px] text-error" strokeWidth={2.4} />
                        )}
                        <span className="text-[11.5px] text-ink-hi">{r.name}</span>
                        <span className="truncate text-xs text-muted">{r.examines}</span>
                        <span
                            className={cn(
                                "text-[10.5px] uppercase tracking-[0.06em]",
                                r.cell === "failed" ? "text-error" : "text-muted"
                            )}
                        >
                            {COVERAGE_STATUS[r.cell]}
                        </span>
                    </div>
                ))}
            </PopoverReveal>
        </div>
    );
}

function HealthLineText({ line }: { line: HealthLine }) {
    switch (line.kind) {
        case "collectors":
            return (
                <span>
                    The{" "}
                    {line.collectors.map((c, i) => (
                        <span key={c}>
                            {i > 0 ? (i === line.collectors.length - 1 ? " and " : ", ") : null}
                            <span className="text-[11.5px] text-ink-hi">{c}</span>
                        </span>
                    ))}{" "}
                    {line.collectors.length === 1 ? "collector" : "collectors"} did not finish. Findings that rely on
                    that evidence may be missing.
                </span>
            );
        case "lens":
            return <span>{lensHealthText(line.modes, line.carried)}</span>;
        default:
            return (
                <span>
                    The repository changed while this scan ran. Evidence may mix the tree before and after the change.
                </span>
            );
    }
}

// One strip for every way a scan can be incomplete, each line with its own fix. No heading: a repository
// change mid-scan is not an incomplete scan, so a shared title would be false for it.
function ScanHealthStrip({ report }: { report: RadarReport }) {
    const lines = scanHealth(report);
    if (lines.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-none items-start gap-[11px] border-t border-edge-faint bg-warning/5 px-[18px] pb-[11px] pt-2.5">
            <AlertTriangle className="mt-px h-[15px] w-[15px] flex-none text-warning" />
            <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                {lines.map((line) => (
                    <div
                        key={line.kind}
                        className={cn(
                            "flex min-h-[22px] items-center gap-3 text-[12.5px]",
                            line.kind === "repository-changed" ? "text-muted" : "text-secondary"
                        )}
                    >
                        <span className="min-w-0 flex-1">
                            <HealthLineText line={line} />
                        </span>
                        {line.kind === "lens" ? (
                            <button
                                type="button"
                                onClick={() => fireAndForget(() => retryClustering(report.oid))}
                                className="flex-none rounded-md border border-warning/40 px-2.5 py-1 text-[11.5px] font-semibold text-warning-soft hover:bg-warning/10"
                            >
                                {line.modes.length === 1 ? `Retry ${MODE_META[line.modes[0]].label}` : "Retry lenses"}
                            </button>
                        ) : null}
                    </div>
                ))}
            </div>
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
    const currentReportId = useAtomValue(currentReportIdAtom);
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

    const state = classifyScanState(report);
    const isResults = isResultsState(state);
    const [lensPick, setLensPick] = useAtom(radarLensPickAtom);
    // a lens that vanished or failed empty after a re-scan falls back to All, so the list is never stuck empty
    const lens = resolveLens(lensTabs(report), lensPick);
    const findings = filterByMode(report?.findings ?? [], lens);
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
                {/* subject bar: which repository, which lens, and how complete its last scan was */}
                <div className="flex-none px-[18px] pt-3.5">
                    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 pb-1.5">
                        <h1 className="flex-none text-[16px] font-bold text-primary">Radar</h1>
                        <ScopeSelector scope={scope} onSelect={selectScope} />
                        {isResults && report ? <LensTabs report={report} lens={lens} onPick={setLensPick} /> : null}
                        <span className="flex-1" />
                        {isResults && report ? <CoveragePopover report={report} /> : null}
                        {isResults && scope ? (
                            <button
                                type="button"
                                onClick={() => fireAndForget(() => startScan(scope.path))}
                                className="flex items-center gap-[7px] rounded-[7px] border border-edge-mid bg-surface-raised px-[11px] py-[5px] text-[11.5px] font-semibold text-secondary hover:border-edge-strong"
                            >
                                <RefreshCw className="h-3 w-3" />
                                {rescanLabel(state)}
                            </button>
                        ) : null}
                    </div>
                    {isResults && report ? (
                        <div className="pb-[11px] text-[11.5px] tabular-nums text-muted">
                            {scanMetaLine(report, Date.now())}
                        </div>
                    ) : (
                        <div className="pb-2" />
                    )}
                </div>

                <div className="min-h-0 flex-1">
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
                        ) : phase === "error" ? null : isResults && report ? (
                            <motion.div
                                key="results"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                className="flex h-full flex-col"
                            >
                                <ScanHealthStrip report={report} />
                                <div className="flex min-h-0 flex-1 border-t border-edge-faint">
                                    <RadarFindingsList
                                        reportId={report.oid}
                                        findings={findings}
                                        selectedId={effectiveSelected}
                                        onSelect={setSelectedId}
                                        onActivate={selectedFinding ? activate : undefined}
                                        activateLabel={
                                            selectedFinding
                                                ? primaryAction(selectedFinding).label.toLowerCase()
                                                : undefined
                                        }
                                    />
                                    {selectedFinding ? (
                                        <RadarFindingDetail model={model} report={report} finding={selectedFinding} />
                                    ) : (
                                        <div className="flex flex-1 items-center justify-center text-muted-foreground">
                                            Select a finding
                                        </div>
                                    )}
                                </div>
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
                                    state={state}
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
            <div className="flex w-[360px] shrink-0 flex-col gap-2.5 border-r border-edge-faint p-3.5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <SkeletonLine key={i} className="h-[46px] w-full rounded-[9px]" />
                ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-6">
                <SkeletonLine className="h-[20px] w-[55%]" />
                <SkeletonLine className="h-[11px] w-[80%]" />
                <SkeletonLine className="h-[11px] w-[70%]" />
                <Skeleton className="mt-2 h-[120px] w-full rounded-[10px]" />
            </div>
        </div>
    );
}
