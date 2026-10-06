// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run launcher: shape, where an orchestrator starts, how wide, and the two routes. It fills the Stage's
// thread slot while a run is being composed, directly above the goal box it configures.
//
// It lived in the right rail for one iteration and that was wrong twice over. The rail is 300px, so the
// three shape cards stacked into a column instead of reading side by side; and the rail is collapsible
// and persisted, so a user who had collapsed it lost every run control with no way back. The deeper
// problem was that the middle of the screen during composition is an empty state telling you to look
// somewhere else, while the primary action of the surface hid in a reading panel.
//
// Which sections a given shape actually has is decided by runconfig.runLauncherFace; this file renders.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { planShapeText, planWarnings } from "../orchestrate/dagdigest";
import { CapacityWarn } from "./capacitywarn";
import { RoutePicker } from "./routepicker";
import {
    MAX_PARALLELISM,
    SHAPE_CARDS,
    START_OPTIONS,
    runLauncherFace,
    startNote,
    type PlanPreview,
    type StartFrom,
} from "./runconfig";
import {
    parallelismAtom,
    planPathAtom,
    planPreviewAtom,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeOpenRequestAtom,
    runRouteAtom,
    runShapeAtom,
    setPlanPath,
    setReviewerPicks,
    setReviewerRoute,
    setRunRoute,
    setRunShape,
    setStart,
    setWorkerRoute,
    startAtom,
    stepParallelism,
    workerRouteAtom,
} from "./runconfigstore";
import { extraWorkers, overCapacity } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

export const EYEBROW = "text-[10.5px] font-bold uppercase tracking-[.09em] text-ink-mid";

// One selectable card treatment for both pickers, so the shape and the start read as the same kind of
// choice. Tokens only — a literal colour here would opt the launcher out of every runtime theme.
function pickTone(active: boolean): string {
    return active
        ? "border-accent/40 bg-accentbg text-accent-soft"
        : "border-border bg-surface-raised text-secondary hover:border-edge-mid";
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className={EYEBROW}>{label}</span>
            {children}
        </div>
    );
}

// Side by side rather than stacked: the two shapes are alternatives to one another, and a column made
// the reader compare them in sequence instead of at a glance. The width sits on the same line (design
// L869-883) because it only exists for the orchestrator shape it is next to.
export function ShapeCards({ showParallelism }: { showParallelism: boolean }) {
    const shape = useAtomValue(runShapeAtom);
    const par = useAtomValue(parallelismAtom);
    const cap = useWorkerCapacity();
    const extra = extraWorkers(par);
    return (
        <Section label="Shape">
            <div className="flex items-center gap-1.5">
                {/* equal columns: content-sized cards came out different widths and wrapped one description.
                    The cap keeps them card-sized on the wide Stage launcher. */}
                <div className="grid min-w-0 max-w-[360px] flex-1 grid-cols-2 gap-1.5">
                    {SHAPE_CARDS.map((card) => (
                        <button
                            key={card.id}
                            type="button"
                            aria-pressed={shape === card.id}
                            onClick={() => setRunShape(card.id)}
                            className={cn(
                                "flex cursor-pointer flex-col items-start gap-0.5 rounded-[7px] border px-[11px] py-2 text-left",
                                pickTone(shape === card.id)
                            )}
                        >
                            <span className="text-[12px] font-semibold">{card.id}</span>
                            <span className="text-[10.5px] text-ink-mid">{card.desc}</span>
                        </button>
                    ))}
                </div>
                {showParallelism ? (
                    <div className="ml-auto flex items-center gap-1.5">
                        <span className="text-[10.5px] text-ink-mid">workers</span>
                        <WorkerStepper value={par} onStep={stepParallelism} warn={overCapacity(cap, extra)} />
                        <CapacityWarn cap={cap} extra={extra} />
                    </div>
                ) : null}
            </div>
        </Section>
    );
}

const START_LABEL: Record<StartFrom, string> = { goal: "A goal", plan: "A plan file" };

// Where an orchestrator starts. It sits under the shape because it decides whether a lead runs at all: a plan
// file hands the engine work you already decomposed, and a lead appears only when something needs judgment.
function StartSection({ projectPath }: { projectPath: string }) {
    const start = useAtomValue(startAtom);
    return (
        <Section label="Start from">
            <div className="flex gap-2">
                {START_OPTIONS.map((option) => (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={start === option}
                        onClick={() => setStart(option)}
                        className={cn(
                            "cursor-pointer rounded-[7px] border px-3 py-1.5 text-[11.5px] font-semibold",
                            pickTone(start === option)
                        )}
                    >
                        {START_LABEL[option]}
                    </button>
                ))}
            </div>
            <span className="text-[11px] leading-[1.45] text-muted">{startNote(start)}</span>
            {start === "plan" ? <PlanPathField projectPath={projectPath} /> : null}
        </Section>
    );
}

// lets a typed or pasted path finish arriving before wavesrv reads the file
const PLAN_PREVIEW_DELAY_MS = 300;

// Reads the plan at `path` into planPreviewAtom, and returns the reading of exactly that path, or null.
export function usePlanPreview(path: string, projectPath: string): PlanPreview | null {
    const preview = useAtomValue(planPreviewAtom);
    useEffect(() => {
        const trimmed = path.trim();
        // cleared on every change, so a relative path's reading from the previous project is never shown
        globalStore.set(planPreviewAtom, null);
        if (trimmed === "") {
            return;
        }
        let live = true;
        const timer = setTimeout(() => {
            RpcApi.DagPlanPreviewCommand(TabRpcClient, { planpath: trimmed, projectpath: projectPath })
                .then((result) => {
                    if (live) {
                        globalStore.set(planPreviewAtom, { path: trimmed, result });
                    }
                })
                .catch((e) => {
                    if (live) {
                        globalStore.set(planPreviewAtom, {
                            path: trimmed,
                            error: e instanceof Error ? e.message : String(e),
                        });
                    }
                });
        }, PLAN_PREVIEW_DELAY_MS);
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [path, projectPath]);
    return preview != null && preview.path === path.trim() ? preview : null;
}

// The plan is parsed here, before anything is created (spec §1): a plan that will not run shows the parser's
// message and holds the start, and one that will shows the shape the engine is about to run.
function PlanPathField({ projectPath }: { projectPath: string }) {
    const path = useAtomValue(planPathAtom);
    const current = usePlanPreview(path, projectPath);
    return (
        <div className="flex flex-col gap-1">
            <input
                data-jarvis-plan-path
                value={path}
                aria-label="Plan file path"
                onChange={(e) => setPlanPath(e.target.value)}
                placeholder="Plan path, absolute or relative to the project"
                className="w-full rounded-[7px] border border-edge-mid bg-background px-2.5 py-1.5 text-[11.5px] text-primary placeholder:text-muted outline-none focus:border-accent/60"
            />
            {current?.error != null ? (
                <span data-jarvis-plan-preview="error" className="text-[11px] leading-[1.45] text-error">
                    {current.error}
                </span>
            ) : current?.result != null ? (
                <span
                    data-jarvis-plan-preview="ready"
                    className="flex flex-wrap gap-x-2 text-[10.5px] tabular-nums text-secondary"
                >
                    {current.result.title ? <span>{current.result.title}</span> : null}
                    <span>{planShapeText(current.result.shape)}</span>
                    {planWarnings(current.result.shape, current.result.verify).map((warning) => (
                        <span key={warning} className="text-warning">
                            {warning}
                        </span>
                    ))}
                </span>
            ) : null}
        </div>
    );
}

const STEP_BTN =
    "h-6 w-6 cursor-pointer rounded-[6px] border border-edge-mid bg-background text-secondary hover:border-edge-strong disabled:cursor-default disabled:opacity-40";

// The width dial, shared with the Profile's "Parallel workers" row. It is the one control whose cost the
// user pays directly: N concurrent children are N live worktrees and N token streams. A null value is a
// profile that leaves the width to the lead.
export function WorkerStepper({
    value,
    onStep,
    disabled = false,
    unsetLabel = "–",
    warn = false,
}: {
    value: number | null;
    onStep: (delta: number) => void;
    disabled?: boolean;
    // what a null value reads as: the launcher's dash, or the profile's "auto"
    unsetLabel?: string;
    // the pick is more workers than fit in RAM (CapacityWarn says why)
    warn?: boolean;
}) {
    return (
        <>
            <button
                type="button"
                onClick={() => onStep(-1)}
                disabled={disabled || (value != null && value <= 1)}
                aria-label="Fewer concurrent workers"
                className={STEP_BTN}
            >
                −
            </button>
            <span
                aria-live="polite"
                className={cn(
                    "min-w-4 text-center text-[12px] tabular-nums",
                    value == null ? "text-ink-mid" : warn ? "text-warning" : "text-primary"
                )}
            >
                {value ?? unsetLabel}
            </span>
            <button
                type="button"
                onClick={() => onStep(1)}
                disabled={disabled || (value != null && value >= MAX_PARALLELISM)}
                aria-label="More concurrent workers"
                className={STEP_BTN}
            >
                +
            </button>
        </>
    );
}

// `bottom-start` because the launcher is top-aligned in the thread slot: a menu opening upward from here
// would run off the top of the Stage, and one opening downward has the whole thread height to use.
function RoutingSection({ showWorkerRoute }: { showWorkerRoute: boolean }) {
    const route = useAtomValue(runRouteAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const openRequest = useAtomValue(routeOpenRequestAtom);
    return (
        <Section label="Routing">
            <div className="flex flex-wrap items-center gap-2">
                <RoutePicker
                    value={route}
                    onChange={setRunRoute}
                    placement="bottom-start"
                    openRequest={openRequest}
                    title="Lead model"
                />
                {showWorkerRoute ? (
                    <>
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
                        <RoutePicker
                            value={reviewerRoute}
                            onChange={setReviewerRoute}
                            placement="bottom-start"
                            title="Reviewers model"
                            canInherit
                            inheritedLabel="Same as lead"
                        />
                    </>
                ) : null}
            </div>
        </Section>
    );
}

// The controls themselves, without the intro. The + Run modal names the project and the action in its own
// header, so it renders these directly rather than printing a second heading over the same three sections.
export function RunLauncherSections({ projectPath }: { projectPath: string }) {
    const shape = useAtomValue(runShapeAtom);
    const face = runLauncherFace(shape);
    return (
        <>
            <ShapeCards showParallelism={face.showParallelism} />
            {face.showStart ? <StartSection projectPath={projectPath} /> : null}
            <RoutingSection showWorkerRoute={face.showWorkerRoute} />
        </>
    );
}

// No Launch button of its own: the goal and its `Run ⏎` are in the composer immediately below, and a
// second button here would have to reach across components to submit through that same face. The sheet's
// reading above it already names the project, so this opens on the controls.
export function RunLauncher({ projectPath }: { projectPath: string }) {
    return (
        <div className="sc min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-4">
            <div className="flex w-full flex-col gap-5">
                <div className="flex flex-col gap-1">
                    <span className="text-[9.5px] font-bold uppercase tracking-[.13em] text-feed-label">
                        how it should run
                    </span>
                    <span className="text-[11.5px] leading-[1.5] text-muted">
                        Set it up here, then give Jarvis the goal below and press Run ⏎.
                    </span>
                </div>
                <RunLauncherSections projectPath={projectPath} />
            </div>
        </div>
    );
}
