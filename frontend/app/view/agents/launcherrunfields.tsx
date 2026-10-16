// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher's run row. Its third column (RunColumn): the lead model for a Quick run; where an Orchestrate starts
// (a goal or a plan file) and how wide. Below the columns (RunFields): the goal or the plan with its preview, then an
// Orchestrate's three route pickers. Every control writes the run launcher's own atoms (runconfigstore), the same ones
// the Brief's launcher reads.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { TriangleAlert, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import {
    planMixLine,
    planModelRows,
    workersModelName,
    type PlanModelTone,
    type WorkersSetting,
} from "../jarvis/newrunplan";
import { planShapeText, planWarnings } from "../orchestrate/dagdigest";
import { CapacityWarn } from "./capacitywarn";
import { leadRuntimesAtom } from "./harnessstore";
import { LAUNCHER_LABEL } from "./launcheragentfields";
import { ColumnLabel, rowTone } from "./launcherrows";
import { launcherGoalAtom, launcherPrototypeAtom } from "./launcherstore";
import { RoutePicker } from "./routepicker";
import { approvalsNote, START_OPTIONS, startNote, type StartFrom } from "./runconfig";
import {
    autonomousAtom,
    lightReviewerRouteAtom,
    parallelismAtom,
    planPathAtom,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeOpenRequestAtom,
    runRouteAtom,
    runShapeAtom,
    setAutonomous,
    setLightReviewerRoute,
    setPlanPath,
    setReviewerPicks,
    setReviewerRoute,
    setRunRoute,
    setStart,
    setWorkerRoute,
    startAtom,
    stepParallelism,
    workerRouteAtom,
} from "./runconfigstore";
import { START_LABEL, usePlanPreview, WorkerStepper } from "./runlauncher";
import { capacityWarnTitle, extraWorkers, overCapacity } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// RoutePicker caps its trigger for the inline rows it usually sits in; a Models column gives it the column
const FULL_WIDTH_PICKER =
    "min-w-0 [&>div]:w-full [&>div>button]:w-full [&>div>button]:max-w-none [&>div>button]:justify-between";
const PLAN_GRID = "grid grid-cols-[40px_minmax(0,1fr)_44px_96px_112px] gap-x-2.5 px-3";
const MODEL_TONE: Record<PlanModelTone, string> = {
    "plan-live": "text-accent-soft",
    "plan-ignored": "text-ink-faint line-through",
    "at-review": "text-muted",
    workers: "text-ink-mid",
};
// grows with what is typed, up to about eleven lines, then scrolls
const FIELD =
    "block field-sizing-content max-h-[240px] w-full resize-none overflow-y-auto rounded-[10px] border border-edge-mid bg-surface px-3 py-[10px] text-[13px] leading-normal text-primary outline-none placeholder:text-muted focus:border-accent-700";

// where an Orchestrate starts, as two rows of the third column; the note under the goal or the plan says what each does
function StartRows({ start }: { start: StartFrom }) {
    return (
        <div role="group" aria-label="Start from" className="flex shrink-0 flex-col gap-px">
            {START_OPTIONS.map((option) => (
                <button
                    key={option}
                    type="button"
                    aria-pressed={start === option}
                    onClick={() => setStart(option)}
                    className={cn(
                        rowTone(start === option, false),
                        "w-full py-2 text-left text-[12.5px]",
                        start === option ? "font-semibold text-primary" : "text-muted-foreground"
                    )}
                >
                    {START_LABEL[option]}
                </button>
            ))}
        </div>
    );
}

function PlanTable({ result, workers }: { result: CommandDagPlanPreviewRtnData; workers: WorkersSetting }) {
    const tasks = result.tasks ?? [];
    const mix = planMixLine(tasks, workers);
    return (
        <div data-jarvis-plan-preview="ready" className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2.5">
                {result.title ? (
                    <span className="min-w-0 truncate text-[14px] font-semibold text-ink-hi">{result.title}</span>
                ) : null}
                <span className="flex-none text-[10.5px] tabular-nums text-ink-mid">{planShapeText(result.shape)}</span>
                <span
                    className={cn(
                        "ml-auto flex-none text-[10.5px] tabular-nums",
                        mix.accent ? "text-accent-soft" : "text-ink-mid"
                    )}
                >
                    {mix.text}
                </span>
            </div>
            {planWarnings(result.shape, result.verify).map((warning) => (
                <span key={warning} className="text-[10.5px] text-warning">
                    {warning}
                </span>
            ))}
            <div className="max-h-[240px] overflow-y-auto rounded-[8px] border border-border bg-surface">
                <div
                    className={cn(
                        PLAN_GRID,
                        "sticky top-0 border-b border-border bg-surface py-1.5 text-[10px] uppercase tracking-[.08em] text-muted"
                    )}
                >
                    <span>task</span>
                    <span>title</span>
                    <span>lane</span>
                    <span>needs</span>
                    <span>model</span>
                </div>
                {planModelRows(tasks, workers).map((row, i) => (
                    <div
                        key={row.id}
                        className={cn(PLAN_GRID, "items-center py-1.5", i > 0 && "border-t border-edge-faint")}
                    >
                        <span className="text-[10.5px] text-muted">{row.id}</span>
                        <span className="truncate text-[12px] text-ink-hi">{row.title}</span>
                        <span className="text-[10.5px] tabular-nums text-ink-mid">{row.lane}</span>
                        <span className="truncate text-[10.5px] text-muted">{row.needs}</span>
                        <span title={row.model} className={cn("truncate text-[10.5px]", MODEL_TONE[row.tone])}>
                            {row.model}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// The plan is parsed here, before anything is created: a plan that will not run shows the parser's message in place
// of the table and holds the start.
function PlanPane({
    projectPath,
    workers,
    inputRef,
}: {
    projectPath: string;
    workers: WorkersSetting;
    inputRef: RefObject<HTMLInputElement>;
}) {
    const path = useAtomValue(planPathAtom);
    const current = usePlanPreview(path, projectPath);
    return (
        <>
            <input
                ref={inputRef}
                data-jarvis-plan-path
                value={path}
                aria-label="Plan file path"
                onChange={(e) => setPlanPath(e.target.value)}
                placeholder="Plan path, absolute or relative to the project"
                className="w-full rounded-[8px] border border-edge-mid bg-surface px-3 py-[9px] text-[12.5px] text-primary outline-none placeholder:text-muted focus:border-accent-700"
            />
            {current?.error != null ? (
                <span data-jarvis-plan-preview="error" className="text-[11px] leading-[1.45] text-error">
                    {current.error}
                </span>
            ) : current?.result != null ? (
                <PlanTable result={current.result} workers={workers} />
            ) : null}
        </>
    );
}

function ModelPick({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <span className={LAUNCHER_LABEL}>{label}</span>
            <div className={FULL_WIDTH_PICKER}>{children}</div>
        </div>
    );
}

function LeadPicker() {
    const route = useAtomValue(runRouteAtom);
    const openRequest = useAtomValue(routeOpenRequestAtom);
    const leadRuntimes = useAtomValue(leadRuntimesAtom);
    return (
        <RoutePicker
            value={route}
            onChange={setRunRoute}
            placement="bottom-start"
            openRequest={openRequest}
            title="Lead model"
            runtimes={leadRuntimes}
        />
    );
}

const APPROVALS: { autonomous: boolean; label: string }[] = [
    { autonomous: false, label: "Ask me" },
    { autonomous: true, label: "Autonomous" },
];

// Approvals: who answers the run's questions, the human or the lead on its own
function RunApprovals() {
    const autonomous = useAtomValue(autonomousAtom);
    return (
        <div data-launcher-approvals className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={LAUNCHER_LABEL}>Approvals</span>
            <div
                role="group"
                aria-label="Approvals"
                className="flex w-fit gap-0.5 rounded-[8px] border border-border bg-surface p-0.5"
            >
                {APPROVALS.map((option) => (
                    <button
                        key={option.label}
                        type="button"
                        aria-pressed={autonomous === option.autonomous}
                        onClick={() => setAutonomous(option.autonomous)}
                        className={cn(
                            "cursor-pointer rounded-[6px] px-3 py-1 text-[11.5px] font-semibold",
                            autonomous === option.autonomous
                                ? "bg-accentbg text-accent-soft"
                                : "text-ink-mid hover:text-secondary"
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
            <span className="text-[11px] leading-[1.45] text-muted">{approvalsNote(autonomous)}</span>
        </div>
    );
}

function RunModels() {
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const lightReviewerRoute = useAtomValue(lightReviewerRouteAtom);
    const leadRuntimes = useAtomValue(leadRuntimesAtom);
    return (
        <div className="grid grid-cols-2 gap-2.5">
            <ModelPick label="Lead">
                <LeadPicker />
            </ModelPick>
            <ModelPick label="Workers">
                <RoutePicker
                    value={workerRoute}
                    onChange={setWorkerRoute}
                    placement="bottom-start"
                    title="Workers model"
                    canInherit
                    inheritedLabel="Same as lead"
                    extraOption={{
                        label: "Reviewer picks",
                        selected: reviewerPicks,
                        onSelect: () => setReviewerPicks(true),
                    }}
                />
            </ModelPick>
            <ModelPick label="Reviewers">
                <RoutePicker
                    value={reviewerRoute}
                    onChange={setReviewerRoute}
                    placement="bottom-start"
                    title="Reviewers model"
                    canInherit
                    inheritedLabel="Same as lead"
                    runtimes={leadRuntimes}
                />
            </ModelPick>
            <span data-light-reviewers-row className="contents">
                <ModelPick label="Light reviewers">
                    <RoutePicker
                        value={lightReviewerRoute}
                        onChange={setLightReviewerRoute}
                        placement="bottom-start"
                        title="Light reviewers model"
                        canInherit
                        inheritedLabel="Sonnet (default)"
                    />
                </ModelPick>
            </span>
        </div>
    );
}

interface RunFieldsProps {
    projectPath: string;
    goalRef: RefObject<HTMLTextAreaElement>;
    planRef: RefObject<HTMLInputElement>;
    // a Quick run's low-RAM line; an orchestrator warns under its stepper, in the third column
    ramWarning: string | null;
}

export function RunFields({ projectPath, goalRef, planRef, ramWarning }: RunFieldsProps) {
    const shape = useAtomValue(runShapeAtom);
    const start = useAtomValue(startAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const runRoute = useAtomValue(runRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const goal = useAtomValue(launcherGoalAtom);
    const prototype = useAtomValue(launcherPrototypeAtom);
    const orchestrator = shape === "orchestrator";
    // a plan start is named by its plan, so it has no goal field
    const planStart = orchestrator && start === "plan";
    return (
        <>
            {planStart ? (
                <div className="flex flex-col gap-2">
                    <PlanPane
                        projectPath={projectPath}
                        workers={{ picks: reviewerPicks, model: workersModelName(workerRoute, runRoute) }}
                        inputRef={planRef}
                    />
                    <span className="text-[11px] leading-[1.45] text-muted">{startNote("plan")}</span>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {orchestrator ? null : (
                        <div className="flex items-baseline gap-2">
                            <label htmlFor="launcher-goal" className={LAUNCHER_LABEL}>
                                Goal
                            </label>
                            <span className="text-[11px] text-muted">
                                one fresh worker; it stops and asks if the goal turns out bigger
                            </span>
                        </div>
                    )}
                    <textarea
                        id="launcher-goal"
                        ref={goalRef}
                        aria-label="Goal"
                        value={goal}
                        onChange={(e) => globalStore.set(launcherGoalAtom, e.target.value)}
                        placeholder="What should it do?"
                        className={cn(FIELD, orchestrator ? "min-h-24" : "min-h-28")}
                    />
                    {orchestrator ? (
                        <span className="text-[11px] leading-[1.45] text-muted">{startNote("goal")}</span>
                    ) : null}
                </div>
            )}
            {orchestrator ? <RunModels /> : null}
            {orchestrator ? <RunApprovals /> : null}
            {orchestrator && prototype !== "" ? (
                <div data-launcher-prototype className="flex items-center gap-1.5">
                    <span title={prototype} className="min-w-0 truncate text-[11px] text-muted">
                        Prototype · {prototype}
                    </span>
                    <button
                        type="button"
                        aria-label="Remove prototype"
                        onClick={() => globalStore.set(launcherPrototypeAtom, "")}
                        className="flex flex-none cursor-pointer items-center text-muted hover:text-primary"
                    >
                        <X size={12} aria-hidden />
                    </button>
                </div>
            ) : null}
            {ramWarning ? (
                <div data-ram-warn className="flex items-center gap-1.5 text-[12px] text-warning">
                    <TriangleAlert size={13} className="shrink-0" />
                    <span>{ramWarning}</span>
                </div>
            ) : null}
        </>
    );
}

// The third column for a run row: a Quick run's lead model; an Orchestrate's start and width, with the capacity line
// under the stepper (spec, Orchestrate board) spelled out
export function RunColumn() {
    const shape = useAtomValue(runShapeAtom);
    const start = useAtomValue(startAtom);
    const parallelism = useAtomValue(parallelismAtom);
    const cap = useWorkerCapacity();
    const extra = extraWorkers(parallelism);
    const over = overCapacity(cap, extra);
    if (shape !== "orchestrator") {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <ColumnLabel label="Model" focused={false} />
                <div className={cn(FULL_WIDTH_PICKER, "px-1")}>
                    <LeadPicker />
                </div>
            </div>
        );
    }
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ColumnLabel label="Start from" focused={false} />
            <StartRows start={start} />
            <div aria-hidden className="mx-2 my-2 h-px shrink-0 bg-border" />
            <div className="flex shrink-0 items-center gap-2 px-2">
                <span className={cn(LAUNCHER_LABEL, "flex-1")}>Workers at once</span>
                <WorkerStepper value={parallelism} onStep={stepParallelism} warn={over} />
            </div>
            {cap != null && over ? (
                <div className="mt-2 flex shrink-0 items-start gap-1.5 px-2 text-[11.5px] leading-[1.45] text-warning">
                    <CapacityWarn cap={cap} extra={extra} />
                    <span>{capacityWarnTitle(cap)}</span>
                </div>
            ) : null}
        </div>
    );
}
