// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The New launcher: one dialog that starts an agent, a terminal, a run or a tool
// (docs/superpowers/specs/2026-10-08-new-launcher-design.md). It replaced the New agent dialog and the New run window.
// The pick's fields come first, its Task (or a run's Goal) box at the top with focus when the dialog opens, so an agent
// in the project you are in is type and Enter (docs/superpowers/specs/2026-10-30-new-agent-next-design.md); Shift+Enter
// is the box's newline and Alt+1–9 picks a Start row from it. Under the fields, three columns: Start picks what, Project
// where, and the third holds the pick's own list (an agent's sessions, the tools, a run's model or start and width). The
// Start column is always shown (the chip that folded it away, 2026-10-28-new-launcher-declutter-design.md D1/D7, was
// dropped 2026-10-29) and sets the band's height: a long Project, Session or Tool list scrolls inside its column, so
// the dialog keeps its height however many projects and sessions there are. Digits pick in the focused column (0 is
// Home), → and ← step between the columns, and Tab walks the dialog without leaving it; each row draws its key. A letter
// typed in a column goes to the Task or Goal box; a pick with neither (a terminal, a tool, a council, a run from a plan
// file) types it into the Project column's filter instead. Every close keeps the draft (launcherstore), which is what
// lets a click outside close it.
//
// The open state is model.launcherAtom, so deriveKeyContext counts the dialog as a modal. The app bar's one New button
// reopens it on the last pick; Mod+N and Mod+Shift+R, and the Brief's `r`, open it at the agent or the run door.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { viewFade } from "@/app/element/motiontokens";
import { DialogButton } from "@/app/modals/dialogbutton";
import { focusTrapTarget } from "@/app/modals/modalfocus";
import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { resolveChannelTarget, type NewRunPrefill, type RunConfig } from "@/app/view/jarvis/newrun";
import { homeFromInfo } from "@/app/view/jarvis/projectpicker";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    FolderMinus,
    Network,
    SquareTerminal,
    Users,
    Wrench,
    X,
    Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { centerModeAtom, overviewProjectAtom, showCouncilSetup, showSession } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { channelsAtom, primeChannels } from "./channelsstore";
import type { EditorLike } from "./chateditor";
import { RailSantaHat } from "./christmashat";
import {
    accountLaunchMeta,
    launchAccountChoices,
    launchAccountName,
    pickedLaunchAccount,
    projectLaunchAccount,
    type AccountChoice,
} from "./claudeaccount";
import {
    attachmentBlocker,
    attachmentDraftsAtom,
    composeLaunchTask,
    readyPaths,
    type Attachment,
} from "./composerattachments";
import { councilAtom, councilListAtom, councilSelAtom, councilSetupProjectAtom, councilViewAtom } from "./councilstore";
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
    councilCentreProject,
    filterProjects,
    focusLaunchProject,
    footerLine,
    HOME_NAME,
    HOME_PICK,
    homeOffered,
    launcherKey,
    launcherTitle,
    NO_FOLDER_LABEL,
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
import {
    createPeekLoader,
    PEEK_COUNT,
    PEEK_OLDER_COUNT,
    resumeStepShows,
    type PeekCursor,
    type PeekLoader,
    type PeekResult,
    type PeekState,
} from "./launcherpeek";
import { LauncherPeekPane } from "./launcherpeekpanel";
import {
    pickedResume,
    resumeChoices,
    resumeLaunchSpec,
    resumeScopeKey,
    sessionSearchable,
    sessionTitle,
} from "./launcherresume";
import { ResumeList } from "./launcherresumelist";
import { ColumnLabel, digitOf, FilterLine, Keycap, NoTaskBox, rowTone } from "./launcherrows";
import { handBack, queueLauncherRun, startLauncherRun } from "./launcherrun";
import { RunColumn, RunFields } from "./launcherrunfields";
import {
    applyLauncherPrefill,
    beginLauncherLaunch,
    clearLauncherDraft,
    closeLauncher,
    endLauncherDraft,
    endLauncherLaunch,
    LAUNCHER_DRAFT,
    launcherAccountAtom,
    launcherAccountMenuAtom,
    launcherBrainstormAtom,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherBusyAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherGoalAtom,
    launcherKindAtom,
    launcherOwnProjectAtom,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherResumeAtom,
    launcherRuntimeAtom,
    launcherSearchedAtom,
    launcherSessionsAtom,
    launcherSessionSearchAtom,
    launcherSpecPathAtom,
    launcherTaskAtom,
    launcherToolAtom,
    launcherWhenAtom,
    launcherWorktreeAtom,
    loadLauncherSessions,
    openLauncher,
    peekLauncherHandback,
    pickLauncherProject,
    pickLauncherRuntime,
    pickLauncherTool,
    takeLauncherHandback,
} from "./launcherstore";
import { ToolFields, ToolList } from "./launchertoolfields";
import { startBlocker, startLabel, waitingOn } from "./launcherwhen";
import { naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { busyLine } from "./parkedmodel";
import { parkLaunch, settleParkedLaunch, showHeld, useMachine } from "./parkedstore";
import {
    noteRecentProject,
    projectListAtom,
    projectsAtom,
    recentFirst,
    recentProjectsAtom,
    type ProjectRow,
} from "./projectsstore";
import { activeClaudeAccountAtom, claudeIdentityAtom } from "./ratelimitstore";
import { leadRouteSeed } from "./route";
import { channelOverrideAtom, loadResolvedProfile, resolvedProfileAtom } from "./runactions";
import { launchBlocker, type RunShape } from "./runconfig";
import {
    autonomousAtom,
    hydrateRunConfigFromProfile,
    lightReviewerRouteAtom,
    parallelismAtom,
    pickRunShape,
    planPathAtom,
    planPreviewAtom,
    resetRunConfigForChannel,
    reviewerPicksAtom,
    reviewerRouteAtom,
    routeTouchedAtom,
    runRouteAtom,
    runShapeAtom,
    startAtom,
    workerRouteAtom,
} from "./runconfigstore";
import { agentProject } from "./runlineage";
import { RuntimeMark } from "./runtimemark";
import { useSessionSearch } from "./sessionsearchstore";
import { sessionKey } from "./sessionsruns";
import { setupTabAtom } from "./setupstore";
import { startingTitle } from "./startingrunsmodel";
import { startRunInBackground } from "./startingrunsstore";
import { pickerOrder } from "./toolsmodel";
import { loadTools, openTool, pinnedToolsAtom, toolsErrorAtom, toolsStatusAtom } from "./toolsstore";
import { newAgentRamWarning } from "./workercapacity";
import { useWorkerCapacity } from "./workercapacitystore";

// Tab's stops, in DOM order; the close button is tabIndex -1 because Esc does the same, and the Task row's buttons and
// the draft's Clear are tabIndex -1 because they are for the pointer
const NO_ATTACHMENTS: Attachment[] = [];

// the Task box is the editor's contenteditable (promptbox.ts), not a textarea
const FOCUSABLE =
    'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"], [contenteditable="true"]';

// the Task box's editable element (or a node in it): the editor's handle is no DOM element to compare a target with
const inTaskBox = (target: EventTarget): boolean =>
    target instanceof Element && target.closest("[data-launcher-task]") != null;

// the resume step's agent and project in the title, each a way back to its column
const CRUMB =
    "flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border border-edge-mid bg-surface-raised px-2 text-[12.5px] font-medium text-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-primary";

// the project path of the council the centre shows, read as showCouncil reads it: its own atom, else the list of all
function shownCouncilProject(): string | undefined {
    const id = globalStore.get(councilSelAtom);
    if (id == null) {
        return undefined;
    }
    return (globalStore.get(councilAtom(id)) ?? globalStore.get(councilListAtom(""))?.find((c) => c.id === id))
        ?.project;
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

// The footer of a claude launch with accounts to pick: its account, a click away from a menu of the others. The pick is
// for this launch only; Settings → Claude account sets the active one, a project's settings its own.
function AccountPicker({
    choices,
    current,
    active,
    projectOwn,
    label,
    open,
}: {
    choices: AccountChoice[];
    current: string;
    active: string;
    projectOwn: string | null;
    label: string;
    open: boolean;
}) {
    const setOpen = (v: boolean) => globalStore.set(launcherAccountMenuAtom, v);
    return (
        <div
            className="relative min-w-0 flex-1"
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setOpen(false);
                }
            }}
        >
            <button
                type="button"
                tabIndex={-1}
                data-launcher-footer="account"
                aria-haspopup="menu"
                aria-expanded={open}
                title="Run this agent on another Claude account"
                onClick={() => setOpen(!open)}
                className={cn(
                    "-ml-1.5 flex max-w-full cursor-pointer items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[12px]",
                    open ? "bg-accentbg text-accent-soft" : "text-muted hover:bg-surface-hover hover:text-primary"
                )}
            >
                <span className="truncate">{label}</span>
                <ChevronDown size={12} strokeWidth={2} className="shrink-0" />
            </button>
            {open ? (
                <div
                    role="menu"
                    data-launcher-account-menu
                    className="absolute bottom-full left-0 z-10 mb-1 flex min-w-[220px] max-w-[320px] flex-col rounded-[10px] border border-edge-mid frost p-1 shadow-popover"
                >
                    {choices.map((c) => {
                        const on = c.id === current;
                        const note = c.id === projectOwn ? "project" : c.id === active ? "active" : "";
                        return (
                            <button
                                key={c.pick}
                                type="button"
                                role="menuitemradio"
                                aria-checked={on}
                                tabIndex={-1}
                                onClick={() => {
                                    globalStore.set(launcherAccountAtom, c.pick);
                                    setOpen(false);
                                }}
                                className={cn(
                                    "flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-[6px] text-left text-[12.5px]",
                                    on ? "bg-accentbg text-accent-soft" : "text-primary hover:bg-surface-hover"
                                )}
                            >
                                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                {note ? <span className="shrink-0 text-[11px] text-muted">{note}</span> : null}
                                <Check size={13} strokeWidth={2} className={cn("shrink-0", on ? "" : "invisible")} />
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}

// The columns band's last measured height, which the resume step takes. Kept past a close and across launches, so a
// dialog that opens on the step already has it; per viewer and best-effort, so storage that throws only loses it.
const BAND_HEIGHT_KEY = "launcher.bandHeight";

function rememberedBandHeight(): number | null {
    try {
        const n = Number(localStorage.getItem(BAND_HEIGHT_KEY));
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
}

function rememberBandHeight(h: number): void {
    try {
        localStorage.setItem(BAND_HEIGHT_KEY, String(h));
    } catch {
        // the step falls back to its own height
    }
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
    const specPath = useAtomValue(launcherSpecPathAtom);
    const brainstorm = useAtomValue(launcherBrainstormAtom);
    const when = useAtomValue(launcherWhenAtom);
    const worktreeOn = useAtomValue(launcherWorktreeAtom);
    const branchPick = useAtomValue(launcherBranchAtom);
    const sessions = useAtomValue(launcherSessionsAtom);
    const resumeId = useAtomValue(launcherResumeAtom);
    // the Task box's chips (promptbox.ts), kept under LAUNCHER_DRAFT so a close keeps them and the launch reads them here
    const attachments = useAtomValue(attachmentDraftsAtom).get(LAUNCHER_DRAFT) ?? NO_ATTACHMENTS;
    const searchedSession = useAtomValue(launcherSearchedAtom);
    const sessionSearchBox = useAtomValue(launcherSessionSearchAtom);
    const commands = useAtomValue(launcherCommandAtom);
    const naFlags = useAtomValue(naFlagsAtom);
    const restored = useAtomValue(launcherRestoredAtom);
    const busy = useAtomValue(launcherBusyAtom);
    const prefill = useAtomValue(launcherPrefillAtom);
    const flagMenuOpen = useAtomValue(launcherFlagMenuAtom);
    const branchListOpen = useAtomValue(launcherBranchListAtom);
    const accountPick = useAtomValue(launcherAccountAtom);
    const accountMenuOpen = useAtomValue(launcherAccountMenuAtom);
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
    const [zone, setZone] = useState<"start" | "project" | "tools" | "task" | null>(null);
    const [filter, setFilter] = useState("");
    // the Project column's search box: it holds `filter`, and goes with it when focus leaves the column
    const [projectSearch, setProjectSearch] = useState(false);
    const [home, setHome] = useState("");
    // the No folder path, created and trusted for Claude Code by wavesrv; "" until it answers, which keeps the row hidden
    const [noFolder, setNoFolder] = useState("");
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const startRef = useRef<HTMLDivElement>(null);
    const projectRef = useRef<HTMLDivElement>(null);
    const toolListRef = useRef<HTMLDivElement>(null);
    const goalRef = useRef<HTMLTextAreaElement>(null);
    const taskRef = useRef<EditorLike>(null);
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
    const homeShown = homeOffered(kind, runtime, noFolder);
    const picks = projectColumnPicks(visible, homeShown, filter);
    // Home is picked only by hand: when it is not on offer, the pick falls back to a registered project
    const atHome = homeShown && pickedName === HOME_PICK;
    const project: ProjectRow | null = atHome
        ? { name: HOME_NAME, path: noFolder }
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
    const scopeKey = resumeScopeKey(runtime, projectPath);
    // a session the Session column's search found can be the pick though no loaded page holds it
    const resume = isAgent ? pickedResume(choices, resumeId, searchedSession, scopeKey) : null;
    // The Session column's content search, asked here and not in the list: picking a Claude session draws the list again
    // inside the resume step, and its answer must survive that. Nothing is asked while the box is closed or empty.
    const sessionSearchOn = isAgent && sessionSearchable(runtime);
    const sessionAnswer = useSessionSearch(sessionSearchOn && sessionSearchBox.open ? sessionSearchBox.query : "", {
        runtime,
        projectPath,
    });
    // a resumed session keeps its own folder, so the worktree option is neither shown nor applied
    const wantsWorktree = isAgent && !atHome && resume == null && worktreeOn && runtimeSupportsWorktree(runtime);
    const chosenBranch = (branchPick ?? currentBranch).trim();
    // git can't reuse the checked-out branch for a worktree; branch a fresh one off it instead
    const landingBranch = chosenBranch === currentBranch ? deriveBranch(currentBranch, branchNames) : chosenBranch;
    // only a tool's footer names the branch; an agent's names the account alone
    const branchNote = isTool && !toolAtHome && currentBranch ? `on ${currentBranch}` : "";
    // a run's own blocker comes first; After with no run ticked has nothing to wait for (launcherwhen.ts). An agent waits
    // on a file still being attached, and on one that failed, as Chat's Send does: sending past it would drop the file
    // without a word. A terminal sends no task, so what a pick of an agent left in the box never holds it.
    const blocker = isRun
        ? (launchBlocker({ shape, start, goal, planPath, preview }) ?? startBlocker(when))
        : isTool
          ? toolBlocker(tool, toolLoad)
          : isAgent && runtimeShowsTask(runtime)
            ? attachmentBlocker(attachments)
            : null;
    const activeAccount = useAtomValue(activeClaudeAccountAtom);
    const claudeIdentity = useAtomValue(claudeIdentityAtom);
    const registry = useAtomValue(projectsAtom);
    // a claude launch runs on its project's account, else the active one, unless the footer picks another for it
    const claudeLaunch = isAgent && runtime === "claude";
    const accountChoices = claudeLaunch ? launchAccountChoices(claudeIdentity) : [];
    const usualAccount = projectLaunchAccount(
        activeAccount,
        atHome ? undefined : registry[project?.name ?? ""]?.claudeaccount,
        claudeIdentity.accounts
    );
    const launchAccount = pickedLaunchAccount(accountPick, accountChoices, usualAccount);
    const accountMenuShown = accountMenuOpen && accountChoices.length > 1;
    const footer = footerLine({
        kind,
        shape,
        parallelism,
        project: where,
        branchNote,
        blocker,
        account: claudeLaunch ? launchAccountName(launchAccount, claudeIdentity) : "",
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
    // the pick has a box a typed letter starts: an agent's Task (a terminal has none) or a run's Goal (a run from a plan
    // file has none). With no box, letters filter the Project column.
    const hasTextBox =
        !isTool && !isCouncil && (isRun ? !(shape === "orchestrator" && start === "plan") : runtimeShowsTask(runtime));
    // the project's own channel is where its profile lives; null while the channel list is still loading
    const target = isRun && project != null ? resolveChannelTarget(channels, project.name, project.path) : null;
    const pickedOid = target?.kind === "existing" ? target.oid : null;
    const rawRoute = (pickedOid != null ? overrides[pickedOid]?.route : null) ?? pref.route ?? null;
    // a lead picker never seeds a runtime that cannot lead; memoized, since the seed effect keys on it and a
    // fallback route is a fresh object each call
    const profileRoute = useMemo(() => leadRouteSeed(rawRoute, harnesses), [rawRoute, harnesses]);
    // While the machine reads busy (memory pressure high, or the CPU pegged), Launch agent holds a new agent instead
    // of starting it (parkedmodel.ts), a resume of a past session too; the dialog itself is the same, only its warning
    // line says so. A plain terminal is light, so it is never held; the machine is read only while the dialog is open on
    // an agent that would be.
    const holdable = isAgent && runtimeShowsTask(runtime);
    const machineBusy = useMachine(open && holdable).busy;
    const holds = holdable && machineBusy != null;
    // a tool is a terminal running one program, and a council's Setup starts nothing: neither asks for room
    const ramWarning = holds
        ? busyLine(machineBusy)
        : isTool || isCouncil
          ? null
          : isRun
            ? shape === "quick"
                ? newAgentRamWarning(cap, "run", "worker")
                : null
            : newAgentRamWarning(cap, runtime);
    const primaryDisabled = where == null || blocker != null || busy;
    // the list the third column holds, which → from Project steps into
    const thirdList: "resume" | "tools" | null =
        isAgent && runtime !== "terminal" && choices.length > 0 ? "resume" : isTool ? "tools" : null;
    // what an Escape closes first: a popover only while it is drawn (a branch list with no branches draws nothing)
    const flagMenuShown = isAgent && flagMenuOpen && RUNTIME_FLAGS[runtime].length > 0;
    const branchListShown = wantsWorktree && branchListOpen && branches.length > 0;

    // The resume step (launcherpeek.ts): once a past Claude Code session is picked, the Task box on top, the sessions on
    // the left and the picked session's last 5 messages on the right, in place of the three columns; New session keeps
    // the columns. Going back (← from the sessions, or the agent or project in the title) shows the columns to change
    // your mind. Its state lives in the dialog, not an atom, so nothing outlives it; one loader (and its cache) per
    // opening, dropped at close.
    const [resumeStep, setResumeStep] = useState(true);
    const stepShown = resumeStepShows(resumeStep, runtime, thirdList, resume != null);
    // the step takes the columns band's measured height, so switching between the two leaves the dialog's height alone
    const columnsRef = useRef<HTMLDivElement>(null);
    const [bandHeight, setBandHeight] = useState<number | null>(rememberedBandHeight);
    useLayoutEffect(() => {
        const h = columnsRef.current?.offsetHeight ?? 0;
        if (open && !stepShown && h > 0 && h !== bandHeight) {
            rememberBandHeight(h);
            setBandHeight(h);
        }
    }, [open, stepShown, startList.length, bandHeight]);
    // the column focus moves to once the step switch has rendered it: the switch unmounts the one that had focus
    const stepFocusRef = useRef<"start" | "project" | "resume" | null>(null);
    const [peek, setPeek] = useState<{ id: string; state: PeekState } | null>(null);
    const peekLoaderRef = useRef<PeekLoader | null>(null);
    // one page of the picked session's messages: the last PEEK_COUNT, or with a cursor the page before it
    const readPeekPage = async (s: SessionInfo, count: number, cursor?: PeekCursor): Promise<PeekResult> => {
        const rtn = await RpcApi.GetSessionPeekCommand(TabRpcClient, {
            transcriptpath: s.transcriptpath,
            count,
            ...(cursor != null ? { before: cursor.before, answered: cursor.answered } : {}),
        });
        return {
            messages: rtn?.messages ?? [],
            capped: !!rtn?.capped,
            before: rtn?.before ?? 0,
            answered: !!rtn?.answered,
        };
    };
    const peekLoader = () => {
        if (peekLoaderRef.current == null) {
            peekLoaderRef.current = createPeekLoader({ fetch: (s) => readPeekPage(s, PEEK_COUNT) });
        }
        return peekLoaderRef.current;
    };
    // back to the three columns, focus on the column named; from the step that column is not drawn yet, so the focus
    // waits for the render (the effect under the read's)
    const leaveStep = (to: "start" | "project") => {
        setResumeStep(false);
        const el = (to === "project" ? projectRef : startRef).current;
        if (el != null) {
            el.focus();
        } else {
            stepFocusRef.current = to;
        }
    };
    // focus reached the Session column (→ from Project, Tab, or a click on a row): the step shows again as soon as a past
    // session is picked, at once when one already is
    const enterStep = () => {
        if (resumeStep) {
            return;
        }
        if (resumeStepShows(true, runtime, thirdList, resume != null)) {
            stepFocusRef.current = "resume";
        }
        setResumeStep(true);
    };

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

    // every opening starts in the box at the top: an agent's Task, or a run's Goal (its plan path, for a run from a plan),
    // so the most common New, an agent in the project you are in, is type and Enter. A pick with no box (a terminal, a
    // tool, a council) starts on the Start column. ModalShell's own focus effect runs first (a child's effects do), so
    // this one wins.
    useEffect(() => {
        if (!open) {
            return;
        }
        const box = isTool || isCouncil ? null : isRun ? (goalRef.current ?? planRef.current) : taskRef.current;
        (box ?? startRef.current)?.focus();
        // a restored draft is typed on from its end: WebKit leaves the caret at the start of a box focused from script
        if (box != null) {
            box.setSelectionRange(box.value.length, box.value.length);
        }
        // once per opening: a pick made later keeps its own focus
    }, [open]);

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

    // No folder is offered once wavesrv has created it and marked it trusted for Claude Code (homeOffered); every opening
    // asks again, which costs a stat while it is in place, so a folder deleted meanwhile comes back before a launch
    useEffect(() => {
        if (!open) {
            return;
        }
        let live = true;
        fireAndForget(async () => {
            try {
                const rtn = await RpcApi.EnsureNoFolderCommand(TabRpcClient);
                if (live) {
                    setNoFolder(rtn.path);
                }
            } catch (e) {
                console.error("launcher: could not make the No folder, not offering it", e);
            }
        });
        return () => {
            live = false;
        };
    }, [open]);

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

    // Opened without a project of its own, the dialog starts on the project the Agent surface shows: the one whose
    // Overview or council (its Setup too) is in the centre, else that of the agent or terminal in focus. A prefill names its own, an open given a project (a project's Overview) names it too, and a kept
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
        const center = globalStore.get(centerModeAtom);
        const overview =
            center === "project"
                ? globalStore.get(overviewProjectAtom)
                : center === "council"
                  ? councilCentreProject(
                        globalStore.get(councilViewAtom),
                        globalStore.get(councilSetupProjectAtom),
                        shownCouncilProject(),
                        rows
                    )
                  : "";
        const names = rows.map((r) => r.name);
        const pick = focusLaunchProject(name, names, overview);
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

    // The step's read follows the picked session as ↑↓ or a click move it (D6). The old session's messages go at once; a
    // cached read answers inside request, so the loading state is set first. New session, or leaving the step, drops a
    // read still on its way.
    const peekSessionId = stepShown ? (resume?.id ?? null) : null;
    const peekStamp = stepShown ? (resume?.lastactivets ?? 0) : 0;
    useEffect(() => {
        if (!stepShown || resume == null) {
            peekLoaderRef.current?.cancel();
            return;
        }
        const id = resume.id;
        setPeek({ id, state: { status: "loading", since: Date.now() } });
        peekLoader().request(resume, (o) => {
            // the repo's tsconfig does not narrow the union on `ok`, so the error branch is read with "in"
            const state: PeekState =
                "error" in o ? { status: "error", error: o.error } : { status: "done", result: o.result };
            setPeek({ id, state });
        });
    }, [peekSessionId, peekStamp]);

    // a step switch unmounts the column that had focus; focus moves to the one asked for once it is drawn. A switch made
    // from inside the session list (↑↓, a digit or a click between a past session and New session) unmounts the row that
    // had focus, so focus lands on the picked row of the list drawn now.
    useEffect(() => {
        const to = stepFocusRef.current;
        stepFocusRef.current = null;
        const lost = !rootRef.current?.contains(document.activeElement);
        if (to === "resume" || (to == null && lost)) {
            rootRef.current?.querySelector<HTMLElement>('[data-launcher-resume] [role="radio"][tabindex="0"]')?.focus();
        } else if (to != null) {
            (to === "project" ? projectRef : startRef).current?.focus();
        }
    }, [stepShown]);

    // the dialog closed: every read and cached answer of this opening go with it, and the next opening starts on the
    // step (reset here, not at open, so a reopen never draws the columns for a frame first)
    useEffect(() => {
        if (open) {
            return;
        }
        peekLoaderRef.current?.dispose();
        peekLoaderRef.current = null;
        setPeek(null);
        setResumeStep(true);
    }, [open]);
    useEffect(() => () => peekLoaderRef.current?.dispose(), []);

    useEffect(() => {
        projectRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    }, [pickKey, filter]);

    const close = () => {
        setError(null);
        setFilter("");
        setProjectSearch(false);
        closeLauncher(model);
    };

    const pickRow = (row: StartRow | undefined) => {
        if (row == null) {
            return;
        }
        if (row.kind === "run") {
            globalStore.set(launcherKindAtom, "run");
            pickRunShape(row.id as RunShape);
            return;
        }
        if (row.kind === "tool" || row.kind === "council") {
            globalStore.set(launcherKindAtom, row.kind);
            return;
        }
        globalStore.set(launcherKindAtom, "agent");
        pickLauncherRuntime(row.id as Runtime);
    };

    const pickProject = (key: string) => pickLauncherProject(key, pickKey);

    const applyFilter = (next: string) => {
        setFilter(next);
        const matches = projectColumnPicks(filterProjects(candidates, next), homeShown, next).map((name) => ({ name }));
        pickProject(projectAfterFilter(matches, pickKey));
    };

    // The Project column's search box (the magnifier, or /). Its input takes focus once the box is drawn, a frame later.
    const focusProjectBox = () =>
        projectRef.current?.querySelector<HTMLInputElement>("[data-launcher-search] input")?.focus();
    const openProjectSearch = () => {
        if (projectSearch) {
            focusProjectBox();
            return;
        }
        setProjectSearch(true);
        requestAnimationFrame(focusProjectBox);
    };
    // Escape and the ×: the filter goes with the box, and focus returns to the column (first, so the input's blur finds
    // the focus still inside the column and the column's onBlur keeps its state until it is cleared here)
    const closeProjectSearch = () => {
        projectRef.current?.focus();
        setProjectSearch(false);
        applyFilter("");
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
        // the task with its attachments: files as the "read these files" block; images as codex starting fresh takes
        // them (--image after the prompt), else as the "Attached images:" block. A terminal sends none of it.
        const riding = runtimeShowsTask(runtime) ? readyPaths(attachments) : { images: [], files: [] };
        const { task: fullTask, extraArgs } = composeLaunchTask(
            runtime,
            runtimeShowsTask(runtime) ? task : "",
            riding.images,
            riding.files,
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
                ...(claudeLaunch ? { accountMeta: accountLaunchMeta(launchAccount, usualAccount) } : {}),
            });
            // Remember off: flags are single-use, cleared for the next agent
            if (!globalStore.get(naRememberFlagsAtom)) {
                globalStore.set(naFlagsAtom, {});
            }
            // Home is no project, so it never takes a project's place in last used first
            if (!atHome) {
                noteRecentProject(p.name);
            }
            // a held agent opened in New and started is no longer held; one switched to a terminal was not what was
            // held, so it stays
            if (holdable) {
                settleParkedLaunch();
            }
            endLauncherDraft();
            close();
        } catch (e) {
            setError(String(e));
        } finally {
            endLauncherLaunch();
        }
    };

    // Hold the agent: what the dialog holds (its project, command, branch, task and images) becomes a held agent, which
    // the centre then shows as a launched agent would be shown. The attachments ride as their paths: a pasted or dropped
    // file's kept copy under ~/.arc/attachments, which outlives the dialog, or a picked file where it is.
    const holdAgentRow = async (p: ProjectRow) => {
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
        // a resume keeps the spec New would resume it with, so Start now picks up the same session
        const spec = resume != null ? resumeLaunchSpec(resume, runtime, naFlags[runtime] ?? {}) : null;
        try {
            const held = await parkLaunch({
                project: p.name,
                projectPath: p.path,
                runtime,
                command:
                    spec?.startupCommand ??
                    composeStartupCommand(
                        commands[runtime] ?? runtimeStartupCommand(runtime),
                        runtime,
                        naFlags[runtime] ?? {}
                    ),
                branch,
                ...(resume != null
                    ? {
                          args: spec?.startupArgs,
                          resumePath: spec?.resumePath,
                          resumeOf: resume.transcriptpath,
                          resumeTitle: sessionTitle(resume),
                      }
                    : {}),
                task,
                ...readyPaths(attachments),
                reason: machineBusy,
            });
            if (!globalStore.get(naRememberFlagsAtom)) {
                globalStore.set(naFlagsAtom, {});
            }
            endLauncherDraft();
            close();
            // the held view it lands on says it was held and why; a toast over it would only cover its bar
            showHeld(model, held.id);
        } catch (e) {
            setError(`Could not hold it: ${String(e)}`);
        } finally {
            endLauncherLaunch();
        }
    };

    // After run… and Queue start nothing here: the same data a start would send goes to the queue, which makes the run
    // when its turn comes. The dialog closes on the entry, and the Agent tree shows it as a queued row. An error stays in
    // the dialog (nothing was queued), and the handback is read, not taken, until the queue has the entry.
    const queueRun = async (p: ProjectRow) => {
        if (target == null) {
            setError("Still reading your projects — try again in a moment.");
            return;
        }
        if (!beginLauncherLaunch()) {
            return;
        }
        setError(null);
        const handback = peekLauncherHandback();
        try {
            const { entry } = await queueLauncherRun({
                target: resolveChannelTarget(globalStore.get(channelsAtom), p.name, p.path) ?? target,
                projectName: p.name,
                config,
                goal,
                pickedRoute: routeTouched ? runRoute : null,
                ...(specPath !== "" ? { specPath } : {}),
                after: waitingOn(when),
                ...(brainstorm != null ? { brainstorm } : {}),
            });
            takeLauncherHandback();
            handBack(handback, { kind: "queued", entryId: entry.id });
            endLauncherDraft();
            close();
            // a caller that filled the dialog keeps the person where it is, as a start does
            if (handback == null) {
                globalStore.set(model.surfaceAtom, "agent");
            }
        } catch (e) {
            setError(String(e));
        } finally {
            endLauncherLaunch();
        }
    };

    const startRun = (p: ProjectRow) => {
        if (when.choice !== "now") {
            void queueRun(p);
            return;
        }
        if (target == null) {
            setError("Still reading your projects — try again in a moment.");
            return;
        }
        // A run can take minutes to start (CreateRun builds the landing tree and the lead before it returns), so the
        // dialog hands it to a Starting row in its project's folder and closes at once; that row is where it is cancelled
        // or reads why it failed. Read before close(), which drops it: the prefill's caller still hears the run's id.
        const handback = takeLauncherHandback();
        const pickedRoute = routeTouched ? runRoute : null;
        startRunInBackground({
            project: p.name,
            title: startingTitle(
                goal,
                config.shape === "orchestrator" && config.start === "plan" ? config.planPath : ""
            ),
            // a Try again reads the channel list again: a first try that minted the project's channel must not mint another
            start: () =>
                startLauncherRun({
                    target: resolveChannelTarget(globalStore.get(channelsAtom), p.name, p.path) ?? target,
                    projectName: p.name,
                    config,
                    goal,
                    pickedRoute,
                    ...(specPath !== "" ? { specPath } : {}),
                }),
            handback,
        });
        endLauncherDraft();
        close();
        // the row is in the Agent tree, as a new agent's is; a caller that filled the dialog keeps the person where it is
        if (handback == null) {
            globalStore.set(model.surfaceAtom, "agent");
        }
    };

    // A tool takes the centre, as an agent launch does. The folder is the project's (the tool's own "opens in" aside, see
    // toolFolder); Home is no registered project, so openTool is told so (`home`) and resolves the home folder itself.
    const openPickedTool = async (t: ToolStatus, p: { name: string }) => {
        if (!beginLauncherLaunch()) {
            return;
        }
        setError(null);
        try {
            const res = await openTool(model, t, {
                ...(toolAtHome ? { home: true } : { project: p.name }),
                ...(atHome ? { folder: noFolder } : {}),
                place: "centre",
            });
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
        // Enter and Mod+Enter reach here as well as the button, which is disabled while a file is still being attached
        if (isAgent && blocker != null) {
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
        if (holds) {
            void holdAgentRow(project);
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
        if (target != null && (inTaskBox(target) || target === goalRef.current)) {
            return "task";
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
        // Tab walks the dialog's stops and wraps, as the DAG modal's trap does; focus never leaves the dialog. With a Task
        // or Goal box, the Start column is no stop: Alt+1–9 picks there from the box, so Tab goes from the box to Project
        if (e.key === "Tab" && !mod) {
            e.preventDefault();
            const box = isTool || isCouncil ? null : isRun ? goalRef.current : taskRef.current;
            const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
                (el) => box == null || el !== startRef.current
            );
            focusTrapTarget(stops, document.activeElement, e.shiftKey)?.focus();
            return;
        }
        // the box a letter typed in a column starts: an agent's Task, or a run's Goal (none for a terminal, a tool, a
        // council, or a run from a plan file)
        const textField = isTool || isCouncil ? null : isRun ? goalRef.current : taskRef.current;
        const action = launcherKey(
            {
                zone: zoneOf(e.target),
                startCount: startList.length,
                projectCount: visible.length,
                homeShown: picks.includes(HOME_PICK),
                third: thirdList,
                toolCount: isTool && toolList != null ? toolList.length : 0,
                filter,
                flagMenuOpen: flagMenuShown,
                branchListOpen: branchListShown,
                accountMenuOpen: accountMenuShown,
                resumePicked: resume != null,
                stepShown,
                projectSearchOpen: projectSearch,
                textField: textField != null,
            },
            {
                key: e.key,
                shift: e.shiftKey,
                mod,
                altDigit:
                    e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[0-9]$/.test(e.code)
                        ? Number(e.code.slice(5))
                        : undefined,
                composing: e.nativeEvent.isComposing || e.keyCode === 229,
                paste:
                    ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v") ||
                    (e.shiftKey && !mod && e.key === "Insert"),
                altLeft: e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === "ArrowLeft",
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
                // Alt+digit from the Task box onto a pick with no box (a terminal, a tool, a council) unmounts the box;
                // focus goes to the Start column instead of falling out of the dialog
                requestAnimationFrame(() => {
                    if (!rootRef.current?.contains(document.activeElement)) {
                        startRef.current?.focus();
                    }
                });
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
                if (action.to === "start" || action.to === "project") {
                    (action.to === "project" ? projectRef : startRef).current?.focus();
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
            case "search-project":
                // a pinned app runs in its own folder: the column is not used, and has nothing to search
                if (!ownFolder) {
                    openProjectSearch();
                }
                return;
            case "launch":
                launch();
                return;
            case "resume-secondary":
                if (resume != null) {
                    viewTranscript(resume);
                }
                return;
            case "back":
                leaveStep("project");
                return;
            case "dismiss-inner":
                // the inner thing takes this Escape; ModalShell's would close the dialog
                e.stopPropagation();
                if (action.what === "flags") {
                    globalStore.set(launcherFlagMenuAtom, false);
                } else if (action.what === "branches") {
                    globalStore.set(launcherBranchListAtom, false);
                } else if (action.what === "account") {
                    globalStore.set(launcherAccountMenuAtom, false);
                } else if (action.what === "filter") {
                    closeProjectSearch();
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
    const toolsFocused = zone === "tools";
    let projectHint = "";
    if (projectFocused) {
        projectHint =
            filter === "" && visible.length > 0
                ? `${hasTextBox ? "↑↓" : "type to filter"} · 1–${Math.min(9, visible.length)}${picks.includes(HOME_PICK) ? ", 0 No folder" : ""}`
                : "";
    } else if (candidates.length > 9) {
        projectHint = `${candidates.length} · last used first`;
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
                aria-label={row.name}
                title={row.desc != null ? `${row.name}: ${row.desc}` : row.name}
                onClick={() => pickRow(row)}
                className={cn(rowTone(selected, startFocused), "shrink-0 gap-[9px] py-2 max-[640px]:gap-[7px]")}
            >
                <Keycap k={row.key} lit={startFocused} />
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                    <StartMark id={row.id} />
                    {/* the Christmas decor's hat, as on the nav rail's icons; nothing off the theme */}
                    <RailSantaHat iconSize={16} />
                </span>
                {/* a narrow window (Float) keeps the column to its keys and marks: the name is in the title, the pick in
                    the row's tone */}
                <span
                    className={cn(
                        "min-w-0 flex-1 truncate text-[12.5px] font-semibold max-[640px]:hidden",
                        selected ? "text-primary" : "text-muted-foreground"
                    )}
                >
                    {row.name}
                </span>
                {selected ? <Check size={14} strokeWidth={2.4} className="text-accent max-[640px]:hidden" /> : null}
            </div>
        );
    };

    return (
        <ModalShell
            open={open}
            onClose={close}
            onSubmit={launch}
            className="flex max-h-[86vh] w-[min(840px,93vw)] flex-col"
            christmasLights
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
                        {stepShown ? (
                            // the step hides the Start and Project columns: what they hold stays in view, and a click
                            // goes back to them to change it
                            <div data-launcher-crumbs className="flex min-w-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    data-launcher-crumb="start"
                                    title="Change the agent (←)"
                                    onClick={() => leaveStep("start")}
                                    className={CRUMB}
                                >
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                        <StartMark id={selectedRow} />
                                    </span>
                                    {startList.find((r) => r.id === selectedRow)?.name ?? runtime}
                                </button>
                                <ChevronRight size={12} strokeWidth={2} className="shrink-0 text-ink-faint" />
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    data-launcher-crumb="project"
                                    title={`${where?.path ?? ""}\nChange the project (←)`.trim()}
                                    onClick={() => leaveStep("project")}
                                    className={cn(CRUMB, "min-w-0")}
                                >
                                    <span className="truncate">{project?.name ?? ""}</span>
                                </button>
                            </div>
                        ) : null}
                        {restored ? (
                            <span data-launcher-restored className="flex items-center gap-1.5 text-[11.5px] text-muted">
                                · draft restored
                                <button
                                    type="button"
                                    tabIndex={-1}
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
                    {/* the pick's own fields come first, its Task or Goal box at the top where the dialog opens; a box too
                    tall for the dialog scrolls, the columns under it never do */}
                    <div
                        data-launcher-fields
                        onFocus={(e) => {
                            const target: EventTarget = e.target;
                            if (inTaskBox(target) || target === goalRef.current) {
                                setZone("task");
                            }
                        }}
                        onBlur={(e) => {
                            const target: EventTarget = e.target;
                            if (inTaskBox(target) || target === goalRef.current) {
                                setZone(null);
                            }
                        }}
                        className="flex min-h-0 shrink flex-col gap-[14px] overflow-y-auto border-b border-border px-[18px] pb-4 pt-[14px]"
                    >
                        {isRun ? (
                            <RunFields
                                projectPath={projectPath}
                                goalRef={goalRef}
                                planRef={planRef}
                                ramWarning={ramWarning}
                            />
                        ) : isTool ? (
                            <>
                                <NoTaskBox reason={`${tool?.name ?? "A tool"} takes no task: it opens as it is.`} />
                                <ToolFields tool={tool} atHome={toolAtHome} />
                            </>
                        ) : isCouncil ? (
                            <NoTaskBox reason="A council's question is written in its Setup, which opens next." />
                        ) : (
                            <>
                                {runtimeShowsTask(runtime) ? null : (
                                    <NoTaskBox reason="A terminal takes no task: it opens a shell." />
                                )}
                                <AgentFields
                                    runtime={runtime}
                                    currentBranch={currentBranch}
                                    branches={branches}
                                    ramWarning={ramWarning}
                                    resume={resume}
                                    home={atHome}
                                    filesRoot={atHome ? "" : projectPath}
                                    projectName={atHome ? "" : (project?.name ?? "")}
                                    taskRef={taskRef}
                                />
                            </>
                        )}
                    </div>
                    {stepShown && resume != null ? (
                        // the resume step: the sessions and the picked one's read where the columns were, about as tall
                        // as the columns' band so a step switch leaves the dialog's height alone; in a short window the
                        // read gives way before the Task box does
                        <motion.div
                            key="step"
                            variants={viewFade}
                            initial="initial"
                            animate="animate"
                            data-launcher-step="resume"
                            style={bandHeight != null ? { height: bandHeight } : undefined}
                            className={cn(
                                "grid min-h-[220px] grid-cols-[272px_minmax(0,1fr)] [flex-shrink:4] max-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
                                bandHeight == null && "h-[360px]"
                            )}
                        >
                            <div data-launcher-column="third" className="relative min-w-0 border-r border-border">
                                <div className="absolute inset-0 flex flex-col px-2 py-3">
                                    <ResumeList
                                        choices={choices}
                                        scopeKey={scopeKey}
                                        pickedId={resume?.id ?? null}
                                        onBack={() => leaveStep("project")}
                                        searchable={sessionSearchOn}
                                        answer={sessionAnswer}
                                    />
                                </div>
                            </div>
                            <LauncherPeekPane
                                session={resume}
                                peek={peek?.id === resume.id ? peek.state : { status: "loading", since: Date.now() }}
                                fetchOlder={(s, cursor) => readPeekPage(s, PEEK_OLDER_COUNT, cursor)}
                            />
                        </motion.div>
                    ) : (
                        /* the Start column sets the band's height; the other two lay out inside it and scroll */
                        <motion.div
                            key="columns"
                            ref={columnsRef}
                            variants={viewFade}
                            initial="initial"
                            animate="animate"
                            className="shrink-0"
                        >
                            {/* a narrow window (Float) takes room from the Start column and gives Session the rest; a
                                narrower one keeps Start to a strip of keys and marks, so Project and Session read */}
                            <div className="grid grid-cols-[236px_minmax(0,1fr)_minmax(0,1fr)] max-[900px]:grid-cols-[188px_minmax(0,0.8fr)_minmax(0,1.2fr)] max-[640px]:grid-cols-[64px_minmax(0,0.85fr)_minmax(0,1.15fr)]">
                                <div
                                    ref={startRef}
                                    role="radiogroup"
                                    aria-label="Start"
                                    tabIndex={0}
                                    data-launcher-column="start"
                                    onFocus={() => {
                                        // working in the columns is changing your mind: the step waits until the sessions
                                        setZone("start");
                                        setResumeStep(false);
                                    }}
                                    onBlur={() => setZone(null)}
                                    className="flex min-h-[300px] flex-col gap-px border-r border-border px-2 py-3 outline-none max-[640px]:px-1.5"
                                >
                                    <ColumnLabel
                                        label="Agent"
                                        className="max-[640px]:hidden"
                                        focused={startFocused}
                                        hint={
                                            startFocused
                                                ? `↑↓ · 1–${Math.min(startList.length, 9)}`
                                                : zone === "task"
                                                  ? `alt 1–${Math.min(startList.length, 9)}`
                                                  : ""
                                        }
                                    />
                                    {startList.filter((r) => r.kind === "agent").map(renderStartRow)}
                                    <StartGroup label="Run" focused={startFocused} />
                                    {startList.filter((r) => r.kind === "run").map(renderStartRow)}
                                    <StartGroup label="Tool" focused={startFocused} />
                                    {startList.filter((r) => r.kind === "tool").map(renderStartRow)}
                                    <StartGroup label="Council" focused={startFocused} />
                                    {startList.filter((r) => r.kind === "council").map(renderStartRow)}
                                </div>
                                <div
                                    ref={projectRef}
                                    role="radiogroup"
                                    aria-label="Project"
                                    tabIndex={0}
                                    data-launcher-column="project"
                                    onFocus={() => {
                                        setZone("project");
                                        setResumeStep(false);
                                    }}
                                    onBlur={(e) => {
                                        // focus moving inside the column (onto its search box, off it, onto a row's
                                        // click) keeps the filter: the box is the column's own
                                        if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                            return;
                                        }
                                        // a list narrowed by a query you can no longer see reads as projects gone missing
                                        setZone(null);
                                        setFilter("");
                                        setProjectSearch(false);
                                    }}
                                    className="relative min-w-0 border-r border-border outline-none"
                                >
                                    <div className="absolute inset-0 flex flex-col px-2 py-3">
                                        <ColumnLabel
                                            label="Project"
                                            focused={projectFocused}
                                            hint={ownFolder ? "" : projectHint}
                                            search={
                                                ownFolder
                                                    ? undefined
                                                    : {
                                                          column: "project",
                                                          open: projectSearch,
                                                          query: filter,
                                                          hint: `${visible.length} of ${candidates.length}`,
                                                          label: "Search projects",
                                                          onOpen: openProjectSearch,
                                                          onChange: applyFilter,
                                                          onClose: closeProjectSearch,
                                                          // the column itself has focus; its picked row is the cursor
                                                          onDown: () => projectRef.current?.focus(),
                                                      }
                                            }
                                        />
                                        {ownFolder ? (
                                            <div
                                                data-launcher-project-unused
                                                className="px-2 pb-2 text-[11.5px] leading-normal text-muted"
                                            >
                                                Not used: {tool!.name} runs in its own folder.
                                            </div>
                                        ) : null}
                                        {filter !== "" && !projectSearch ? (
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
                                                    {visible.map((p, i) => {
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
                                                                <Keycap k={digitOf(i)} lit={projectFocused} />
                                                                <span
                                                                    className={cn(
                                                                        "min-w-0 flex-1 truncate text-[12.5px] font-semibold",
                                                                        selected
                                                                            ? "text-primary"
                                                                            : "text-muted-foreground"
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
                                                    Its folder is in the tooltip, as a project's path is */}
                                                        <div
                                                            role="radio"
                                                            aria-checked={atHome}
                                                            data-launcher-home
                                                            title={`${noFolder}: no project, an empty folder of its own`}
                                                            onClick={() => pickProject(HOME_PICK)}
                                                            className={cn(
                                                                rowTone(atHome, projectFocused),
                                                                "shrink-0 gap-[10px] py-2",
                                                                ownFolder && "opacity-40"
                                                            )}
                                                        >
                                                            <Keycap k="0" lit={projectFocused} />
                                                            <FolderMinus
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
                                                                {NO_FOLDER_LABEL}
                                                            </span>
                                                        </div>
                                                    </>
                                                ) : null}
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                                {/* the pick's own list: an agent's sessions, the tools, or a run's model, start and width */}
                                {/* focus reaching a Claude session list here goes on into the resume step */}
                                <div data-launcher-column="third" onFocus={enterStep} className="relative min-w-0">
                                    <div className="absolute inset-0 flex flex-col px-2 py-3">
                                        {isRun ? (
                                            <RunColumn projectPath={projectPath} channelId={pickedOid} />
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
                                                    Setup opens in the Agent surface: write what to review or
                                                    brainstorm, then Start council. A council costs 0.5–1.5M tokens.
                                                </span>
                                            </>
                                        ) : thirdList === "resume" ? (
                                            <ResumeList
                                                choices={choices}
                                                scopeKey={scopeKey}
                                                pickedId={resume?.id ?? null}
                                                onBack={() => projectRef.current?.focus()}
                                                searchable={sessionSearchOn}
                                                answer={sessionAnswer}
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
                                                        : sessions == null
                                                          ? "Reading sessions…"
                                                          : "No session of this agent here yet: it starts a new one."}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                    <div className="flex shrink-0 items-center gap-3 border-t border-border px-[18px] py-[13px]">
                        {error != null ? (
                            <span
                                data-launcher-footer="error"
                                title={error}
                                className="min-w-0 flex-1 truncate text-[12px] text-error"
                            >
                                {error}
                            </span>
                        ) : accountChoices.length > 1 && !footer.blocked ? (
                            <AccountPicker
                                choices={accountChoices}
                                current={launchAccount}
                                active={activeAccount}
                                projectOwn={usualAccount !== activeAccount ? usualAccount : null}
                                label={footer.lead}
                                open={accountMenuShown}
                            />
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
                        {stepShown && resume != null ? (
                            // the step's way back for the pointer, which the title's chips do not read as; the keyboard
                            // has Alt+← from anywhere in the dialog (← from the sessions), so it is no Tab stop
                            <DialogButton
                                variant="secondary"
                                tabIndex={-1}
                                hint={formatChordString("Alt:ArrowLeft")}
                                data-launcher-back
                                title={`Back to the columns to change the agent or project (${formatChordString("Alt:ArrowLeft")}, or ← from the sessions)`}
                                onClick={() => leaveStep("project")}
                                className="pl-[11px]"
                            >
                                <ChevronLeft size={14} strokeWidth={2.2} className="-mr-0.5" />
                                Back
                            </DialogButton>
                        ) : null}
                        <DialogButton variant="secondary" hint={formatChordString("Escape")} onClick={close}>
                            Cancel
                        </DialogButton>
                        {/* the step reads the session beside the list, so only the columns offer its transcript */}
                        {resume != null && !stepShown ? (
                            <DialogButton
                                variant="secondary"
                                hint={formatChordString("Shift:Enter")}
                                data-launcher-transcript
                                title={`View transcript (${formatChordString("Shift:Enter")})`}
                                onClick={() => viewTranscript(resume)}
                            >
                                Transcript
                            </DialogButton>
                        ) : null}
                        {/* Enter launches from every zone, the Task box included, where Shift+Enter is the newline. While
                            the machine is busy the same button holds the agent (the warning line says so) */}
                        <DialogButton
                            variant="primary"
                            hint={formatChordString("Enter")}
                            data-launcher-primary={holds ? "hold" : "start"}
                            title={
                                isTool || isCouncil
                                    ? formatChordString("Enter")
                                    : `${formatChordString("Enter")} (${formatChordString("Shift:Enter")} is a new line in the Task box)`
                            }
                            disabled={primaryDisabled}
                            onClick={launch}
                            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
                        >
                            {isRun
                                ? startLabel(when, primaryLabel(kind, runtime, resume != null, tool?.name))
                                : primaryLabel(kind, runtime, resume != null, tool?.name)}
                        </DialogButton>
                    </div>
                </div>
            ) : null}
        </ModalShell>
    );
}

// A group's head in the Start column: its label, or in a narrow window, where the column is a strip of keys and marks,
// a thin rule between the groups
function StartGroup({ label, focused }: { label: string; focused: boolean }) {
    return (
        <>
            <ColumnLabel label={label} focused={focused} className="pt-[10px] max-[640px]:hidden" />
            <div aria-hidden className="mx-1.5 my-[7px] hidden h-px bg-border max-[640px]:block" />
        </>
    );
}
