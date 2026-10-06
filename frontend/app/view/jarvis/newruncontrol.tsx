// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// + New run: the app bar's way to start work, from any surface. It was + Channel, which asked you to create a container and then
// find the goal box somewhere else — two steps because the Subjects column owned channel creation and the
// Stage owned composition, and B5 rescued each affordance to wherever it would still mount rather than
// asking whether they were one thing. They are: a project is what you pick, a goal is what you write, and
// the channel underneath is storage that resolves by path or gets minted (newrun.resolveChannelTarget).
//
// The launcher's own controls are here too, not a reduced copy of them. They used to live only on the
// sheet, which renders the launcher while a project has never run and the run body forever after
// (briefsheetmodel: body is "run" once a run exists) — so after the first launch there was no reachable
// way to say "not this time", and every run silently took the profile's shape. The window lays them out in
// two panes (Main.dc.html) but every control writes the launcher's own atoms, which is what keeps one answer
// to what a launch dispatches with: the same atoms, the same profile hydration, the same route.
//
// The window's open state is model.newRunOpenAtom, so deriveKeyContext sees it as a modal. The Brief's `r`
// binding presses the app-bar button by its data attribute (buildJarvisBindings), which is why the
// attribute matters more than the label.

import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { harnessPreferenceAtom } from "@/app/view/agents/harnessstore";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AgentsViewModel } from "../agents/agents";
import { CapacityWarn } from "../agents/capacitywarn";
import { channelsAtom, createChannel, primeChannels } from "../agents/channelsstore";
import { noteRecentProject, projectListAtom, recentProjectsAtom } from "../agents/projectsstore";
import { RoutePicker } from "../agents/routepicker";
import {
    channelOverrideAtom,
    createRun,
    loadResolvedProfile,
    resolveChannelLaunchRoute,
    resolvedProfileAtom,
} from "../agents/runactions";
import { START_OPTIONS, launchBlocker, startNote, type StartFrom } from "../agents/runconfig";
import {
    endRunConfigDraft,
    hydrateRunConfigFromProfile,
    parallelismAtom,
    planPathAtom,
    planPreviewAtom,
    resetRunConfigForChannel,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeOpenRequestAtom,
    routeTouchedAtom,
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
} from "../agents/runconfigstore";
import { ShapeCards, WorkerStepper, usePlanPreview } from "../agents/runlauncher";
import { extraWorkers, overCapacity } from "../agents/workercapacity";
import { useWorkerCapacity } from "../agents/workercapacitystore";
import { planShapeText, planWarnings } from "../orchestrate/dagdigest";
import {
    initialPick,
    launchGoal,
    launchOptsFromConfig,
    prefillToLaunch,
    resolveChannelTarget,
    type NewRunPrefill,
} from "./newrun";
import { planMixLine, planModelRows, workersModelName, type PlanModelTone, type WorkersSetting } from "./newrunplan";
import { openTarget } from "./openref";
import { ProjectPicker } from "./projectpickerview";

// Module scope, not component state: NewRunModalHost unmounts the modal on close, so a project picked for
// one launch was gone by the next one and every run started by re-picking the same project. Not persisted
// — where you last started work is a convenience for the session, not a setting. Exported for the palette,
// which offers its launch rows in the same project.

// What the next open of the window starts from, set by a canvas's Build this… or the palette's Quick and Orchestrate;
// the window clears it once read.
export const newRunPrefillAtom = atom<NewRunPrefill | null>(null) as PrimitiveAtom<NewRunPrefill | null>;

const FIELD_LABEL = "text-[10.5px] font-bold uppercase tracking-[.09em] text-ink-mid";
const CANCEL_BTN =
    "cursor-pointer rounded-[7px] border border-border bg-surface-raised px-3.5 py-1.5 text-[11.5px] font-semibold text-secondary hover:text-primary";
// RoutePicker caps its trigger for the inline rows it usually sits in; a Models row gives it the column
const FULL_WIDTH_PICKER =
    "min-w-0 flex-1 [&>div]:w-full [&>div>button]:w-full [&>div>button]:max-w-none [&>div>button]:justify-between";
const PLAN_GRID = "grid grid-cols-[40px_minmax(0,1fr)_44px_96px_112px] gap-x-2.5 px-3";
const START_LABEL: Record<StartFrom, string> = { goal: "Goal", plan: "Plan file" };
const MODEL_TONE: Record<PlanModelTone, string> = {
    "plan-live": "text-accent-soft",
    "plan-ignored": "text-ink-faint line-through",
    "at-review": "text-muted",
    workers: "text-ink-mid",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>{label}</span>
            {children}
        </div>
    );
}

function ModelRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-[74px] flex-none text-[12px] text-ink-mid">{label}</span>
            <div className={FULL_WIDTH_PICKER}>{children}</div>
        </div>
    );
}

function ModelsSection({ orchestrator }: { orchestrator: boolean }) {
    const route = useAtomValue(runRouteAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const openRequest = useAtomValue(routeOpenRequestAtom);
    return (
        <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>Models</span>
            <ModelRow label="Lead">
                <RoutePicker
                    value={route}
                    onChange={setRunRoute}
                    placement="bottom-start"
                    openRequest={openRequest}
                    title="Lead model"
                />
            </ModelRow>
            {orchestrator ? (
                <>
                    <ModelRow label="Workers">
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
                    </ModelRow>
                    <ModelRow label="Reviewers">
                        <RoutePicker
                            value={reviewerRoute}
                            onChange={setReviewerRoute}
                            placement="bottom-start"
                            title="Reviewers model"
                            canInherit
                            inheritedLabel="Same as lead"
                        />
                    </ModelRow>
                </>
            ) : null}
        </div>
    );
}

function StartToggle({ start }: { start: StartFrom }) {
    return (
        <div className="flex items-center gap-2">
            <div
                role="group"
                aria-label="Start from"
                className="flex flex-none gap-0.5 rounded-[8px] border border-border bg-surface p-0.5"
            >
                {START_OPTIONS.map((option) => (
                    <button
                        key={option}
                        type="button"
                        aria-pressed={start === option}
                        onClick={() => setStart(option)}
                        className={cn(
                            "cursor-pointer rounded-[6px] px-3 py-1 text-[11.5px] font-semibold",
                            start === option ? "bg-accentbg text-accent-soft" : "text-ink-mid hover:text-secondary"
                        )}
                    >
                        {START_LABEL[option]}
                    </button>
                ))}
            </div>
            <span className="min-w-0 flex-1 text-[11px] leading-[1.45] text-muted">{startNote(start)}</span>
        </div>
    );
}

function PlanTable({ result, workers }: { result: CommandDagPlanPreviewRtnData; workers: WorkersSetting }) {
    const tasks = result.tasks ?? [];
    const mix = planMixLine(tasks, workers);
    return (
        <div data-jarvis-plan-preview="ready" className="flex min-h-0 flex-1 flex-col gap-3">
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
            <div className="min-h-0 flex-1 overflow-y-auto rounded-[8px] border border-border bg-surface">
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

// The plan is parsed here, before anything is created (spec §1): a plan that will not run shows the parser's
// message in place of the table and holds the start.
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
                autoFocus
                value={path}
                aria-label="Plan file path"
                onChange={(e) => setPlanPath(e.target.value)}
                placeholder="Plan path, absolute or relative to the project"
                className="w-full rounded-[7px] border border-edge-mid bg-background px-2.5 py-[7px] text-[11.5px] text-primary placeholder:text-muted outline-none focus:border-accent/60"
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

function NewRunModal({ model, onClose }: { model: AgentsViewModel; onClose: () => void }) {
    const rows = useAtomValue(projectListAtom);
    const recent = useAtomValue(recentProjectsAtom);
    const channels = useAtomValue(channelsAtom);
    const profiles = useAtomValue(resolvedProfileAtom);
    const overrides = useAtomValue(channelOverrideAtom);
    const pref = useAtomValue(harnessPreferenceAtom);
    const shape = useAtomValue(runShapeAtom);
    const parallelism = useAtomValue(parallelismAtom);
    const cap = useWorkerCapacity();
    const extra = extraWorkers(parallelism);
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const startFrom = useAtomValue(startAtom);
    const planPath = useAtomValue(planPathAtom);
    const preview = useAtomValue(planPreviewAtom);
    const runRoute = useAtomValue(runRouteAtom);
    const routeTouched = useAtomValue(routeTouchedAtom);
    const names = rows.map((r) => r.name);
    // the project you last started work in, else the only one there is — either way the common case is
    // type-a-goal-and-go rather than pick-the-same-project-again
    const [picked, setPicked] = useState<string | null>(() => initialPick(names, recent[0] ?? null));
    const [goal, setGoal] = useState("");
    const [prototype, setPrototype] = useState("");
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const goalRef = useRef<HTMLTextAreaElement>(null);
    const planRef = useRef<HTMLInputElement>(null);
    const config = {
        shape,
        parallelism,
        workerRoute,
        start: startFrom,
        planPath,
        reviewerPicks,
        reviewerRoute,
        prototype,
    };
    const orchestrator = shape === "orchestrator";
    // a plan start is named by its plan, so it has no goal field to fill
    const planStart = orchestrator && startFrom === "plan";
    const blocker = launchBlocker({ shape, start: startFrom, goal, planPath, preview });
    const projectPath = rows.find((r) => r.name === picked)?.path ?? "";

    // The project's own channel is where its profile lives, and a project that has never run has no channel
    // yet — hydrating from `undefined` then leaves the launcher on its baselines, which is the right answer
    // for a project that has never said otherwise.
    const target = picked != null ? resolveChannelTarget(channels, picked, projectPath) : null;
    const pickedOid = target?.kind === "existing" ? target.oid : null;
    useEffect(() => {
        // keepTouched: the project is a field of this one launch, not a place you navigated to, so
        // changing it must not rewrite the shape or the width you already picked
        resetRunConfigForChannel(pickedOid, true);
        if (pickedOid != null) {
            loadResolvedProfile(pickedOid);
        }
    }, [pickedOid]);
    useEffect(() => {
        hydrateRunConfigFromProfile(pickedOid != null ? profiles[pickedOid] : null);
    }, [pickedOid, profiles]);
    // the lead route the picker opens on, same precedence the sheet's composer uses: the project's own
    // saved route, else the harness preference — and never over a route the user has picked by hand
    const profileRoute = (pickedOid != null ? overrides[pickedOid]?.route : null) ?? pref.route ?? null;
    useEffect(() => {
        if (!routeTouched && profileRoute != null) {
            globalStore.set(runRouteAtom, profileRoute);
        }
    }, [pickedOid, profileRoute, routeTouched]);

    // Waits for the project list: read while it is still loading, the prefill's project would not be found and
    // the pick would be dropped for good, since the atom is cleared on read.
    useEffect(() => {
        const prefill = globalStore.get(newRunPrefillAtom);
        if (prefill == null) {
            return;
        }
        globalStore.set(newRunPrefillAtom, null);
        const p = prefillToLaunch(prefill, names);
        if (p.picked != null) {
            setPicked(p.picked);
        }
        setRunShape(p.shape);
        setStart(p.start);
        setGoal(p.goal);
        setPrototype(p.prototype);
    }, [rows]);

    const select = (project: string) => {
        setPicked(project);
        // back to the field, so the next keystroke types into the launch rather than landing on the picker
        (goalRef.current ?? planRef.current)?.focus();
    };

    const register = () => {
        onClose();
        globalStore.set(model.newProjectOpenAtom, true);
    };

    const start = () => {
        if (picked == null || blocker != null || starting) {
            return;
        }
        if (target == null) {
            setError("Still reading your projects — try again in a moment.");
            return;
        }
        setStarting(true);
        setError(null);
        fireAndForget(async () => {
            let oid: string;
            let run: Run;
            try {
                // a channel minted here and then orphaned by a failed launch is the project's channel
                // either way, so there is nothing to roll back — the next run finds it
                oid = target.kind === "existing" ? target.oid : await createChannel(target.name, target.path);
                // a route the user picked in the Models section is the answer; otherwise resolve the
                // project's own, which also validates that the route is actually available right now
                const route = routeTouched && runRoute != null ? runRoute : await resolveChannelLaunchRoute(oid);
                run = await createRun(oid, launchGoal(config, goal), route, launchOptsFromConfig(config));
            } catch (e) {
                // only a failure BEFORE the run exists keeps this modal: there is still a launch to retry
                setError(String(e));
                setStarting(false);
                return;
            }
            noteRecentProject(picked);
            // the launch consumed this draft, so the next one starts from the project's saved defaults
            endRunConfigDraft(globalStore.get(resolvedProfileAtom)[oid]);
            // The run exists, so the launch has succeeded and the modal's work is done. Landing on it is a
            // separate concern that reports its own failures (openTarget toasts) — holding the modal open
            // over a run that is already running told the user their launch had failed. openTarget rather
            // than openChannelSheet because + New run is on the app bar: a launch from any surface has to
            // switch to the Brief, or the sheet opens where nobody is looking.
            onClose();
            await openTarget(model, { kind: "channel", channelId: oid, runId: run.id });
        });
    };

    return (
        <ModalShell
            open
            onClose={onClose}
            onSubmit={start}
            className={cn("flex w-[min(960px,94vw)] flex-col", rows.length > 0 && "h-[min(720px,88vh)]")}
        >
            <div
                data-new-run-window
                className="flex shrink-0 items-center gap-[11px] border-b border-border px-[18px] py-[15px]"
            >
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accentbg text-[10.5px] font-bold text-accent-soft">
                    ▸
                </div>
                <span className="flex-1 text-[15px] font-semibold text-primary">New run</span>
                <span className="rounded-[5px] border border-edge-mid px-[7px] py-0.5 text-[10.5px] text-ink-mid">
                    ctrl+⏎ to start
                </span>
            </div>
            {rows.length === 0 ? (
                <div className="flex flex-col items-start gap-2.5 px-[18px] py-4">
                    <span className="text-[12px] text-secondary">
                        A run needs a project, and none are registered yet.
                    </span>
                    <button
                        type="button"
                        onClick={register}
                        className="cursor-pointer rounded-[7px] border border-accent/30 bg-accentbg px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-soft hover:bg-accent/20"
                    >
                        Register a project
                    </button>
                </div>
            ) : (
                <>
                    <div className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)]">
                        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto border-r border-border bg-surface px-[18px] py-4">
                            <Field label="Project">
                                <ProjectPicker
                                    projects={rows}
                                    recent={recent}
                                    picked={picked}
                                    onPick={select}
                                    onRegister={register}
                                />
                            </Field>
                            <div className="flex flex-col gap-1.5">
                                <ShapeCards showParallelism={false} />
                                {orchestrator ? (
                                    <div className="flex items-center gap-1.5">
                                        <span className="flex-1 text-[12px] text-ink-mid">Workers at once</span>
                                        <WorkerStepper
                                            value={parallelism}
                                            onStep={stepParallelism}
                                            warn={overCapacity(cap, extra)}
                                        />
                                        <CapacityWarn cap={cap} extra={extra} />
                                    </div>
                                ) : null}
                            </div>
                            <ModelsSection orchestrator={orchestrator} />
                        </div>
                        <div className="flex min-h-0 min-w-0 flex-col gap-3 px-[18px] py-4">
                            {orchestrator ? <StartToggle start={startFrom} /> : null}
                            {planStart ? (
                                <PlanPane
                                    projectPath={projectPath}
                                    workers={{ picks: reviewerPicks, model: workersModelName(workerRoute, runRoute) }}
                                    inputRef={planRef}
                                />
                            ) : (
                                <textarea
                                    ref={goalRef}
                                    autoFocus
                                    aria-label="Goal"
                                    value={goal}
                                    onChange={(e) => setGoal(e.target.value)}
                                    placeholder="What should it do?"
                                    className="min-h-0 w-full flex-1 resize-none rounded-[7px] border border-edge-mid bg-background px-3 py-2.5 text-[13px] leading-[1.5] text-primary placeholder:text-muted outline-none focus:border-accent/60"
                                />
                            )}
                            {orchestrator && prototype !== "" ? (
                                <div className="flex items-center gap-1.5">
                                    <span title={prototype} className="min-w-0 truncate text-[11px] text-muted">
                                        Prototype · {prototype}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label="Remove prototype"
                                        onClick={() => setPrototype("")}
                                        className="flex flex-none cursor-pointer items-center text-muted hover:text-primary"
                                    >
                                        <X size={12} aria-hidden />
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 border-t border-border px-[18px] py-3">
                        {error != null ? (
                            <span className="min-w-0 flex-1 truncate text-[11px] text-error">{error}</span>
                        ) : (
                            <span className="flex-1 truncate text-[10.5px] tabular-nums text-ink-mid">
                                {/* the blocker first whenever there is one: a disabled Start run that
                                    named the shape instead of saying "Write the goal" read as a dead
                                    button, which is what a silent click on it looks like */}
                                {picked == null
                                    ? "pick a project"
                                    : (blocker ?? `${shape}${orchestrator ? " × " + parallelism : ""} in ${picked}`)}
                            </span>
                        )}
                        <button type="button" onClick={onClose} className={CANCEL_BTN}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={picked == null || blocker != null || starting}
                            onClick={start}
                            className="cursor-pointer rounded-[7px] bg-accent px-3.5 py-1.5 text-[11.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:bg-border disabled:text-muted"
                        >
                            {starting ? "Starting…" : "Start run"}
                        </button>
                    </div>
                </>
            )}
        </ModalShell>
    );
}

export function NewRunModalHost({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(model.newRunOpenAtom);
    // only the Brief loads the channel list, so a window opened from any other surface before the Brief
    // has mounted would wait on it forever; primeChannels, not loadChannels, which also selects a channel
    useEffect(() => {
        if (open) {
            fireAndForget(primeChannels);
        }
    }, [open]);
    return open ? <NewRunModal model={model} onClose={() => globalStore.set(model.newRunOpenAtom, false)} /> : null;
}
