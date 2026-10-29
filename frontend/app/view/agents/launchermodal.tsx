// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher: one dialog that starts an agent, a terminal, a run or a tool
// (docs/superpowers/specs/2026-10-08-new-launcher-design.md). It replaced the New agent dialog and the New run window.
// Start picks what, Project where, and the third column holds the pick's own list (an agent's sessions, the tools, a
// run's model or start and width); the details below fill in the rest. Start opens folded into a chip over two columns,
// Project (names only) and the pick's own list taking the rest of the width; the chip, or ← from Project, opens it as a
// column beside them, and a pick, Enter, Escape or focus leaving it folds it again
// (docs/superpowers/specs/2026-10-28-new-launcher-declutter-design.md). The band is 360px tall either way: a long
// Project, Session or Tool list scrolls inside its column, so the dialog keeps its height however many projects and
// sessions there are. Digits pick in the focused column (0 is Home), → and ← step between the columns, and Tab walks
// the dialog without leaving it; no row draws its key. Every close keeps the draft (launcherstore), which is what lets
// a click outside close it.
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
import { homeFromInfo } from "@/app/view/jarvis/projectpicker";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, House, Network, SquareTerminal, Users, Wrench, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { showCouncilSetup, showSession } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { SLEEPABLE_AGENTS } from "./agentsleep";
import { channelsAtom, primeChannels } from "./channelsstore";
import { launchAccountName } from "./claudeaccount";
import { harnessesAtom, harnessPreferenceAtom, resolveDefaultRuntime } from "./harnessstore";
import {
    askStartupCommand,
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
    focusLaunchProject,
    footerLine,
    HOME_NAME,
    HOME_PICK,
    homeOffered,
    launcherKey,
    launcherTitle,
    pickedTool,
    primaryLabel,
    projectAfterFilter,
    projectColumnPicks,
    selectedProject,
    selectedRowId,
    startRows,
    stepIndex,
    toolBlocker,
    toolFolder,
    type FocusZone,
    type LauncherKind,
    type StartRow,
    type StartRowId,
} from "./launcher";
import { AgentFields, useProjectBranches } from "./launcheragentfields";
import { composeTaskWithImages, imagesPending } from "./launcherimages";
import { appendPage, pickedResume, resumeChoices, resumeLaunchSpec, resumeScopeKey } from "./launcherresume";
import { ResumeList } from "./launcherresumelist";
import { ColumnLabel, FilterLine, rowTone } from "./launcherrows";
import { handBackStartedRun, startLauncherRun } from "./launcherrun";
import { RunColumn, RunFields } from "./launcherrunfields";
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
    launcherFoundAtom,
    launcherGoalAtom,
    launcherImagesAtom,
    launcherKindAtom,
    launcherLaunchAbandoned,
    launcherLaunchTicket,
    launcherOwnProjectAtom,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherResumeAtom,
    launcherRuntimeAtom,
    launcherSessionsAtom,
    launcherTaskAtom,
    launcherToolAtom,
    launcherWorktreeAtom,
    loadLauncherSessions,
    openLauncher,
    pickLauncherProject,
    pickLauncherRuntime,
    pickLauncherTool,
    takeLauncherOnStarted,
} from "./launcherstore";
import { ToolFields, ToolList } from "./launchertoolfields";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { noteRecentProject, projectListAtom, recentFirst, recentProjectsAtom, type ProjectRow } from "./projectsstore";
import { activeClaudeAccountAtom, claudeIdentityAtom } from "./ratelimitstore";
import { leadRouteSeed } from "./route";
import { cancelRun, channelOverrideAtom, loadResolvedProfile, resolvedProfileAtom } from "./runactions";
import { launchBlocker, type RunShape } from "./runconfig";
import {
    autonomousAtom,
    hydrateRunConfigFromProfile,
    lightReviewerRouteAtom,
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
import { agentProject } from "./runlineage";
import { RuntimeMark } from "./runtimemark";
import { sessionKey } from "./sessionsruns";
import { setupTabAtom } from "./setupstore";
import { pickerOrder } from "./toolsmodel";
import { loadTools, openTool, pinnedToolsAtom, toolsErrorAtom, toolsStatusAtom } from "./toolsstore";
import { newAgentRamWarning } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// Tab's stops, in DOM order; the close button is tabIndex -1 because Esc does the same
const FOCUSABLE =
    'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

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
    if (id === "tool") {
        return <Wrench size={15} strokeWidth={1.8} className="text-ink-mid" />;
    }
    if (id === "council") {
        return <Users size={15} strokeWidth={1.8} className="text-ink-mid" />;
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
    const rememberedTool = useAtomValue(launcherToolAtom);
    const toolStatuses = useAtomValue(toolsStatusAtom);
    const toolsError = useAtomValue(toolsErrorAtom);
    const pinnedTools = useAtomValue(pinnedToolsAtom);
    const task = useAtomValue(launcherTaskAtom);
    const goal = useAtomValue(launcherGoalAtom);
    const prototype = useAtomValue(launcherPrototypeAtom);
    const worktreeOn = useAtomValue(launcherWorktreeAtom);
    const branchPick = useAtomValue(launcherBranchAtom);
    const sessions = useAtomValue(launcherSessionsAtom);
    const found = useAtomValue(launcherFoundAtom);
    const resumeId = useAtomValue(launcherResumeAtom);
    const images = useAtomValue(launcherImagesAtom);
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
    const autonomous = useAtomValue(autonomousAtom);
    const lightReviewerRoute = useAtomValue(lightReviewerRouteAtom);
    const reviewerRoute = useAtomValue(reviewerRouteAtom);
    const runRoute = useAtomValue(runRouteAtom);
    const routeTouched = useAtomValue(routeTouchedAtom);
    const cap = useWorkerCapacity();
    const [zone, setZone] = useState<"start" | "project" | "tools" | null>(null);
    // the Start column is open beside Project, not folded into its chip; folded on every opening
    const [startOpen, setStartOpen] = useState(false);
    const [filter, setFilter] = useState("");
    const [home, setHome] = useState("");
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const startRef = useRef<HTMLDivElement>(null);
    const projectRef = useRef<HTMLDivElement>(null);
    const toolListRef = useRef<HTMLDivElement>(null);
    const goalRef = useRef<HTMLTextAreaElement>(null);
    const taskRef = useRef<HTMLTextAreaElement>(null);
    const planRef = useRef<HTMLInputElement>(null);

    const startList = useMemo(() => startRows(harnesses), [harnesses]);
    const runtime = agentRuntime(startList, remembered);
    const selectedRow = selectedRowId(kind, runtime, shape);
    const isRun = kind === "run";
    const isTool = kind === "tool";
    const isAgent = kind === "agent";
    const isCouncil = kind === "council";
    // the Tool list: pinned first, then the rest installed, yours, a couple not installed (toolsmodel pickerOrder); null
    // until the first status read lands
    const toolList = useMemo(
        () => (toolStatuses == null ? null : pickerOrder(toolStatuses, pinnedTools)),
        [toolStatuses, pinnedTools]
    );
    const tool = toolList == null ? null : pickedTool(toolList, rememberedTool);
    const toolLoad = toolStatuses != null ? "ready" : toolsError != null ? "error" : "loading";
    const candidates = useMemo(() => recentFirst(rows, recent), [rows, recent]);
    const visible = filterProjects(candidates, filter);
    const homeShown = homeOffered(kind, runtime, home);
    const picks = projectColumnPicks(visible, homeShown, filter);
    // Home is picked only by hand: when it is not on offer, the pick falls back to a registered project
    const atHome = homeShown && pickedName === HOME_PICK;
    const project: ProjectRow | null = atHome
        ? { name: HOME_NAME, path: home }
        : selectedProject(candidates, pickedName);
    const pickKey = atHome ? HOME_PICK : (project?.name ?? "");
    const projectPath = project?.path ?? "";
    // A tool opens in the picked project, or Home when Home is picked or the tool lives there; the others open in the
    // project. `where` is the folder the launch lands in.
    const toolAtHome = atHome || tool?.opensin === "home";
    // a pinned app runs in its own folder: the Project column picks nothing for it, so it reads as not in use
    const ownFolder = isTool && !!tool?.dir?.trim();
    const folder = isTool ? toolFolder(tool, project, home) : project;
    const where = isTool ? folder : project;
    const { currentBranch, branches } = useProjectBranches(
        open && !isRun && !isCouncil && !(isTool ? toolAtHome : atHome),
        isTool ? (folder?.path ?? "") : projectPath,
        isAgent && runtimeSupportsWorktree(runtime)
    );
    const branchNames = branches.map((b) => b.name);
    // the sessions this agent and project offer, and the one picked (a pick no longer on offer launches nothing)
    const choices = resumeChoices(sessions, runtime, projectPath);
    // a row found by the Resume list's search can be older than every loaded page, and still resumes
    const scopeKey = resumeScopeKey(runtime, projectPath);
    const foundHere = found != null && found.key === scopeKey ? found.sessions : [];
    const resume = isAgent ? pickedResume(appendPage(choices, foundHere), resumeId) : null;
    // a resumed session keeps its own folder, so the worktree option is neither shown nor applied
    const wantsWorktree = isAgent && !atHome && resume == null && worktreeOn && runtimeSupportsWorktree(runtime);
    const chosenBranch = (branchPick ?? currentBranch).trim();
    // git can't reuse the checked-out branch for a worktree; branch a fresh one off it instead
    const landingBranch = chosenBranch === currentBranch ? deriveBranch(currentBranch, branchNames) : chosenBranch;
    // only a tool's footer names the branch; an agent's names the account alone
    const branchNote = isTool && !toolAtHome && currentBranch ? `on ${currentBranch}` : "";
    const blocker = isRun
        ? launchBlocker({ shape, start, goal, planPath, preview })
        : isTool
          ? toolBlocker(tool, toolLoad)
          : null;
    const activeAccount = useAtomValue(activeClaudeAccountAtom);
    const claudeIdentity = useAtomValue(claudeIdentityAtom);
    const footer = footerLine({
        kind,
        shape,
        parallelism,
        project: where,
        branchNote,
        blocker,
        account: isAgent && runtime === "claude" ? launchAccountName(activeAccount, claudeIdentity) : "",
    });
    const config: RunConfig = {
        shape,
        parallelism,
        workerRoute,
        start,
        planPath,
        reviewerPicks,
        reviewerRoute,
        lightReviewerRoute,
        prototype,
        autonomous,
    };
    // the project's own channel is where its profile lives; null while the channel list is still loading
    const target = isRun && project != null ? resolveChannelTarget(channels, project.name, project.path) : null;
    const pickedOid = target?.kind === "existing" ? target.oid : null;
    const rawRoute = (pickedOid != null ? overrides[pickedOid]?.route : null) ?? pref.route ?? null;
    // a lead picker never seeds a runtime that cannot lead; memoized, since the seed effect keys on it and a
    // fallback route is a fresh object each call
    const profileRoute = useMemo(() => leadRouteSeed(rawRoute, harnesses), [rawRoute, harnesses]);
    // a tool is a terminal running one program, and a council's Setup starts nothing: neither asks for room
    const ramWarning =
        isTool || isCouncil
            ? null
            : isRun
              ? shape === "quick"
                  ? newAgentRamWarning(cap, "run", "worker")
                  : null
              : newAgentRamWarning(cap, runtime);
    // an image still being written has no path to send yet; one that failed does not hold the launch
    const imagesWriting = isAgent && imagesPending(images);
    const primaryDisabled = where == null || blocker != null || busy || imagesWriting;
    // the list the third column holds, which → from Project steps into
    const thirdList: "resume" | "tools" | null =
        isAgent && !atHome && runtime !== "terminal" && choices.length > 0 ? "resume" : isTool ? "tools" : null;
    // what an Escape closes first: a popover only while it is drawn (a branch list with no branches draws nothing)
    const flagMenuShown = isAgent && flagMenuOpen && RUNTIME_FLAGS[runtime].length > 0;
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

    // every opening starts with Start folded and focus on the Project column, so letters filter the projects and a digit
    // picks one. ModalShell's own focus effect runs first (a child's effects do), so this one wins.
    useEffect(() => {
        if (open) {
            projectRef.current?.focus();
        } else {
            setStartOpen(false);
        }
    }, [open]);

    // the chip and ← from Project open the Start column to step into it
    useEffect(() => {
        if (startOpen) {
            startRef.current?.focus();
        }
    }, [startOpen]);

    // the Start column scrolls inside the band, so the row ↑↓ picked stays in sight
    useEffect(() => {
        startRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    }, [selectedRow, startOpen]);

    // home names Home's folder in its tooltip, and offers Home only once it is known (homeOffered)
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

    // the Resume list's first page is read once per open and per runtime or project switch, and the last list is dropped
    // first so a stale one never flashes
    useEffect(() => {
        if (open) {
            globalStore.set(launcherSessionsAtom, null);
            if (scopeKey !== "") {
                fireAndForget(() => loadLauncherSessions(runtime, projectPath));
            }
        }
    }, [open, runtime, projectPath]);

    // a prefill can also arrive while the dialog is already open, so it is a dependency too
    useEffect(() => {
        if (open && prefill != null) {
            applyLauncherPrefill(rows.map((r) => r.name));
        }
    }, [open, rows, prefill]);

    // Opened without a project of its own, the dialog starts on the project of the agent or terminal in focus on the
    // Agent surface. A prefill names its own, an open given a project (a project's Overview) names it too, and a kept
    // draft keeps the project it was written for. Once per open, when the project list is there (it may arrive after the
    // open, with the prefill's effect above).
    const focusPickRef = useRef(false);
    useEffect(() => {
        focusPickRef.current = open;
    }, [open]);
    useEffect(() => {
        if (!open || !focusPickRef.current || rows.length === 0) {
            return;
        }
        focusPickRef.current = false;
        if (
            prefill != null ||
            restored ||
            globalStore.get(launcherOwnProjectAtom) != null ||
            globalStore.get(model.surfaceAtom) !== "agent"
        ) {
            return;
        }
        const id = globalStore.get(model.focusIdAtom);
        const agents = globalStore.get(model.agentsAtom);
        const focused = [...agents, ...globalStore.get(model.terminalsAtom)].find((a) => a.id === id);
        const name = focused ? agentProject(globalStore.get(model.lineageAtom), agents, focused) : "";
        const names = rows.map((r) => r.name);
        const pick = focusLaunchProject(name, names);
        if (pick != null) {
            pickLauncherProject(pick, globalStore.get(launcherProjectAtom));
        }
    }, [open, rows, prefill, restored, model]);

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

    // a Tool pick lists the tools as the dialog opens: one installed since the last read should be there
    useEffect(() => {
        if (open && isTool) {
            fireAndForget(loadTools);
        }
    }, [open, isTool]);

    useEffect(() => {
        setError(null);
    }, [kind, runtime, project?.name, tool?.id]);

    useEffect(() => {
        projectRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    }, [pickKey, filter]);

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
        if (row.kind === "tool" || row.kind === "council") {
            globalStore.set(launcherKindAtom, row.kind);
            return;
        }
        globalStore.set(launcherKindAtom, "agent");
        pickLauncherRuntime(row.id as Runtime);
    };

    // the Start column folds back into its chip and focus returns to Project; moving focus there is enough while the
    // column has it (its blur folds it), and the state is set too for an Escape from elsewhere
    const foldStart = () => {
        projectRef.current?.focus();
        setStartOpen(false);
    };

    const pickProject = (key: string) => pickLauncherProject(key, pickKey);

    const applyFilter = (next: string) => {
        setFilter(next);
        const matches = projectColumnPicks(filterProjects(candidates, next), homeShown, next).map((name) => ({ name }));
        pickProject(projectAfterFilter(matches, pickKey));
    };

    const register = () => {
        close();
        globalStore.set(model.newProjectOpenAtom, true);
    };

    // the session read back on the Agent surface, where its own Resume button is one click away
    const viewTranscript = (s: SessionInfo) => {
        close();
        showSession(model, sessionKey(s));
    };

    // Open asleep: the picked session on the roster with its transcript and a box to wake it, its process not started
    // (asleepLaunchMeta). The Task is not sent: what was typed stays in the dialog for a later New.
    const launchAgentRow = async (p: ProjectRow, asleep = false) => {
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
        // the task with its images: codex starting fresh takes them as --image after the prompt, the rest as a block
        const { task: fullTask, extraArgs } = composeTaskWithImages(
            runtime,
            runtimeShowsTask(runtime) && !asleep ? task : "",
            images.flatMap((i) => (i.path ? [i.path] : [])),
            resume != null
        );
        // a resume replaces the command (and, for pi, the argv and the transcript to preflight)
        const spec = resume
            ? resumeLaunchSpec(resume, runtime, naFlags[runtime] ?? {})
            : {
                  startupCommand: composeStartupCommand(
                      commands[runtime] ?? runtimeStartupCommand(runtime),
                      runtime,
                      naFlags[runtime] ?? {}
                  ),
              };
        if (atHome && runtime === "claude") {
            spec.startupCommand = askStartupCommand(spec.startupCommand);
        }
        try {
            await launchAgent(model, {
                runtime,
                task: fullTask,
                extraArgs,
                projectPath: p.path,
                projectName: p.name,
                branch,
                ...spec,
                ...(resume ? { resumeOf: resume.transcriptpath } : {}),
                ...(asleep && resume
                    ? { asleep: { since: resume.lastactivets, transcriptPath: resume.transcriptpath } }
                    : {}),
            });
            // Remember off: flags are single-use, cleared for the next agent
            if (!globalStore.get(naRememberFlagsAtom)) {
                globalStore.set(naFlagsAtom, {});
            }
            // Home is no project, so it never takes a project's place in last used first
            if (!atHome) {
                noteRecentProject(p.name);
            }
            if (!asleep || task.trim() === "") {
                endLauncherDraft();
            }
            close();
        } catch (e) {
            setError(String(e));
        } finally {
            endLauncherLaunch();
        }
    };

    // the footer's second button for a picked session: Open asleep for an agent that can sleep, the transcript for one
    // that cannot (codex has no resume to wake into)
    const canOpenAsleep = resume != null && SLEEPABLE_AGENTS.has(runtime);
    const resumeSecondary = (s: SessionInfo) => {
        if (!canOpenAsleep) {
            viewTranscript(s);
            return;
        }
        if (project == null || imagesWriting) {
            return;
        }
        void launchAgentRow(project, true);
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
            // read before close(), which drops it: only a start the dialog was still open for belongs to its caller
            const onStarted = takeLauncherOnStarted();
            endLauncherLaunch();
            endLauncherDraft();
            close();
            // A caller that filled the dialog (a brainstorm's Approve) hears the run's id and follows the run itself, so
            // the person stays where they are; any other start lands on the run. Landing reports its own failures
            // (openTarget toasts); holding the dialog over a run that is already running would read as a failed launch
            if (handBackStartedRun(onStarted, started.run.id) === "land") {
                await openTarget(model, { kind: "channel", channelId: started.channelId, runId: started.run.id });
            }
        });
    };

    // A tool takes the centre, as an agent launch does. The folder is the project's (the tool's own "opens in" aside, see
    // toolFolder); Home is no registered project, so it goes by its name and openTool resolves the home folder itself.
    const openPickedTool = async (t: ToolStatus, p: { name: string }) => {
        if (!beginLauncherLaunch()) {
            return;
        }
        setError(null);
        try {
            const res = await openTool(model, t, { project: toolAtHome ? HOME_NAME : p.name, place: "centre" });
            if ("reason" in res) {
                setError(res.reason);
                return;
            }
            // Home takes no project's place in last used first
            if (!toolAtHome) {
                noteRecentProject(p.name);
            }
            close();
        } catch (e) {
            setError(String(e));
        } finally {
            endLauncherLaunch();
        }
    };

    // All tools in Setup: the library tab, over the dialog it was opened from (the draft is kept, as in any close)
    const openToolLibrary = () => {
        close();
        globalStore.set(setupTabAtom, "tools");
        globalStore.set(model.surfaceAtom, "setup");
    };

    const launch = () => {
        if (where == null) {
            return;
        }
        // Enter and Mod+Enter reach here as well as the button, which is disabled while an image is still writing
        if (imagesWriting) {
            return;
        }
        if (isCouncil) {
            // Setup is where the council is written and started, in the Agent surface's centre
            close();
            showCouncilSetup(where.path, undefined, model);
            return;
        }
        if (isTool) {
            // a tool that is not on PATH says why in the footer; the button is disabled and Enter does nothing
            if (blocker == null && tool != null) {
                void openPickedTool(tool, where);
            }
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
        if (target === toolListRef.current) {
            return "tools";
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
        // the box a letter typed in the Start column starts: an agent's Task, or a run's Goal (none for a terminal, a
        // tool, a council, or a run from a plan file)
        const textField = isTool || isCouncil ? null : isRun ? goalRef.current : taskRef.current;
        const action = launcherKey(
            {
                zone: zoneOf(e.target),
                startOpen,
                startCount: startList.length,
                projectCount: visible.length,
                homeShown: picks.includes(HOME_PICK),
                third: thirdList,
                toolCount: isTool && toolList != null ? toolList.length : 0,
                filter,
                flagMenuOpen: flagMenuShown,
                branchListOpen: branchListShown,
                resumePicked: resume != null,
                textField: textField != null,
            },
            {
                key: e.key,
                shift: e.shiftKey,
                mod,
                paste:
                    ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v") ||
                    (e.shiftKey && !mod && e.key === "Insert"),
            }
        );
        if (action.kind === "none") {
            return;
        }
        if (action.kind === "write") {
            // no preventDefault: the key (or the paste) lands in the box focus moved to, after what is already there, so
            // a Telex or IME edit that follows applies to it
            const end = textField.value.length;
            textField.focus();
            textField.setSelectionRange(end, end);
            return;
        }
        e.preventDefault();
        switch (action.kind) {
            case "pick-start":
                pickRow(startList[action.index]);
                foldStart();
                return;
            case "pick-project":
                pickProject(visible[action.index].name);
                return;
            case "pick-home":
                pickProject(HOME_PICK);
                return;
            case "pick-tool": {
                const picked = toolList?.[action.index];
                if (picked != null) {
                    pickLauncherTool(picked.id);
                }
                return;
            }
            case "move": {
                if (action.column === "start") {
                    const at = startList.findIndex((r) => r.id === selectedRow);
                    pickRow(startList[stepIndex(startList.length, at, action.delta)]);
                    return;
                }
                if (action.column === "tools") {
                    const list = toolList ?? [];
                    const next = stepIndex(
                        list.length,
                        list.findIndex((t) => t.id === tool?.id),
                        action.delta
                    );
                    if (next >= 0) {
                        pickLauncherTool(list[next].id);
                    }
                    return;
                }
                const next = stepIndex(picks.length, picks.indexOf(pickKey), action.delta);
                if (next >= 0) {
                    pickProject(picks[next]);
                }
                return;
            }
            case "column":
                if (action.to === "start") {
                    // a folded Start column opens first; the effect on startOpen focuses it once it is drawn
                    if (startOpen) {
                        startRef.current?.focus();
                    } else {
                        setStartOpen(true);
                    }
                } else if (action.to === "project") {
                    projectRef.current?.focus();
                } else if (thirdList === "tools") {
                    toolListRef.current?.focus();
                } else {
                    rootRef.current
                        ?.querySelector<HTMLElement>('[data-launcher-resume] [role="radio"][tabindex="0"]')
                        ?.focus();
                }
                return;
            case "filter":
                applyFilter(action.next);
                return;
            case "launch":
                launch();
                return;
            case "resume-secondary":
                if (resume != null) {
                    resumeSecondary(resume);
                }
                return;
            case "dismiss-inner":
                // the inner thing takes this Escape; ModalShell's would close the dialog
                e.stopPropagation();
                if (action.what === "flags") {
                    globalStore.set(launcherFlagMenuAtom, false);
                } else if (action.what === "branches") {
                    globalStore.set(launcherBranchListAtom, false);
                } else if (action.what === "filter") {
                    applyFilter("");
                } else if (action.what === "start") {
                    foldStart();
                }
                return;
            case "fold":
                // Enter keeps the row ↑↓ already picked
                foldStart();
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
    const toolsFocused = zone === "tools";
    // the order, not a key: the folded Project column is too narrow for the count beside it
    let projectHint = "";
    if (candidates.length > 9 && startOpen) {
        projectHint = `${candidates.length} · last used first`;
    } else if (candidates.length > 1) {
        projectHint = "last used first";
    }
    const startPick = startList.find((r) => r.id === selectedRow);

    const renderStartRow = (row: StartRow) => {
        const selected = row.id === selectedRow;
        return (
            <div
                key={row.id}
                role="radio"
                aria-checked={selected}
                data-start-row={row.id}
                title={row.desc ?? undefined}
                onClick={() => {
                    pickRow(row);
                    foldStart();
                }}
                className={cn(rowTone(selected, startFocused), "shrink-0 gap-[9px] py-2")}
            >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <StartMark id={row.id} />
                </span>
                <span
                    className={cn(
                        "min-w-0 flex-1 truncate text-[12.5px] font-semibold",
                        selected ? "text-primary" : "text-muted-foreground"
                    )}
                >
                    {row.name}
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
            className="flex max-h-[86vh] w-[min(840px,93vw)] flex-col"
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
                    {/* The band keeps 360px folded or open, so nothing below it moves: folded, the chip line and two
                        columns (Project, then the pick's own list taking the rest); open, the chip gives way to the
                        Start column and the three columns fill it. Each column scrolls inside it. The Start column
                        sits in a slot of its own, so Project and the third column stay mounted (and focused) across
                        a fold. */}
                    <div className="flex h-[360px] shrink-0 flex-col border-b border-border">
                        {startOpen ? null : (
                            <div className="flex h-[38px] shrink-0 items-center border-b border-border px-[10px]">
                                <button
                                    type="button"
                                    data-launcher-chip={selectedRow}
                                    aria-expanded={false}
                                    title="Change what starts"
                                    onClick={() => setStartOpen(true)}
                                    className="flex h-[26px] cursor-pointer items-center gap-[7px] rounded-[7px] border border-edge-mid bg-surface px-2 text-[12.5px] font-semibold text-primary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
                                >
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                        <StartMark id={selectedRow} />
                                    </span>
                                    {startPick?.name ?? selectedRow}
                                    <ChevronDown size={12} strokeWidth={2.2} className="text-muted" />
                                </button>
                            </div>
                        )}
                        <div
                            className={cn(
                                "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]",
                                startOpen
                                    ? "grid-cols-[236px_minmax(0,1fr)_minmax(0,1fr)]"
                                    : "grid-cols-[172px_minmax(0,1fr)]"
                            )}
                        >
                            {startOpen ? (
                                <div
                                    ref={startRef}
                                    role="radiogroup"
                                    aria-label="Start"
                                    tabIndex={0}
                                    data-launcher-column="start"
                                    onFocus={() => setZone("start")}
                                    onBlur={(e) => {
                                        setZone(null);
                                        // Tab, →, a click on another column or a typed letter moving to the Task box:
                                        // focus leaving the column folds it, with or without a pick
                                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                            setStartOpen(false);
                                        }
                                    }}
                                    className="flex min-h-0 flex-col gap-px overflow-y-auto border-r border-border px-2 py-3 outline-none"
                                >
                                    <ColumnLabel label="Agent" focused={startFocused} />
                                    {startList.filter((r) => r.kind === "agent").map(renderStartRow)}
                                    <ColumnLabel label="Run" focused={startFocused} className="pt-[10px]" />
                                    {startList.filter((r) => r.kind === "run").map(renderStartRow)}
                                    <ColumnLabel label="Tool" focused={startFocused} className="pt-[10px]" />
                                    {startList.filter((r) => r.kind === "tool").map(renderStartRow)}
                                    <ColumnLabel label="Council" focused={startFocused} className="pt-[10px]" />
                                    {startList.filter((r) => r.kind === "council").map(renderStartRow)}
                                </div>
                            ) : null}
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
                                className="relative min-w-0 border-r border-border outline-none"
                            >
                                <div className="absolute inset-0 flex flex-col px-2 py-3">
                                    <ColumnLabel
                                        label="Project"
                                        focused={projectFocused}
                                        hint={ownFolder ? "" : projectHint}
                                    />
                                    {ownFolder ? (
                                        <div
                                            data-launcher-project-unused
                                            className="px-2 pb-2 text-[11.5px] leading-normal text-muted"
                                        >
                                            Not used: {tool!.name} runs in its own folder.
                                        </div>
                                    ) : null}
                                    {filter !== "" ? (
                                        <FilterLine
                                            query={filter}
                                            shown={visible.length}
                                            total={candidates.length}
                                            attr="data-launcher-filter"
                                        />
                                    ) : null}
                                    {candidates.length === 0 ? (
                                        <div className="flex flex-col items-start gap-2.5 px-2 py-1">
                                            <span
                                                data-launcher-empty
                                                className="text-[12.5px] leading-normal text-ink-mid"
                                            >
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
                                    ) : null}
                                    {candidates.length > 0 || picks.length > 0 ? (
                                        <>
                                            <div
                                                className={cn(
                                                    "flex min-h-0 flex-1 flex-col gap-px overflow-y-auto",
                                                    ownFolder && "opacity-40"
                                                )}
                                            >
                                                {visible.map((p) => {
                                                    const selected = p.name === pickKey;
                                                    return (
                                                        <div
                                                            key={p.name}
                                                            role="radio"
                                                            aria-checked={selected}
                                                            data-project-row={p.name}
                                                            title={p.path}
                                                            onClick={() => pickProject(p.name)}
                                                            className={cn(
                                                                rowTone(selected, projectFocused),
                                                                "shrink-0 gap-[10px] py-2"
                                                            )}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    "min-w-0 flex-1 truncate text-[12.5px] font-semibold",
                                                                    selected ? "text-primary" : "text-muted-foreground"
                                                                )}
                                                            >
                                                                {p.name}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                                {picks.length === 0 && filter !== "" ? (
                                                    <span
                                                        data-launcher-nomatch
                                                        className="px-2 py-1.5 text-[12px] text-muted"
                                                    >
                                                        No project matches “{filter}”. Esc clears the filter.
                                                    </span>
                                                ) : null}
                                            </div>
                                            {picks.includes(HOME_PICK) ? (
                                                <>
                                                    {visible.length > 0 ? (
                                                        <div
                                                            aria-hidden
                                                            className="mx-2 my-1 h-px shrink-0 bg-border"
                                                        />
                                                    ) : null}
                                                    {/* pinned under the list, and 0 in place of a digit, so a project added
                                                    never moves it; its own data attribute, since Home is no registered
                                                    project and the scenarios that count data-project-row count those.
                                                    Its folder and ask-only are in the tooltip, as a project's path is */}
                                                    <div
                                                        role="radio"
                                                        aria-checked={atHome}
                                                        data-launcher-home
                                                        title={
                                                            runtime === "claude"
                                                                ? `${home}: no project. Claude Code starts ask-only under ~/.arc/claude-ask.json.`
                                                                : `${home}: no project.`
                                                        }
                                                        onClick={() => pickProject(HOME_PICK)}
                                                        className={cn(
                                                            rowTone(atHome, projectFocused),
                                                            "shrink-0 gap-[10px] py-2",
                                                            ownFolder && "opacity-40"
                                                        )}
                                                    >
                                                        <House
                                                            size={13}
                                                            strokeWidth={2}
                                                            className={cn(
                                                                "shrink-0",
                                                                atHome ? "text-primary" : "text-muted"
                                                            )}
                                                        />
                                                        <span
                                                            className={cn(
                                                                "min-w-0 flex-1 truncate text-[12.5px] font-semibold",
                                                                atHome ? "text-primary" : "text-muted-foreground"
                                                            )}
                                                        >
                                                            {HOME_NAME}
                                                        </span>
                                                    </div>
                                                </>
                                            ) : null}
                                        </>
                                    ) : null}
                                </div>
                            </div>
                            {/* the pick's own list: an agent's sessions, the tools, or a run's model, start and width */}
                            <div data-launcher-column="third" className="relative min-w-0">
                                <div className="absolute inset-0 flex flex-col px-2 py-3">
                                    {isRun ? (
                                        <RunColumn />
                                    ) : isTool ? (
                                        <ToolList
                                            tools={toolList}
                                            error={toolsError}
                                            tool={tool}
                                            focused={toolsFocused}
                                            listRef={toolListRef}
                                            onFocus={() => setZone("tools")}
                                            onBlur={() => setZone(null)}
                                            onPick={pickLauncherTool}
                                            onAll={openToolLibrary}
                                        />
                                    ) : isCouncil ? (
                                        <>
                                            <ColumnLabel label="Council" focused={false} />
                                            <span
                                                data-launcher-council-note
                                                className="px-2 text-[12px] leading-normal text-muted"
                                            >
                                                Setup opens in the Agent surface: write what to review or brainstorm,
                                                then Start council. A council costs 0.5–1.5M tokens.
                                            </span>
                                        </>
                                    ) : thirdList === "resume" ? (
                                        <ResumeList
                                            choices={choices}
                                            scopeKey={scopeKey}
                                            pickedId={resume?.id ?? null}
                                            onBack={() => projectRef.current?.focus()}
                                        />
                                    ) : (
                                        <>
                                            <ColumnLabel label="Session" focused={false} />
                                            <span
                                                data-launcher-session-note
                                                className="px-2 text-[12px] leading-normal text-muted"
                                            >
                                                {runtime === "terminal"
                                                    ? "A plain shell has no session to resume."
                                                    : atHome
                                                      ? "Home starts a new session. Pick a project to resume one of its sessions."
                                                      : sessions == null
                                                        ? "Reading sessions…"
                                                        : "No session of this agent here yet: it starts a new one."}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
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
                        ) : isTool ? (
                            <ToolFields tool={tool} atHome={toolAtHome} />
                        ) : isCouncil ? null : (
                            <AgentFields
                                runtime={runtime}
                                currentBranch={currentBranch}
                                branches={branches}
                                ramWarning={ramWarning}
                                resume={resume}
                                home={atHome}
                                taskRef={taskRef}
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
                                title={where?.path || undefined}
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
                        {resume != null && canOpenAsleep ? (
                            <DialogButton
                                variant="secondary"
                                hint="shift+enter"
                                data-launcher-asleep
                                title="Open it asleep: its transcript in the sidebar, started when you wake it or send a message (Shift+Enter)"
                                disabled={primaryDisabled}
                                onClick={() => resumeSecondary(resume)}
                            >
                                Open asleep
                            </DialogButton>
                        ) : resume != null ? (
                            <DialogButton
                                variant="secondary"
                                hint="shift+enter"
                                data-launcher-transcript
                                title="View transcript (Shift+Enter)"
                                onClick={() => viewTranscript(resume)}
                            >
                                Transcript
                            </DialogButton>
                        ) : null}
                        {/* Enter launches from every zone but the Task box, where Mod+Enter does */}
                        <DialogButton
                            variant="primary"
                            hint="enter"
                            title={
                                isTool || isCouncil
                                    ? "Enter"
                                    : `Enter, or ${formatChordString("Cmd:Enter")} from the Task box`
                            }
                            disabled={primaryDisabled}
                            onClick={launch}
                            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
                        >
                            {busy && isRun ? "Starting…" : primaryLabel(kind, runtime, resume != null, tool?.name)}
                        </DialogButton>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}
