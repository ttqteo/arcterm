// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Run-completion surface (Wave-run-completion.dc.html): the sealed evidence snapshot + phase history
// shown when a run is done. Renders run.evidence (derived server-side, immutable). Replaces RunBody's
// terminal phase-rail view. Read-only — the run stays done. Changed-file clicks open the in-app Diff
// surface (the change is the evidence); artifact clicks open in the OS editor (a rendered doc/image is
// the artifact).

import { cardVariants } from "@/app/element/motiontokens";
import { getApi } from "@/app/store/global";
import { STAGE_GUTTER, STAGE_SCROLLER } from "@/app/view/jarvis/stagemeasure";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { MotionConfig, motion } from "motion/react";
import { type ReactNode } from "react";
import { diffScopeOfRun, openDiff } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import { channelProjectLabel } from "./projectlabel";
import { projectsAtom } from "./projectsstore";
import {
    artifactKindClass,
    fmtBytes,
    fmtClock,
    fmtDate,
    fmtDuration,
    phaseHistory,
    runShortId,
    statColor,
    verifCmdLabel,
    verifCounts,
    verifTone,
} from "./runcompletion";
import { runTree } from "./runmodel";
import { RunTimeline } from "./runtimelineview";

function openPath(projectPath: string, rel: string) {
    const sep = projectPath.includes("\\") ? "\\" : "/";
    getApi().openExternal(rel.match(/^([/\\]|[a-zA-Z]:)/) ? rel : `${projectPath}${sep}${rel}`);
}

function StatCell({
    label,
    value,
    sub,
    dot,
    valueClass,
}: {
    label: string;
    value: string;
    sub?: string;
    dot?: boolean;
    valueClass?: string;
}) {
    return (
        <div className="border-r border-border px-4 py-3 last:border-r-0">
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[.09em] text-muted">
                {label}
            </div>
            <div className="flex items-center gap-1.5">
                {dot ? <span className="h-[7px] w-[7px] rounded-full bg-success" /> : null}
                <span className={"text-[15px] font-bold " + (valueClass ?? "text-primary")}>{value}</span>
            </div>
            {sub ? <div className="mt-0.5 text-[10.5px] tabular-nums text-muted">{sub}</div> : null}
        </div>
    );
}

function Section({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
    return (
        <div className="border-b border-border px-[18px] py-4">
            <div className="mb-2.5 flex items-center gap-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-[.09em] text-muted">{label}</div>
                <div className="flex-1" />
                {right}
            </div>
            {children}
        </div>
    );
}

export function RunCompletion({ channel, run, model }: { channel: Channel; run: Run; model: AgentsViewModel }) {
    // ahead of the evidence guard: a hook cannot sit behind an early return
    const projects = useAtomValue(projectsAtom);
    const ev = run.evidence;
    if (!ev) {
        return null;
    }
    const counts = verifCounts(ev.verifs ?? []);
    const nodes = phaseHistory(run);
    return (
        <MotionConfig reducedMotion="user">
            <div className={cn(STAGE_SCROLLER, "sc min-h-0 flex-1")}>
                {/* header. The rule stays full-bleed and the content sits in the shared gutter — as its own band
                with px-6 it put the largest text on the Stage 20px left of the record's title, the evidence
                card beneath it and the composer, so switching a record for a run jogged the whole page. */}
                <div className="border-b border-border bg-surface">
                    <div className={cn(STAGE_GUTTER, "flex items-center gap-3 py-[13px]")}>
                        {/* uncapped: the goal here is a single truncated heading line, not prose */}
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[11px] text-muted">
                                <span className="text-ink-mid">{channelProjectLabel(channel, projects)}</span>
                                <span>/</span>
                                <span className="font-mono">run {runShortId(run.id)}</span>
                            </div>
                            <div className="mt-0.5 truncate text-[16px] font-bold tracking-[-.01em] text-primary">
                                {run.goal}
                            </div>
                        </div>
                        <div className="flex-1" />
                        <div className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-[5px]">
                            <span className="text-[12px] text-success">✓</span>
                            <span className="text-[11px] font-bold uppercase tracking-[.02em] text-success">
                                Done
                            </span>
                        </div>
                    </div>
                </div>

                <div className="pb-10 pt-[22px]">
                    <div className={STAGE_GUTTER}>
                        {/* the done run's lifecycle timeline sits above the snapshot: the sealed evidence
                        is the last row of a story this card makes visible */}
                        <RunTimeline channel={channel} run={run} />
                        {/* evidence snapshot card */}
                        <motion.div
                            variants={cardVariants}
                            initial="initial"
                            animate="animate"
                            data-evidence-block
                            className="overflow-hidden rounded-2xl border border-accent/25 bg-surface shadow-popover-soft"
                        >
                            {/* sealed header */}
                            <div className="flex items-center gap-3 border-b border-accent/20 bg-accentbg px-[18px] py-3.5">
                                <span className="text-[13px] text-accent">🔒</span>
                                <span className="text-[10px] font-semibold uppercase tracking-[.11em] text-accent-soft">
                                    Evidence snapshot
                                </span>
                                <span className="rounded-[5px] border border-accent/25 bg-accentbg px-[7px] py-0.5 text-[9px] font-semibold uppercase tracking-[.06em] text-accent-soft">
                                    Immutable
                                </span>
                                <div className="flex-1" />
                                <span className="text-[10.5px] tabular-nums text-muted">
                                    sealed {fmtClock(ev.capturedts)}
                                </span>
                                <span className="text-[10.5px] text-ink-faint">·</span>
                                <span className="font-mono text-[10.5px] text-muted">{ev.hash}</span>
                            </div>

                            {/* stat strip */}
                            <div className="grid grid-cols-4 border-b border-border">
                                <StatCell
                                    label="Status"
                                    value="Done"
                                    valueClass="text-success"
                                    dot
                                    sub="completed cleanly"
                                />
                                <StatCell label="Runtime" value={fmtDuration(ev.runtimems)} sub="active compute" />
                                <StatCell label="Duration" value={fmtDuration(ev.durationms)} sub="wall clock" />
                                <StatCell
                                    label="Completed"
                                    value={fmtClock(ev.capturedts)}
                                    sub={fmtDate(ev.capturedts)}
                                />
                            </div>

                            {/* completion summary */}
                            <Section label="Completion summary">
                                {ev.summary ? (
                                    <div className="min-w-0 flex-1">
                                        <div className="mb-1.5 flex items-center gap-2">
                                            <span className="rounded border border-edge-mid bg-background px-1.5 text-[9px] font-semibold uppercase tracking-[.07em] text-ink-mid">
                                                final response
                                            </span>
                                        </div>
                                        {/* fills the card like the tables around it: this is a snapshot-dashboard section,
                                        not body prose, and the 72ch prose measure left the summary a half-width
                                        column beside empty card */}
                                        <p className="text-[13.5px] leading-[1.62] text-secondary">{ev.summary}</p>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-edge-mid bg-background px-3.5 py-3">
                                        <span className="text-[13px] text-muted">∅</span>
                                        <span className="text-[13px] italic text-ink-mid">
                                            No completion summary was recorded
                                        </span>
                                    </div>
                                )}
                            </Section>

                            {/* files touched */}
                            <Section
                                label="Files touched"
                                right={
                                    <>
                                        <span className="text-[10px] text-ink-faint">
                                            git diff since run baseline
                                        </span>
                                        <span className="text-[11px] font-semibold tabular-nums text-diff-added">
                                            +{ev.addtotal}
                                        </span>
                                        <span className="text-[11px] font-semibold tabular-nums text-diff-removed">
                                            −{ev.deltotal}
                                        </span>
                                    </>
                                }
                            >
                                <div className="flex flex-col gap-0.5">
                                    {(ev.files ?? []).map((f) => (
                                        <button
                                            key={f.path}
                                            onClick={() => openDiff(model, diffScopeOfRun(run), f.path)}
                                            title={`Open ${f.path} in the run diff`}
                                            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-hover"
                                        >
                                            <span
                                                className={
                                                    "w-[15px] text-center text-[11px] font-bold " +
                                                    statColor(f.stat)
                                                }
                                            >
                                                {f.stat}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-secondary">
                                                {f.path}
                                            </span>
                                            <span className="w-[34px] text-right text-[10.5px] font-semibold tabular-nums text-diff-added">
                                                +{f.add}
                                            </span>
                                            <span className="w-[30px] text-right text-[10.5px] font-semibold tabular-nums text-diff-removed">
                                                −{f.del}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </Section>

                            {/* verification */}
                            <Section
                                label="Verification"
                                right={
                                    <>
                                        <span className="text-[10px] font-semibold tabular-nums text-success">
                                            {counts.pass} pass
                                        </span>
                                        <span className="text-[10px] font-semibold tabular-nums text-error">
                                            {counts.fail} fail
                                        </span>
                                        <span className="text-[10px] font-semibold tabular-nums text-warning">
                                            {counts.unknown} unknown
                                        </span>
                                    </>
                                }
                            >
                                <div className="flex flex-col gap-1.5">
                                    {(ev.verifs ?? []).map((v) => {
                                        const tone = verifTone(v.result);
                                        return (
                                            <div
                                                key={v.cmd}
                                                className={
                                                    "flex items-center gap-2.5 rounded-[9px] border bg-background px-2.5 py-2 " +
                                                    tone.borderClass
                                                }
                                            >
                                                <span
                                                    className={
                                                        "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] text-[10px] font-bold " +
                                                        tone.badgeClass
                                                    }
                                                >
                                                    {tone.icon}
                                                </span>
                                                <span
                                                    title={v.cmd}
                                                    className="min-w-0 flex-1 truncate font-mono text-[12px] text-secondary"
                                                >
                                                    {verifCmdLabel(v.cmd)}
                                                </span>
                                                {v.detail ? (
                                                    <span
                                                        title={v.detail}
                                                        className="min-w-0 max-w-[45%] flex-none truncate font-mono text-[10.5px] text-muted"
                                                    >
                                                        {v.detail}
                                                    </span>
                                                ) : null}
                                                <span
                                                    className={
                                                        "text-[9px] font-semibold uppercase tracking-[.06em] " +
                                                        tone.labelClass
                                                    }
                                                >
                                                    {v.result}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {(ev.verifs ?? []).length === 0 ? (
                                        <span className="text-[12px] italic text-ink-mid">
                                            No verification commands recorded
                                        </span>
                                    ) : null}
                                </div>
                            </Section>

                            {/* artifacts */}
                            <Section label="Artifacts produced">
                                <div className="flex flex-wrap gap-2">
                                    {(ev.artifacts ?? []).map((a) => (
                                        <button
                                            key={a.path}
                                            onClick={() => openPath(runTree(run), a.path)}
                                            className="flex items-center gap-2 rounded-[9px] border border-edge-mid bg-background px-3 py-2 hover:border-edge-strong"
                                        >
                                            <span
                                                className={
                                                    "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase " +
                                                    artifactKindClass(a.kind)
                                                }
                                            >
                                                {a.kind}
                                            </span>
                                            <span className="font-mono text-[12px] text-secondary">{a.path}</span>
                                            {a.size ? (
                                                <span className="text-[10px] tabular-nums text-muted">
                                                    {fmtBytes(a.size)}
                                                </span>
                                            ) : null}
                                            <span className="text-[11px] text-ink-faint">↗</span>
                                        </button>
                                    ))}
                                    {(ev.artifacts ?? []).length === 0 ? (
                                        <span className="text-[12px] italic text-ink-mid">No artifacts recorded</span>
                                    ) : null}
                                </div>
                            </Section>

                            {/* diff action */}
                            <div className="flex items-center gap-3 px-[18px] py-3.5">
                                <button
                                    onClick={() => openDiff(model, diffScopeOfRun(run))}
                                    className="flex items-center gap-2.5 rounded-[9px] bg-accent px-4 py-2.5 text-[12.5px] font-bold text-background hover:bg-accent/90"
                                >
                                    <span className="text-[12px]">⑂</span>Open repository diff
                                    <span className="text-[10.5px] tabular-nums text-background/60">
                                        +{ev.addtotal} −{ev.deltotal}
                                    </span>
                                </button>
                                <span className="text-[11.5px] text-muted">
                                    Snapshot is read-only — the run stays done. No approval needed.
                                </span>
                            </div>
                        </motion.div>

                        {/* phase history */}
                        <div className="mx-0.5 mb-3.5 mt-[26px] flex items-center gap-3">
                            <span className="text-[10px] font-semibold uppercase tracking-[.11em] text-muted">
                                Phase history
                            </span>
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-[11px] tabular-nums text-muted">
                                {nodes.length} phases · all complete
                            </span>
                        </div>
                        <motion.div className="pl-0.5" initial="initial" animate="animate">
                            {nodes.map((n, i) => (
                                <motion.div key={i} variants={cardVariants} className="flex gap-[15px]">
                                    <div className="flex w-[38px] flex-none flex-col items-center">
                                        <div
                                            className={
                                                "flex h-[26px] w-[26px] flex-none items-center justify-center border-[1.5px] border-success/50 bg-success/15 text-[11px] font-bold tabular-nums text-success " +
                                                (n.isGate || n.isBoundary ? "rounded-lg" : "rounded-full")
                                            }
                                        >
                                            {n.isBoundary ? "↻" : "✓"}
                                        </div>
                                        {n.notLast ? <div className="min-h-[26px] w-0.5 flex-1 bg-success/40" /> : null}
                                    </div>
                                    <div className="min-w-0 flex-1 pb-4">
                                        <div className="flex items-center gap-2.5">
                                            <span className="text-[14px] font-bold text-primary">{n.name}</span>
                                            {n.tag ? (
                                                <span
                                                    className={
                                                        "rounded border px-1.5 py-px text-xxxs font-semibold uppercase tracking-[.07em] " +
                                                        (n.isGate
                                                            ? "border-warning/30 bg-warning/10 text-warning"
                                                            : "border-accent/25 bg-accentbg text-accent-soft")
                                                    }
                                                >
                                                    {n.tag}
                                                </span>
                                            ) : null}
                                            <div className="flex-1" />
                                            <span className="text-[10.5px] tabular-nums text-muted">{n.timeLabel}</span>
                                        </div>
                                        <div className="mt-0.5 font-mono text-[11px] text-muted">{n.detail}</div>
                                        {n.artifacts.map((art) => (
                                            <button
                                                key={art}
                                                onClick={() => openPath(runTree(run), art)}
                                                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-edge-mid bg-background px-2.5 py-1.5 hover:border-edge-strong"
                                            >
                                                <span className="rounded bg-success/15 px-1.5 py-px text-xxxs font-bold text-success">
                                                    OUT
                                                </span>
                                                <span className="font-mono text-[11.5px] text-ink-mid">{art}</span>
                                                <span className="text-[10px] text-ink-faint">↗</span>
                                            </button>
                                        ))}
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    </div>
                </div>
            </div>
        </MotionConfig>
    );
}
