// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Workflow lens: the newest scan run's state, read from that run's own record and followed
// through WOS, so stages and verdicts show as they land. The model is workflowlens.ts; this file only draws it and
// sends what the owner does. The scan's agent asks which fixes to apply, so the findings here are read-only and the
// button beside them opens that agent (the workflowscan: address, which lands on it).

import { allRunsAtom, loadAllRuns } from "@/app/cockpit/palette-data";
import { useCopyFeedback } from "@/app/element/copyfeedback";
import { CrossFade } from "@/app/element/crossfade";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { diffScopeOfRun, openDiff } from "./agentdiffnav";
import type { AgentsViewModel } from "./agents";
import { errText, useAction } from "./brainstormui";
import { activeChannelAtom, channelsAtom, primeChannels } from "./channelsstore";
import { projectListAtom, recentProjectsAtom, rowsWithChannel } from "./projectsstore";
import { fmtDuration } from "./runcompletion";
import { StatusDot } from "./statusdot";
import { SurfaceHeader } from "./surfacescaffold";
import {
    copyText,
    newestScanRun,
    RUN_FLOOR,
    SCAN_WINDOW_DAYS,
    scanButton,
    scanHead,
    scanHomeChannel,
    workflowView,
    type DoneRow,
    type FiledRow,
    type StageDetail,
    type StageRow,
    type WorkflowCard,
    type WorkflowView,
} from "./workflowlens";
import { followWorkflowScan, startWorkflowScanFromLens, workflowScanRunAtom } from "./workflowscanstart";

// the project the owner picked to scan from (by registered name), module-level so it survives a surface switch
const scanProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

const NO_RUN: Atom<Run | undefined> = atom(undefined as Run | undefined);
const NOT_LOADING: Atom<boolean> = atom(false);

// the same two buttons the canvas and the run sheets draw, from the same tokens
const CANVAS_BTN =
    "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-edge-mid bg-surface-raised px-[12px] py-[6px] text-[12.5px] font-semibold text-primary hover:border-edge-strong hover:bg-surface-hover";
const CANVAS_PRIMARY_BTN =
    "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-accent px-[12px] py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SELECT =
    "h-8 max-w-[240px] cursor-pointer rounded-[8px] border border-edge-mid bg-surface-raised px-2.5 text-[12.5px] font-semibold text-primary hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

const MONO_META = "font-mono text-[11px] text-muted";
const TEXT_LINK =
    "cursor-pointer border-0 bg-transparent p-0 font-mono text-[12px] text-accent-soft hover:text-accenthover hover:underline";
const TAG = "justify-self-start rounded-[4px] px-[7px] py-px font-mono text-[10.5px] font-bold";
const TAG_STYLE: Record<FiledRow["tag"] | DoneRow["tag"], string> = {
    covered: "bg-surface-hover text-success",
    suggested: "bg-surface-hover text-accent-soft",
    declined: "bg-askingbg text-warning",
    under: "bg-surface-hover text-muted",
};
const TAG_LABEL: Record<FiledRow["tag"] | DoneRow["tag"], string> = {
    covered: "covered",
    suggested: "suggested",
    declined: "declined",
    under: `under ${RUN_FLOOR}`,
};

function openRun(model: AgentsViewModel, runId: string) {
    fireAndForget(() => openTarget(model, { kind: "run", runId }));
}

// the scan's own agent while it is up, else the run's sheet (the address route, unchanged by the lens)
function openScan(model: AgentsViewModel, runId: string) {
    fireAndForget(() => openTarget(model, { kind: "workflowscan", runId }));
}

const PANEL = "flex flex-col rounded-[14px] border border-border bg-surface-raised px-[22px]";
const ELAPSED_TICK_MS = 1000;

function Panel({
    label,
    detail,
    children,
    className,
}: {
    label: string;
    detail?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section aria-label={label} data-workflow-detail={detail} className={cn(PANEL, "gap-3 py-5", className)}>
            {children}
        </section>
    );
}

function StageMark({ phase }: { phase: StageRow["phase"] }) {
    if (phase === "done") {
        return <Check size={14} strokeWidth={2.4} aria-label="done" className="text-success" />;
    }
    if (phase === "now") {
        return <StatusDot state="working" pulse />;
    }
    return (
        <span aria-label="to do" className="box-border h-[9px] w-[9px] rounded-full border-[1.5px] border-ink-faint" />
    );
}

const STAGE_LABEL: Record<StageRow["phase"], string> = {
    done: "font-medium text-primary",
    now: "font-semibold text-primary",
    todo: "font-medium text-muted",
};

function StageList({ stages }: { stages: StageRow[] }) {
    return (
        <section aria-label="Stages" className={cn(PANEL, "pb-1.5 pt-5")}>
            {stages.map((s, i) => (
                <div
                    key={s.label}
                    data-workflow-stage={s.label}
                    data-phase={s.phase}
                    className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-3"
                >
                    <div className="flex flex-col items-center self-stretch">
                        <span className="flex h-[18px] w-4 items-center justify-center">
                            <StageMark phase={s.phase} />
                        </span>
                        {i < stages.length - 1 ? (
                            <span
                                className={cn(
                                    "my-1 min-h-[14px] w-px flex-1",
                                    s.phase === "done" ? "bg-edge-strong" : "bg-border"
                                )}
                            />
                        ) : null}
                    </div>
                    <span className={cn("pb-4 text-[13.5px]", STAGE_LABEL[s.phase])}>{s.label}</span>
                    <span data-workflow-stage-fact className="pt-0.5 font-mono text-[11px] text-ink-mid">
                        {s.fact}
                    </span>
                </div>
            ))}
        </section>
    );
}

// the stage column beside what the scan is doing or did; below lg the two stack, stages first
function Split({ stages, children }: { stages: StageRow[]; children: ReactNode }) {
    return (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
            <StageList stages={stages} />
            {children}
        </div>
    );
}

function PaneText({ title, body }: { title: string; body: string }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold text-primary">{title}</span>
            <span className="max-w-[720px] text-[13px] leading-[1.5] text-ink-mid">{body}</span>
        </div>
    );
}

function KeptRows({
    kept,
    underFloor,
}: {
    kept: Extract<StageDetail, { stage: "checking" }>["kept"];
    underFloor: number;
}) {
    return (
        <>
            {kept.length > 0 ? (
                <div className="flex flex-col border-t border-edge-faint">
                    {kept.map((k) => (
                        <div
                            key={k.id}
                            data-workflow-kept={k.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-5 border-b border-edge-faint py-[9px]"
                        >
                            <span className="text-[13px] text-secondary">{k.title}</span>
                            <span className="whitespace-nowrap font-mono text-[11px] text-muted">
                                <b className="text-primary">{k.runs}</b> runs · {k.days} days
                                {k.where ? ` · ${k.where}` : ""}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}
            {underFloor > 0 ? (
                <span className={MONO_META}>
                    {underFloor} under {RUN_FLOOR} runs set aside
                </span>
            ) : null}
        </>
    );
}

function ScanDetail({ detail }: { detail: StageDetail }) {
    switch (detail.stage) {
        case "read":
            return (
                <Panel label="Read runs" detail="read" className="gap-3.5">
                    <PaneText
                        title="Reading run records"
                        body={`Every project's runs from ${detail.from} to ${detail.to}.`}
                    />
                </Panel>
            );
        case "patterns":
            return (
                <Panel label="Sonnet patterns" detail="patterns" className="gap-3.5">
                    <PaneText
                        title={`Sonnet reads ${detail.runs} runs from ${detail.projects} projects`}
                        body={`It names the problems that recur in them. Code then recounts each one against the run records and sets aside any seen in fewer than ${RUN_FLOOR} runs.`}
                    />
                </Panel>
            );
        case "recount":
            return (
                <Panel label="Recount" detail="recount" className="gap-3.5">
                    <PaneText
                        title={`Recounting ${detail.candidates} patterns`}
                        body={`Code counts each one against the run records and sets aside any seen in fewer than ${RUN_FLOOR} runs.`}
                    />
                </Panel>
            );
        case "checking":
            return (
                <Panel label="Opus checks files" detail="checking" className="gap-3.5">
                    <PaneText
                        title={`Opus checks ${detail.kept.length} patterns against the files`}
                        body="The scan's agent reads each pattern's fix target and docs/deferred.md, marks it covered, declined or a suggestion, and drafts the fix. It then asks you which fixes to apply."
                    />
                    <KeptRows kept={detail.kept} underFloor={detail.underFloor} />
                </Panel>
            );
    }
}

// mounts only while scanning, so the interval never outlives that view
function Elapsed({ startedTs }: { startedTs: number }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
        return () => clearInterval(id);
    }, []);
    return <span data-workflow-elapsed>{fmtDuration(now - startedTs)}</span>;
}

const HEAD_STATUS = "flex items-center gap-[7px] font-mono text-[11px]";

function HeadStatus({ view }: { view: Exclude<WorkflowView, { kind: "idle" }> }) {
    switch (view.kind) {
        case "scanning":
            return (
                <span data-workflow-status="scanning" className={cn(HEAD_STATUS, "text-accent-soft")}>
                    <StatusDot state="working" pulse className="h-1.5 w-1.5" />
                    <span>
                        scanning · <Elapsed startedTs={view.startedTs} />
                    </span>
                </span>
            );
        case "picking":
            return (
                <span data-workflow-status="picking" className={cn(HEAD_STATUS, "text-warning")}>
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                    {view.cards.length} to decide, in the scan's agent
                </span>
            );
        case "done":
        case "nothing":
            return (
                <span data-workflow-status={view.kind} className={cn(HEAD_STATUS, "gap-1.5 text-success")}>
                    <Check size={11} strokeWidth={2.4} aria-hidden="true" />
                    done
                </span>
            );
    }
}

function TaggedRows({ rows, attr }: { rows: (FiledRow | DoneRow)[]; attr: string }) {
    return (
        <>
            {rows.map((r, i) => (
                <div
                    key={`${r.tag}:${r.title}:${i}`}
                    {...{ [attr]: r.tag }}
                    className="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-2.5"
                >
                    <span className={cn(TAG, TAG_STYLE[r.tag])}>{TAG_LABEL[r.tag]}</span>
                    <span className="flex flex-col gap-0.5">
                        <span className="text-[13px] text-secondary">{r.title}</span>
                        {"file" in r ? (
                            <span className="font-mono text-[11px] text-accent-soft">{r.file}</span>
                        ) : (
                            <span className={MONO_META}>{r.fact}</span>
                        )}
                    </span>
                </div>
            ))}
        </>
    );
}

function Idle({
    last,
    button,
    onScan,
    busy,
    error,
}: {
    last: Extract<WorkflowView, { kind: "idle" }>["last"];
    button: ReturnType<typeof scanButton>;
    onScan: () => void;
    busy: boolean;
    error: string | null;
}) {
    return (
        <Panel label="Idle" className="min-h-[300px] items-center justify-center">
            <button
                type="button"
                data-workflow-idle-scan
                disabled={!button.enabled || busy}
                title={button.title}
                onClick={onScan}
                className={cn(CANVAS_PRIMARY_BTN, "h-[38px] px-5 text-[14px]")}
            >
                Scan workflow
            </button>
            <span className={MONO_META}>last {SCAN_WINDOW_DAYS} days · every project</span>
            {last != null ? (
                <span data-workflow-last={last.outcome} className="font-mono text-[11px] text-ink-mid">
                    last: {last.date} ·{" "}
                    <span className={last.outcome === "failed" ? "text-error" : "text-warning"}>{last.outcome}</span>
                    {last.error ? <span className="text-error"> · {last.error}</span> : null}
                </span>
            ) : null}
            {error != null ? (
                <span data-workflow-start-error className="text-[12px] text-error">
                    {error}
                </span>
            ) : null}
        </Panel>
    );
}

function Quotes({ model, card }: { model: AgentsViewModel; card: WorkflowCard }) {
    const [open, setOpen] = useState(false);
    const quotes = open ? [...card.quotes, ...card.more] : card.quotes;
    return (
        <div className="flex flex-col gap-[3px]">
            {quotes.map((q) => (
                <div
                    key={q.runid + q.text}
                    className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline text-[13px] leading-[1.5]"
                >
                    <button
                        type="button"
                        data-workflow-quote-run={q.runid}
                        title={`Open run ${q.runid.slice(0, 8)}`}
                        onClick={() => openRun(model, q.runid)}
                        className={cn(TEXT_LINK, "justify-self-start")}
                    >
                        {q.runid.slice(0, 8)}
                    </button>
                    <span className="text-ink-mid">“{q.text}”</span>
                </div>
            ))}
            {card.more.length > 0 ? (
                <button
                    type="button"
                    data-workflow-more
                    aria-expanded={open}
                    onClick={() => setOpen(!open)}
                    className="ml-[76px] cursor-pointer self-start border-0 bg-transparent p-0 font-mono text-[11px] text-muted hover:text-secondary"
                >
                    {open ? "fewer" : `+ ${card.more.length} more`}
                </button>
            ) : null}
        </div>
    );
}

function EditBlock({ card }: { card: WorkflowCard }) {
    return (
        <div className="overflow-hidden rounded-[8px] border border-border bg-surface-code">
            <div className="border-b border-edge-faint px-3 py-1.5 font-mono text-[11px] text-accent-soft">
                {card.where ? `${card.file} · ${card.where}` : card.file}
            </div>
            <div className="py-2 pr-3">
                {card.edit.map((l, i) => (
                    <div
                        key={i}
                        className={cn(
                            "grid grid-cols-[22px_minmax(0,1fr)] font-mono text-[12px] leading-[1.55]",
                            l.sign === "+" ? "text-diff-added" : "text-diff-removed"
                        )}
                    >
                        <span className="text-center">{l.sign}</span>
                        <span className="whitespace-pre-wrap break-words">{l.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// a fix that belongs to another project is one the scan's agent cannot apply from here: it is copied for that project
function CopyButton({ card }: { card: WorkflowCard }) {
    const { state, copy } = useCopyFeedback();
    return (
        <button
            type="button"
            data-workflow-copy={card.id}
            onClick={() => copy(copyText(card))}
            className="flex flex-none cursor-pointer items-center gap-1.5 rounded border border-accent-700 bg-accentbg px-3 py-1.5 text-[12px] font-semibold text-accent-soft hover:text-accenthover"
        >
            <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <CrossFade swapKey={state}>
                {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : `Copy for #${card.elsewhere}`}
            </CrossFade>
        </button>
    );
}

function Card({ model, card }: { model: AgentsViewModel; card: WorkflowCard }) {
    return (
        <article
            data-workflow-card={card.id}
            className="flex flex-col gap-3 rounded-[14px] border border-border bg-surface-raised px-5 py-4"
        >
            <div className="flex items-center gap-3.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {card.raisedAgain != null ? (
                            <span data-workflow-raised className={cn(TAG, "bg-askingbg text-warning")}>
                                raised again
                            </span>
                        ) : null}
                        {card.elsewhere != null ? (
                            <span data-workflow-elsewhere className={cn(TAG, "bg-askingbg text-warning")}>
                                fix in #{card.elsewhere}
                            </span>
                        ) : null}
                        <h4 className="m-0 text-[15px] font-semibold text-primary">{card.title}</h4>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5 font-mono text-[11px] text-muted">
                        <span>
                            <b className="text-primary">{card.runs}</b> runs ·{" "}
                            <b className="text-primary">{card.days}</b> days
                        </span>
                        {card.projects.map((p) => (
                            <span key={p.name} className="text-ink-mid">
                                #{p.name} {p.runs}
                            </span>
                        ))}
                        {card.raisedAgain != null ? (
                            <span className="text-ink-mid">
                                declined at {card.raisedAgain.declinedAt} runs → now{" "}
                                <b className="text-primary">{card.raisedAgain.now}</b>
                            </span>
                        ) : null}
                    </div>
                </div>
                {card.elsewhere != null ? <CopyButton card={card} /> : null}
            </div>
            <Quotes model={model} card={card} />
            <EditBlock card={card} />
        </article>
    );
}

function FiledToggle({ label, rows, attr }: { label: string; rows: FiledRow[]; attr: string }) {
    const [open, setOpen] = useState(false);
    if (rows.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-col gap-2.5">
            <button
                type="button"
                {...{ [attr]: "" }}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="cursor-pointer self-start border-0 bg-transparent p-0 font-mono text-[11px] text-muted hover:text-secondary"
            >
                {rows.length} {label} {open ? "⌄" : "›"}
            </button>
            {open ? <TaggedRows rows={rows} attr="data-workflow-filed" /> : null}
        </div>
    );
}

function Head({
    run,
    view,
    model,
}: {
    run: Run;
    view: Exclude<WorkflowView, { kind: "idle" }>;
    model: AgentsViewModel;
}) {
    const head = scanHead(run);
    if (head == null) {
        return null;
    }
    // while the scan is live its agent is where it asks; after, the run's sheet is what is left
    const live = view.kind === "scanning" || view.kind === "picking";
    return (
        <div data-workflow-head className="flex items-baseline gap-4">
            <h2 className="m-0 text-[14px] font-semibold text-primary">{head.title}</h2>
            <span className={MONO_META}>{head.span}</span>
            <HeadStatus view={view} />
            <span className="flex-1" />
            <button
                type="button"
                data-workflow-open-run
                onClick={() => openScan(model, run.id)}
                className={view.kind === "picking" ? CANVAS_PRIMARY_BTN : CANVAS_BTN}
            >
                {live ? "Open agent" : "Open run"}
            </button>
        </div>
    );
}

function Picking({
    model,
    run,
    view,
}: {
    model: AgentsViewModel;
    run: Run;
    view: Extract<WorkflowView, { kind: "picking" }>;
}) {
    return (
        <>
            <Head run={run} view={view} model={model} />
            {view.cards.map((c) => (
                <Card key={c.id} model={model} card={c} />
            ))}
            <div className="flex flex-col gap-3 px-0.5 py-1">
                <FiledToggle label="already covered" rows={view.covered} attr="data-workflow-covered-toggle" />
                <FiledToggle label="still declined" rows={view.declined} attr="data-workflow-declined-toggle" />
                <FiledToggle
                    label={`under ${RUN_FLOOR} runs`}
                    rows={view.underFloor}
                    attr="data-workflow-under-toggle"
                />
            </div>
        </>
    );
}

function Done({
    model,
    run,
    view,
}: {
    model: AgentsViewModel;
    run: Run;
    view: Extract<WorkflowView, { kind: "done" }>;
}) {
    return (
        <Panel label="Done" detail="done" className="gap-3.5">
            <div className="flex items-center gap-2">
                <Check size={13} strokeWidth={2.4} aria-hidden="true" className="text-success" />
                <span className="text-[14px] font-semibold text-primary">{view.commit ? "Committed" : "Finished"}</span>
                {view.commit ? (
                    <span data-workflow-commit className="font-mono text-[12px] text-accent-soft">
                        {view.commit.slice(0, 8)}
                    </span>
                ) : null}
                <span className="flex-1" />
                {/* the scan run's changes live where its lanes landed: the Diff surface scoped to the run */}
                <button
                    type="button"
                    data-workflow-open-diff
                    onClick={() => openDiff(model, diffScopeOfRun(run))}
                    className={cn(CANVAS_BTN, "px-2.5 py-[5px] text-[12px]")}
                >
                    Open in Diff
                </button>
            </div>
            <TaggedRows rows={view.rows} attr="data-workflow-done-row" />
        </Panel>
    );
}

function Nothing({ view }: { view: Extract<WorkflowView, { kind: "nothing" }> }) {
    const notRaised = [...view.covered, ...view.declined, ...view.underFloor];
    const facts = [
        view.underFloor.length > 0 ? `${view.underFloor.length} under ${RUN_FLOOR} runs` : "",
        view.covered.length > 0 ? `${view.covered.length} covered` : "",
        view.declined.length > 0 ? `${view.declined.length} declined` : "",
    ].filter(Boolean);
    return (
        <Panel label="Nothing to suggest" detail="nothing" className="gap-3.5">
            <div className="flex items-center gap-2.5">
                <Check size={18} strokeWidth={2.4} aria-hidden="true" className="text-success" />
                <span className="text-[15px] font-semibold text-primary">Nothing to suggest</span>
                {facts.length > 0 ? <span className={MONO_META}>{facts.join(" · ")}</span> : null}
            </div>
            {notRaised.length > 0 ? (
                <div className="flex flex-col gap-3 border-t border-edge-faint pt-3.5">
                    <h3 className="m-0 text-[13px] font-semibold text-secondary">Not raised</h3>
                    <TaggedRows rows={notRaised} attr="data-workflow-filed" />
                </div>
            ) : null}
        </Panel>
    );
}

function Body({
    model,
    run,
    view,
    idle,
}: {
    model: AgentsViewModel;
    run: Run | null;
    view: WorkflowView;
    idle: ReactNode;
}) {
    if (view.kind === "idle" || run == null) {
        return idle;
    }
    if (view.kind === "picking") {
        return <Picking model={model} run={run} view={view} />;
    }
    return (
        <>
            <Head run={run} view={view} model={model} />
            <Split stages={view.stages}>
                {view.kind === "scanning" ? (
                    <ScanDetail detail={view.detail} />
                ) : view.kind === "done" ? (
                    <Done model={model} run={run} view={view} />
                ) : (
                    <Nothing view={view} />
                )}
            </Split>
        </>
    );
}

// the lens owns the page below the shared header: the other lens's range toggle and provider tabs mean nothing here
export function WorkflowLens({ model, lensSwitch }: { model: AgentsViewModel; lensSwitch: ReactNode }) {
    const runId = useAtomValue(workflowScanRunAtom);
    const oref = runId ? WOS.makeORef("run", runId) : null;
    const run = useAtomValue(oref ? WOS.getWaveObjectAtom<Run>(oref) : NO_RUN) ?? null;
    const loading = useAtomValue(oref ? WOS.getWaveObjectLoadingAtom(oref) : NOT_LOADING);
    const activeChannel = useAtomValue(activeChannelAtom);
    const projectRows = useAtomValue(projectListAtom);
    const recentProjects = useAtomValue(recentProjectsAtom);
    const channels = useAtomValue(channelsAtom);
    const [pickedProject, setPickedProject] = useAtom(scanProjectAtom);
    const [loadError, setLoadError] = useState<string | null>(null);
    const start = useAction();

    // a scan started from the palette or from here has set the run already; a lens opened on a fresh start of the app
    // asks for the newest scan among the runs it knows (our wavesrv has no "newest scan" command)
    useEffect(() => {
        if (runId != null) {
            return;
        }
        let live = true;
        fireAndForget(async () => {
            try {
                if (globalStore.get(channelsAtom) == null) {
                    await primeChannels();
                }
                await loadAllRuns(globalStore.get(channelsAtom) ?? []);
                const newest = newestScanRun(globalStore.get(allRunsAtom));
                if (live && newest != null && globalStore.get(workflowScanRunAtom) == null) {
                    followWorkflowScan(newest.id);
                }
            } catch (e) {
                if (live) {
                    setLoadError(errText(e));
                }
            }
        });
        return () => {
            live = false;
        };
    }, []);

    const view = workflowView(run);
    const home = scanHomeChannel(pickedProject, run?.channeloid, channels, activeChannel, projectRows, recentProjects);
    const scannable = rowsWithChannel(projectRows);
    // the picker names the project whose channel scans, which is not always a registered one
    const homeName = home == null ? null : (scannable.find((r) => r.channel.oid === home.oid)?.name ?? home.name);
    const button = scanButton(view, home);
    const scan = () => {
        const channelId = button.channelId;
        if (channelId != null) {
            void start.run(async () => {
                await startWorkflowScanFromLens(channelId);
            });
        }
    };
    const scanDisabled = !button.enabled || start.busy;
    const pickerNames = scannable.map((r) => r.name);
    if (homeName != null && !pickerNames.includes(homeName)) {
        pickerNames.push(homeName);
    }

    return (
        <div
            data-workflow-lens={loading ? "loading" : view.kind}
            className="flex h-full min-h-0 flex-col bg-background"
        >
            <SurfaceHeader
                title="Usage"
                subtitle={
                    <span className="block max-w-[680px] leading-[1.5]">
                        What keeps going wrong across your runs, counted from their records. The scan names recurring
                        problems and drafts a fix for each; its agent asks which to apply.
                    </span>
                }
                actions={
                    <>
                        {start.error != null && view.kind !== "idle" ? (
                            <span
                                data-workflow-start-error
                                title={start.error}
                                className="min-w-0 max-w-[260px] truncate text-[12px] text-error"
                            >
                                {start.error}
                            </span>
                        ) : null}
                        {lensSwitch}
                        <select
                            data-workflow-project-select
                            aria-label="Project to scan from"
                            title="The project the scan starts from"
                            value={homeName ?? ""}
                            disabled={pickerNames.length === 0}
                            onChange={(e) => setPickedProject(e.target.value)}
                            className={SELECT}
                        >
                            {homeName == null ? <option value="">No project</option> : null}
                            {pickerNames.map((name) => (
                                <option key={name} value={name}>
                                    #{name}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            data-workflow-scan-button
                            disabled={scanDisabled}
                            title={button.title}
                            onClick={scan}
                            className={cn(
                                CANVAS_BTN,
                                scanDisabled &&
                                    "cursor-default text-ink-faint hover:border-edge-mid hover:bg-surface-raised"
                            )}
                        >
                            Scan workflow
                        </button>
                    </>
                }
            />
            {loadError != null ? (
                <div data-workflow-load-error className="px-7 pt-3 text-[12px] text-error">
                    Couldn’t read the last scan: {loadError}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-4 px-7 pb-12 pt-[18px]">
                    {loading ? null : (
                        <Body
                            model={model}
                            run={run}
                            view={view}
                            idle={
                                <Idle
                                    last={view.kind === "idle" ? view.last : undefined}
                                    button={button}
                                    onScan={scan}
                                    busy={start.busy}
                                    error={start.error}
                                />
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
