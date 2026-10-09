// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher: one dialog that starts an agent, a terminal or a run
// (docs/superpowers/specs/2026-10-08-new-launcher-design.md). It replaced the New agent dialog and the New run window.
// The Start column picks what, the Project column where, the details below fill in the rest. Digits pick in the
// focused column, → and ← step between the two columns, and Tab walks the dialog without leaving it. Every close keeps
// the draft (launcherstore), which is what lets a click outside close it.
//
// The open state is model.launcherAtom, so deriveKeyContext counts the dialog as a modal. The app bar's one New button
// reopens it on the last pick; Mod+N and Mod+Shift+R, and the Brief's `r`, open it at the agent or the run door.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { DialogButton } from "@/app/modals/dialogbutton";
import { focusTrapTarget } from "@/app/modals/modalfocus";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { resolveChannelTarget, type NewRunPrefill, type RunConfig } from "@/app/view/jarvis/newrun";
import { openTarget } from "@/app/view/jarvis/openref";
import { homeFromInfo, projectWhere } from "@/app/view/jarvis/projectpicker";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, Network, Search, SquareTerminal, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { channelsAtom, primeChannels } from "./channelsstore";
import { harnessesAtom, harnessPreferenceAtom, resolveDefaultRuntime } from "./harnessstore";
import {
    composeStartupCommand,
    deriveBranch,
    RUNTIME_FLAGS,
    runtimeShowsTask,
    runtimeStartupCommand,
    runtimeSupportsWorktree,
    type Runtime,
} from "./launch";
import {
    agentRuntime,
    filterProjects,
    footerLine,
    launcherKey,
    launcherTitle,
    primaryLabel,
    projectAfterFilter,
    selectedProject,
    selectedRowId,
    startRows,
    stepIndex,
    type FocusZone,
    type LauncherKind,
    type StartRow,
    type StartRowId,
} from "./launcher";
import { AgentFields, LAUNCHER_LABEL, useProjectBranches } from "./launcheragentfields";
import { pickedResume, resumeChoices, resumeLaunchSpec } from "./launcherresume";
import { startLauncherRun } from "./launcherrun";
import { RunFields } from "./launcherrunfields";
import {
    abandonLauncherLaunch,
    applyLauncherPrefill,
    beginLauncherLaunch,
    clearLauncherDraft,
    closeLauncher,
    endLauncherDraft,
    endLauncherLaunch,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherBusyAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherGoalAtom,
    launcherKindAtom,
    launcherLaunchAbandoned,
    launcherLaunchTicket,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherResumeAtom,
    launcherRuntimeAtom,
    launcherSessionsAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
    loadLauncherSessions,
    openLauncher,
    pickLauncherProject,
    pickLauncherRuntime,
} from "./launcherstore";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { noteRecentProject, projectListAtom, recentFirst, recentProjectsAtom, type ProjectRow } from "./projectsstore";
import { leadRouteSeed } from "./route";
import { cancelRun, channelOverrideAtom, loadResolvedProfile, resolvedProfileAtom } from "./runactions";
import { launchBlocker, type RunShape } from "./runconfig";
import {
    hydrateRunConfigFromProfile,
    parallelismAtom,
    planPathAtom,
    planPreviewAtom,
    resetRunConfigForChannel,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeTouchedAtom,
    runRouteAtom,
    runShapeAtom,
    setRunShape,
    startAtom,
    workerRouteAtom,
} from "./runconfigstore";
import { RuntimeMark } from "./runtimemark";
import { newAgentRamWarning } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// Tab's stops, in DOM order; the close button is tabIndex -1 because Esc does the same
const FOCUSABLE =
    'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
const KEY_LEGEND = "rounded-[4px] border border-edge-mid bg-surface px-[5px] py-px font-mono text-[10px] text-ink-mid";

function rowTone(selected: boolean, focused: boolean): string {
    return cn(
        "flex cursor-pointer items-center rounded-[7px] px-2",
        selected ? "bg-surface-selected" : "hover:bg-surface-hover",
        // the selected row of the focused column is the keyboard's cursor
        selected && focused && "ring-1 ring-inset ring-accent-700"
    );
}

// A row's digit. It brightens while its column has focus, which is how the eye finds where a digit will land.
function Keycap({ k, lit }: { k: string; lit: boolean }) {
    if (k === "") {
        return <span aria-hidden className="w-[18px] shrink-0" />;
    }
    return (
        <span
            aria-hidden
            className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border font-mono text-[10px]",
                lit ? "border-edge-strong bg-surface text-ink-hi" : "border-border text-muted"
            )}
        >
            {k}
        </span>
    );
}

function ColumnLabel({
    label,
    hint,
    focused,
    className,
}: {
    label: string;
    hint?: string;
    focused: boolean;
    className?: string;
}) {
    return (
        <div className={cn("flex items-baseline gap-2 px-2 pb-[7px] pt-0.5", className)}>
            <span className={cn(LAUNCHER_LABEL, "flex-1", focused && "text-secondary")}>{label}</span>
            {hint ? <span className="text-[10.5px] text-muted">{hint}</span> : null}
        </div>
    );
}

function StartMark({ id }: { id: StartRowId }) {
    if (id === "terminal") {
        return <SquareTerminal size={16} strokeWidth={1.8} className="text-ink-mid" />;
    }
    if (id === "quick") {
        return <Zap size={15} strokeWidth={1.8} className="text-ink-mid" />;
    }
    if (id === "orchestrator") {
        return <Network size={15} strokeWidth={1.8} className="text-ink-mid" />;
    }
    return (
        <RuntimeMark
            runtime={id}
            className="text-[12px] font-bold text-accent-soft"
            imageClassName="h-4 w-4 rounded-[3px]"
        />
    );
}

export function LauncherModal({ model }: { model: AgentsViewModel }) {
    const door = useAtomValue(model.launcherAtom);
    const open = door != null;
    const rows = useAtomValue(projectListAtom);
    const recent = useAtomValue(recentProjectsAtom);
    const harnesses = useAtomValue(harnessesAtom);
    const channels = useAtomValue(channelsAtom);
    const profiles = useAtomValue(resolvedProfileAtom);
    const overrides = useAtomValue(channelOverrideAtom);
    const pref = useAtomValue(harnessPreferenceAtom);
    const kind = useAtomValue(launcherKindAtom);
    const remembered = useAtomValue(launcherRuntimeAtom);
    const pickedName = useAtomValue(launcherProjectAtom);
    const task = useAtomValue(launcherTaskAtom);
    const goal = useAtomValue(launcherGoalAtom);
    const prototype = useAtomValue(launcherPrototypeAtom);
    const worktreeOn = useAtomValue(launcherWorktreeAtom);
    const branchPick = useAtomValue(launcherBranchAtom);
    const sessions = useAtomValue(launcherSessionsAtom);
    const resumeId = useAtomValue(launcherResumeAtom);
    const commands = useAtomValue(launcherCommandAtom);
    const naFlags = useAtomValue(naFlagsAtom);
    const restored = useAtomValue(launcherRestoredAtom);
    const busy = useAtomValue(launcherBusyAtom);
    const prefill = useAtomValue(launcherPrefillAtom);
    const flagMenuOpen = useAtomValue(launcherFlagMenuAtom);
    const branchListOpen = useAtomValue(launcherBranchListAtom);
    const shape = useAtomValue(runShapeAtom);
    const start = useAtomValue(startAtom);
    const planPath = useAtomValue(planPathAtom);
    const preview = useAtomValue(planPreviewAtom);
    const parallelism = useAtomValue(parallelismAtom);
    const workerRoute = useAtomValue(workerRouteAtom);
    const reviewerPicks = useAtomValue(reviewerPicksAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const runRoute = useAtomValue(runRouteAtom);
    const routeTouched = useAtomValue(routeTouchedAtom);
    const cap = useWorkerCapacity();
    const [zone, setZone] = useState<"start" | "project" | null>(null);
    const [filter, setFilter] = useState("");
    const [home, setHome] = useState("");
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const startRef = useRef<HTMLDivElement>(null);
    const projectRef = useRef<HTMLDivElement>(null);
    const goalRef = useRef<HTMLTextAreaElement>(null);
    const planRef = useRef<HTMLInputElement>(null);

    const startList = useMemo(() => startRows(harnesses), [harnesses]);
    const runtime = agentRuntime(startList, remembered);
    const selectedRow = selectedRowId(kind, runtime, shape);
    const isRun = kind === "run";
    const candidates = useMemo(() => recentFirst(rows, recent), [rows, recent]);
    const visible = filterProjects(candidates, filter);
    const project = selectedProject(candidates, pickedName);
    const projectPath = project?.path ?? "";
    const { currentBranch, branches } = useProjectBranches(
        open && !isRun,
        projectPath,
        runtimeSupportsWorktree(runtime)
    );
    const branchNames = branches.map((b) => b.name);
    // the sessions this agent and project offer, and the one picked (a pick no longer on offer launches nothing)
    const choices = resumeChoices(sessions, runtime, projectPath);
    const resume = isRun ? null : pickedResume(choices, resumeId);
    // a resumed session keeps its own folder, so the worktree option is neither shown nor applied
    const wantsWorktree = !isRun && resume == null && worktreeOn && runtimeSupportsWorktree(runtime);
    const chosenBranch = (branchPick ?? currentBranch).trim();
    // git can't reuse the checked-out branch for a worktree; branch a fresh one off it instead
    const landingBranch = chosenBranch === currentBranch ? deriveBranch(currentBranch, branchNames) : chosenBranch;
    const branchNote = wantsWorktree
        ? chosenBranch && `worktree on ${landingBranch}`
        : currentBranch && `on ${currentBranch}`;
    const blocker = isRun ? launchBlocker({ shape, start, goal, planPath, preview }) : null;
    const footer = footerLine({
        kind,
        shape,
        parallelism,
        project,
        branchNote,
        blocker,
        resume: resume && { title: resume.task || "(untitled session)", branch: resume.branch },
    });
    const config: RunConfig = {
        shape,
        parallelism,
        workerRoute,
        start,
        planPath,
        reviewerPicks,
        reviewerRoute,
        prototype,
    };
    // the project's own channel is where its profile lives; null while the channel list is still loading
    const target = isRun && project != null ? resolveChannelTarget(channels, project.name, project.path) : null;
    const pickedOid = target?.kind === "existing" ? target.oid : null;
    const rawRoute = (pickedOid != null ? overrides[pickedOid]?.route : null) ?? pref.route ?? null;
    // a lead picker never seeds a runtime that cannot lead; memoized, since the seed effect keys on it and a
    // fallback route is a fresh object each call
    const profileRoute = useMemo(() => leadRouteSeed(rawRoute, harnesses), [rawRoute, harnesses]);
    const ramWarning = isRun
        ? shape === "quick"
            ? newAgentRamWarning(cap, "run", "worker")
            : null
        : newAgentRamWarning(cap, runtime);
    const primaryDisabled = project == null || blocker != null || busy;
    // what an Escape closes first: a popover only while it is drawn (a branch list with no branches draws nothing)
    const flagMenuShown = !isRun && flagMenuOpen && RUNTIME_FLAGS[runtime].length > 0;
    const branchListShown = wantsWorktree && branchListOpen && branches.length > 0;

    // the first open picks the agent row from the harness preference; later opens keep the last pick
    useEffect(() => {
        if (!open || globalStore.get(launcherRuntimeAtom) != null) {
            return;
        }
        const chosen = resolveDefaultRuntime(pref.route?.runtime ?? "", harnesses);
        if (chosen) {
            globalStore.set(launcherRuntimeAtom, chosen as Runtime);
        }
    }, [open, pref, harnesses]);

    // focus opens on the Start column, so a digit picks at once and Enter launches the defaults. ModalShell's own
    // focus effect runs first (a child's effects do), so this one wins.
    useEffect(() => {
        if (open) {
            startRef.current?.focus();
        }
    }, [open]);

    // home turns a project's path into the folder it sits in (projectWhere)
    useEffect(() => {
        if (!open || home !== "") {
            return;
        }
        let live = true;
        fireAndForget(async () => {
            try {
                const next = homeFromInfo(await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: "~" } }));
                if (live) {
                    setHome(next);
                }
            } catch (e) {
                console.error("launcher: could not read the home folder, showing full paths", e);
            }
        });
        return () => {
            live = false;
        };
    }, [open, home]);

    // only the Brief loads the channel list, and a run needs it to find the project's channel
    useEffect(() => {
        if (open) {
            fireAndForget(primeChannels);
        }
    }, [open]);

    // the Resume list's sessions are read once per open, and the last open's are dropped first so a stale list never
    // flashes
    useEffect(() => {
        if (open) {
            globalStore.set(launcherSessionsAtom, null);
            fireAndForget(loadLauncherSessions);
        }
    }, [open]);

    // a prefill can also arrive while the dialog is already open, so it is a dependency too
    useEffect(() => {
        if (open && prefill != null) {
            applyLauncherPrefill(rows.map((r) => r.name));
        }
    }, [open, rows, prefill]);

    // DEV-only seam for the launcher CDP scenario: a canvas's Build this… prefill (the Prototype chip) comes only from
    // an agent's design canvas, which a scenario cannot stand up. A production build drops the branch.
    useEffect(() => {
        if (import.meta.env.DEV) {
            const w = window as unknown as { __openLauncher?: (door: LauncherKind, prefill?: NewRunPrefill) => void };
            w.__openLauncher = (door, p) => openLauncher(model, door, p);
        }
    }, [model]);

    useEffect(() => {
        if (!open || !isRun) {
            return;
        }
        // keepTouched: the project is a field of this launch, so picking it must not rewrite a shape or a width already
        // chosen by hand; an untouched draft still follows the project's saved defaults
        resetRunConfigForChannel(pickedOid, true);
        if (pickedOid != null) {
            loadResolvedProfile(pickedOid);
        }
    }, [open, isRun, pickedOid]);
    useEffect(() => {
        if (open && isRun) {
            hydrateRunConfigFromProfile(pickedOid != null ? profiles[pickedOid] : null);
        }
    }, [open, isRun, pickedOid, profiles]);
    // the lead route opens on the project's saved route, else the harness preference, never over a hand pick
    useEffect(() => {
        if (open && isRun && !routeTouched && profileRoute != null) {
            globalStore.set(runRouteAtom, profileRoute);
        }
    }, [open, isRun, profileRoute, routeTouched]);

    useEffect(() => {
        setError(null);
    }, [kind, runtime, project?.name]);

    const close = () => {
        setError(null);
        setFilter("");
        // a run still starting is given up with the dialog (startRun cancels it when it lands); an agent launch is
        // quick and is left to finish
        if (isRun) {
            abandonLauncherLaunch();
        }
        closeLauncher(model);
    };

    const pickRow = (row: StartRow | undefined) => {
        if (row == null) {
            return;
        }
        if (row.kind === "run") {
            globalStore.set(launcherKindAtom, "run");
            setRunShape(row.id as RunShape);
            return;
        }
        globalStore.set(launcherKindAtom, "agent");
        pickLauncherRuntime(row.id as Runtime);
    };

    const pickProject = (name: string) => pickLauncherProject(name, project?.name ?? "");

    const applyFilter = (next: string) => {
        setFilter(next);
        pickProject(projectAfterFilter(filterProjects(candidates, next), project?.name ?? ""));
    };

    const register = () => {
        close();
        globalStore.set(model.newProjectOpenAtom, true);
    };

    const launchAgentRow = async (p: ProjectRow) => {
        let branch: string | undefined;
        if (wantsWorktree) {
            if (!chosenBranch) {
                setError("Enter a branch name or turn off the worktree option.");
                return;
            }
            branch = landingBranch;
        }
        if (!beginLauncherLaunch()) {
            return;
        }
        try {
            await launchAgent(model, {
                runtime,
                startupCommand: composeStartupCommand(
                    commands[runtime] ?? runtimeStartupCommand(runtime),
                    runtime,
                    naFlags[runtime] ?? {}
                ),
                task: runtimeShowsTask(runtime) ? task : "",
                projectPath: p.path,
                projectName: p.name,
                branch,
                // a resume replaces the command (and, for pi, the argv and the transcript to preflight)
                ...(resume ? resumeLaunchSpec(resume, runtime, naFlags[runtime] ?? {}) : {}),
            });
            // Remember off: flags are single-use, cleared for the next agent
            if (!globalStore.get(naRememberFlagsAtom)) {
                globalStore.set(naFlagsAtom, {});
            }
            noteRecentProject(p.name);
            endLauncherDraft();
            close();
        } catch (e) {
            setError(String(e));
        } finally {
            endLauncherLaunch();
        }
    };

    const startRun = (p: ProjectRow) => {
        if (target == null) {
            setError("Still reading your projects — try again in a moment.");
            return;
        }
        if (!beginLauncherLaunch()) {
            return;
        }
        setError(null);
        const ticket = launcherLaunchTicket();
        fireAndForget(async () => {
            let started: { channelId: string; run: Run };
            try {
                started = await startLauncherRun({
                    target,
                    projectName: p.name,
                    config,
                    goal,
                    pickedRoute: routeTouched ? runRoute : null,
                });
            } catch (e) {
                // only a failure before the run exists keeps the dialog: there is still a launch to retry. A start the
                // user gave up has no dialog to say it in.
                if (!launcherLaunchAbandoned(ticket)) {
                    setError(String(e));
                    endLauncherLaunch();
                }
                return;
            }
            if (launcherLaunchAbandoned(ticket)) {
                // closed while it started: the user cancelled it, so the run goes and the draft stays for a retry
                await cancelRun(started.channelId, started.run.id);
                return;
            }
            endLauncherLaunch();
            endLauncherDraft();
            close();
            // landing on the run reports its own failures (openTarget toasts); holding the dialog over a run that is
            // already running would read as a failed launch
            await openTarget(model, { kind: "channel", channelId: started.channelId, runId: started.run.id });
        });
    };

    const launch = () => {
        if (project == null) {
            return;
        }
        if (isRun) {
            if (blocker != null) {
                // Enter or Mod+Enter on a run that cannot start yet goes to the field that blocks it
                (goalRef.current ?? planRef.current)?.focus();
                return;
            }
            startRun(project);
            return;
        }
        void launchAgentRow(project);
    };

    const zoneOf = (target: EventTarget): FocusZone => {
        if (target === startRef.current) {
            return "start";
        }
        if (target === projectRef.current) {
            return "project";
        }
        if (target instanceof Element && target.closest("[data-launcher-resume]")) {
            return "resume";
        }
        if (target instanceof HTMLTextAreaElement) {
            return "textarea";
        }
        if (target instanceof HTMLInputElement && target.type !== "checkbox") {
            return "input";
        }
        return "other";
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const root = rootRef.current;
        // a portaled menu (the route picker) bubbles here through React; its keys are its own
        if (root == null || !root.contains(e.target as Node)) {
            return;
        }
        const mod = e.metaKey || e.ctrlKey || e.altKey;
        // Tab walks the dialog's stops and wraps, as the DAG modal's trap does; focus never leaves the dialog
        if (e.key === "Tab" && !mod) {
            e.preventDefault();
            const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
            focusTrapTarget(stops, document.activeElement, e.shiftKey)?.focus();
            return;
        }
        const action = launcherKey(
            {
                zone: zoneOf(e.target),
                startCount: startList.length,
                projectCount: visible.length,
                filter,
                flagMenuOpen: flagMenuShown,
                branchListOpen: branchListShown,
            },
            { key: e.key, shift: e.shiftKey, mod }
        );
        if (action.kind === "none") {
            return;
        }
        e.preventDefault();
        switch (action.kind) {
            case "pick-start":
                pickRow(startList[action.index]);
                return;
            case "pick-project":
                pickProject(visible[action.index].name);
                return;
            case "move": {
                if (action.column === "start") {
                    const at = startList.findIndex((r) => r.id === selectedRow);
                    pickRow(startList[stepIndex(startList.length, at, action.delta)]);
                    return;
                }
                const next = stepIndex(
                    visible.length,
                    visible.findIndex((p) => p.name === project?.name),
                    action.delta
                );
                if (next >= 0) {
                    pickProject(visible[next].name);
                }
                return;
            }
            case "column":
                (action.to === "project" ? projectRef : startRef).current?.focus();
                return;
            case "filter":
                applyFilter(action.next);
                return;
            case "launch":
                launch();
                return;
            case "dismiss-inner":
                // the inner thing takes this Escape; ModalShell's would close the dialog
                e.stopPropagation();
                if (action.what === "flags") {
                    globalStore.set(launcherFlagMenuAtom, false);
                } else if (action.what === "branches") {
                    globalStore.set(launcherBranchListAtom, false);
                } else {
                    applyFilter("");
                }
                return;
            case "close":
                // the dialog's own close; ModalShell's listener would only do it again
                e.stopPropagation();
                close();
                return;
        }
    };

    const startFocused = zone === "start";
    const projectFocused = zone === "project";
    let projectHint = "";
    if (projectFocused) {
        projectHint = filter === "" && visible.length > 0 ? `type to filter · 1–${Math.min(9, visible.length)}` : "";
    } else if (candidates.length > 1) {
        projectHint = "last used first";
    }

    const renderStartRow = (row: StartRow) => {
        const selected = row.id === selectedRow;
        return (
            <div
                key={row.id}
                role="radio"
                aria-checked={selected}
                data-start-row={row.id}
                onClick={() => pickRow(row)}
                className={cn(rowTone(selected, startFocused), "gap-[9px]", row.desc ? "py-[7px]" : "py-2")}
            >
                <Keycap k={row.key} lit={startFocused} />
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <StartMark id={row.id} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span
                        className={cn(
                            "text-[12.5px] font-semibold",
                            selected ? "text-primary" : "text-muted-foreground"
                        )}
                    >
                        {row.name}
                    </span>
                    {row.desc ? <span className="text-[10.5px] text-muted">{row.desc}</span> : null}
                </span>
                {selected ? <Check size={14} strokeWidth={2.4} className="text-accent" /> : null}
            </div>
        );
    };

    return (
        <ModalShell
            open={open}
            onClose={close}
            onSubmit={launch}
            className="flex max-h-[86vh] w-[min(720px,93vw)] flex-col"
        >
            {open ? (
                // tabIndex -1: a click on blank space (or on a button, in WebKit) focuses the nearest focusable
                // ancestor; that must be this root, under onKeyDown, not ModalShell's panel above it
                <div
                    ref={rootRef}
                    data-launcher
                    tabIndex={-1}
                    onKeyDown={onKeyDown}
                    className="flex min-h-0 flex-1 flex-col outline-none"
                >
                    <div className="flex shrink-0 items-center gap-[10px] border-b border-border py-[13px] pl-[18px] pr-3">
                        <h2 className="m-0 text-[15px] font-semibold text-primary">{launcherTitle(kind)}</h2>
                        {restored ? (
                            <span data-launcher-restored className="flex items-center gap-1.5 text-[11.5px] text-muted">
                                · draft restored
                                <button
                                    type="button"
                                    onClick={clearLauncherDraft}
                                    className="cursor-pointer rounded-[5px] px-1 py-0.5 font-semibold text-ink-mid hover:bg-surface-hover hover:text-primary"
                                >
                                    Clear
                                </button>
                            </span>
                        ) : null}
                        <div className="flex-1" />
                        <span className="flex items-center gap-3 text-[11px] text-muted">
                            <span className="flex items-center gap-[5px]">
                                <kbd className={KEY_LEGEND}>1–9</kbd>pick
                            </span>
                            {projectFocused ? (
                                <span className="flex items-center gap-[5px]">
                                    <kbd className={KEY_LEGEND}>←</kbd>back
                                </span>
                            ) : null}
                            <span className="flex items-center gap-[5px]">
                                <kbd className={KEY_LEGEND}>{startFocused ? "→" : "Tab"}</kbd>next
                            </span>
                        </span>
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-label="Close"
                            title="Close (Esc)"
                            onClick={close}
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary"
                        >
                            <X size={15} strokeWidth={2} />
                        </button>
                    </div>
                    <div className="grid shrink-0 grid-cols-[236px_minmax(0,1fr)] border-b border-border">
                        <div
                            ref={startRef}
                            role="radiogroup"
                            aria-label="Start"
                            tabIndex={0}
                            data-launcher-column="start"
                            onFocus={() => setZone("start")}
                            onBlur={() => setZone(null)}
                            className="flex flex-col gap-px border-r border-border px-2 py-3 outline-none"
                        >
                            <ColumnLabel
                                label="Agent"
                                focused={startFocused}
                                hint={startFocused ? `↑↓ · 1–${startList.length}` : ""}
                            />
                            {startList.filter((r) => r.kind === "agent").map(renderStartRow)}
                            <ColumnLabel label="Run" focused={startFocused} className="pt-[10px]" />
                            {startList.filter((r) => r.kind === "run").map(renderStartRow)}
                        </div>
                        <div
                            ref={projectRef}
                            role="radiogroup"
                            aria-label="Project"
                            tabIndex={0}
                            data-launcher-column="project"
                            onFocus={() => setZone("project")}
                            onBlur={() => {
                                // a list narrowed by a query you can no longer see reads as projects gone missing
                                setZone(null);
                                setFilter("");
                            }}
                            className="flex min-w-0 flex-col gap-px px-2 py-3 outline-none"
                        >
                            <ColumnLabel label="Project" focused={projectFocused} hint={projectHint} />
                            {filter !== "" ? (
                                <div
                                    data-launcher-filter
                                    className="mb-1 flex items-center gap-2 rounded-[7px] border border-accent-700 bg-surface px-2 py-1.5"
                                >
                                    <Search size={13} className="shrink-0 text-muted" />
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{filter}</span>
                                    <span className="text-[10.5px] tabular-nums text-muted">
                                        {visible.length} of {candidates.length}
                                    </span>
                                </div>
                            ) : null}
                            {candidates.length === 0 ? (
                                <div className="flex flex-col items-start gap-2.5 px-2 py-1">
                                    <span data-launcher-empty className="text-[12.5px] leading-normal text-ink-mid">
                                        No projects yet. Agents and runs start in a project folder.
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
                                <div className="flex max-h-[236px] flex-col gap-px overflow-y-auto">
                                    {visible.map((p, i) => {
                                        const selected = p.name === project?.name;
                                        return (
                                            <div
                                                key={p.name}
                                                role="radio"
                                                aria-checked={selected}
                                                data-project-row={p.name}
                                                title={p.path}
                                                onClick={() => pickProject(p.name)}
                                                className={cn(rowTone(selected, projectFocused), "gap-[10px] py-2")}
                                            >
                                                <Keycap k={i < 9 ? String(i + 1) : ""} lit={projectFocused} />
                                                <span
                                                    className={cn(
                                                        "shrink-0 text-[12.5px] font-semibold",
                                                        selected ? "text-primary" : "text-muted-foreground"
                                                    )}
                                                >
                                                    {p.name}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted">
                                                    {projectWhere(p.path, home)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    {visible.length === 0 ? (
                                        <span data-launcher-nomatch className="px-2 py-1.5 text-[12px] text-muted">
                                            No project matches “{filter}”. Esc clears the filter.
                                        </span>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[18px] pb-4 pt-[14px]">
                        {isRun ? (
                            <RunFields
                                projectPath={projectPath}
                                goalRef={goalRef}
                                planRef={planRef}
                                ramWarning={ramWarning}
                            />
                        ) : (
                            <AgentFields
                                runtime={runtime}
                                currentBranch={currentBranch}
                                branches={branches}
                                ramWarning={ramWarning}
                                resumeChoices={choices}
                                resume={resume}
                            />
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3 border-t border-border px-[18px] py-[13px]">
                        {error != null ? (
                            <span
                                data-launcher-footer="error"
                                title={error}
                                className="min-w-0 flex-1 truncate text-[12px] text-error"
                            >
                                {error}
                            </span>
                        ) : (
                            <span
                                data-launcher-footer="line"
                                title={projectPath || undefined}
                                className={cn(
                                    "min-w-0 flex-1 truncate text-[12px]",
                                    footer.blocked ? "text-ink-mid" : "text-muted"
                                )}
                            >
                                {footer.lead}
                                {footer.strong ? (
                                    <span className="text-[11px] text-ink-hi">{footer.strong}</span>
                                ) : null}
                                {footer.tail}
                            </span>
                        )}
                        <DialogButton variant="secondary" hint="esc" onClick={close}>
                            Cancel
                        </DialogButton>
                        <DialogButton
                            variant="primary"
                            hint={formatChordString("Cmd:Enter")}
                            disabled={primaryDisabled}
                            onClick={launch}
                            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
                        >
                            {busy && isRun ? "Starting…" : primaryLabel(kind, runtime, resume != null)}
                        </DialogButton>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}
