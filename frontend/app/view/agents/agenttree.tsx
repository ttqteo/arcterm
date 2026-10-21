// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildRunThing, RUN_KIND } from "@/app/cockpit/actions/run";
import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { ctrlHeldAtom } from "@/app/cockpit/ctrlheld";
import { digitHintAtom } from "@/app/cockpit/digithints";
import { queuedJobFor } from "@/app/cockpit/jobqueue";
import { QueuedJobTag } from "@/app/cockpit/jobqueuechip";
import { jobQueueAtom } from "@/app/cockpit/jobqueuestore";
import { pushToast } from "@/app/cockpit/notificationstore";
import { useSettle } from "@/app/element/motionhooks";
import {
    cardVariants,
    composerReveal,
    computeEntrances,
    foldReveal,
    initialEntranceState,
} from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { ContextMenuModel } from "@/app/store/contextmenu";
import * as WOS from "@/app/store/wos";
import { openTarget, peekTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import {
    AppWindow,
    ArrowRight,
    ArrowUpRight,
    AtSign,
    Ban,
    Check,
    Bookmark,
    BookmarkCheck,
    Bot,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Clock,
    Columns2,
    Copy,
    CopyPlus,
    CornerUpLeft,
    ExternalLink,
    FileDiff,
    Folder,
    FolderOpen,
    GitBranch,
    Hash,
    History as HistoryIcon,
    Hourglass,
    LayoutGrid,
    Loader2,
    Moon,
    Pencil,
    PenTool,
    Play,
    RotateCcw,
    Square,
    SquareTerminal,
    Sun,
    Trash2,
    Users,
    Workflow,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { confirmCloseRun, confirmCloseSession } from "./agentactions";
import { DONE_TITLE, doneSuggestion } from "./donesuggest";
import { beginAgentDrag, endAgentDrag } from "./agentdragstore";
import { mentionToken } from "./agentrowmodel";
import type { AgentsViewModel } from "./agents";
import { buildAgentTree, stageSubline, type StageOutcome } from "./agenttreemodel";
import { setAgentView } from "./agentview";
import { waitMap } from "./agentwaits";
import { backgroundActivity, launchedServers, shownState, type ShownState } from "./bgactivity";
import { isUnseen } from "./canvasmodel";
import { canvasStateAtom } from "./canvasstore";
import { laterFirst, laterSince, laterTitle, type LaterMarks } from "./latermodel";
import { laterMarksAtom, setLater } from "./laterstore";
import { machineServersReadingAtom } from "./machineserversstore";
import { RenameBox, startRowRename } from "./rowrename";
import { dockedTerminalAtom } from "./railstore";
import { renamingRowAtom } from "./rowrenameatom";
import { cancellingRunIdsAtom } from "./runactions";
import { runEventsAtom } from "./runeventstore";
import { originLinks, type OriginLink } from "./runorigin";
import { openOriginLink, openOriginSession, useOriginName, useOriginRuns } from "./runoriginstore";
import { isBlockedEntry, queuedMeta, queuedTooltip, type QueuedRow } from "./runqueuemodel";
import {
    confirmRemoveQueued,
    queuedRowsAtom,
    runQueueAtom,
    runQueuedNext,
    startQueuedNow,
    useRunQueueFeed,
} from "./runqueuestore";
import { runMenuEntries } from "./runrowmenu";
import { centerModeAtom, showCanvases, showHistory, showSession, showTerminal } from "./agentcenter";
import {
    agentDigits,
    agentsElsewhere,
    ALL_PROJECTS,
    collidingTitles,
    conversationCount,
    conversationTree,
    endedConversationsByProject,
    folderBlocks,
    folderCounts,
    liveBranches,
    notableBranch,
    projectLabel,
    projectTree,
    registeredConversations,
    runTokens,
    sessionAgeLabel,
    startedLabel,
    startOfDay,
    terminalRowState,
    terminalShows,
    treeNavIds,
    type ConversationEntry,
    type EndedRunRow,
    type EndedSessionRow,
    type TerminalRowState,
    type TerminalShows,
} from "./agentsidebarmodel";
import { projectsAtom } from "./projectsstore";
import { useRunObjects } from "./runobjects";
import { runtimeMeta } from "./runtimemeta";
import { sessionsArchiveAtom } from "./sessionsarchivestore";
import { liveTokensAtom, useLiveTokens } from "./livetokensstore";
import { canDeleteSession, confirmDeleteSession, DELETE_SESSION_LABEL } from "./sessiondelete";
import { runSessionPrimary, SEG_COLOR, StatusMark } from "./sessionsdetail";
import { defaultMember, runView, type RunView } from "./sessionsruns";
import { duplicateSession } from "./session-models/sessionsidebarmodel";
import { SLEEPABLE_AGENTS, sleepingAge, sleepWithConfirm, wakeAgent, wakeErrorToast } from "./agentsleep";
import {
    askingCount,
    askingLabel,
    displayAgeMs,
    formatAgeShort,
    formatTokens,
    type AgentVM,
} from "./agentsviewmodel";
import { parseDocReview } from "./docreview";
import { openReview } from "./docreviewstore";
import { reconcileProjectGrids, shownGrid } from "./agentgrid";
import { canOpenInSplit, eligibleIds, gridProjects, isInSplit, openInSplit, projectGridsAtom } from "./gridstore";
import { finalRowFocusId, type FinalTone } from "./finalstage";
import { useFinalStageView } from "./finalstageviews";
import { LEAD_MARK_CLASS, leadMark } from "./leadcardmodel";
import { rosterSeededAtom } from "./liveagents";
import {
    collapsedConversationProjectsAtom,
    collapsedProjectsAtom,
    collapsedSectionsAtom,
    toggleFold,
    type SidebarSection,
} from "./projectfoldstore";
import {
    endedWorkerId,
    laneLabel,
    runAgentsOf,
    runFocusAgent,
    runProgress,
    stageLabel,
    taskElapsed,
    taskStateLabel,
    unmetDeps,
    workerAsk,
    workerEnded,
    workerSubtext,
    type RunInfo,
} from "./runlineage";
import { planReviewLensTitle } from "./runtimeline";
import {
    openRunFold,
    toggleRunCollapsed,
    toggleRunDoneOpen,
    toggleRunQueuedOpen,
    toggleTaskExtrasOpen,
    treeFoldsAtom,
    useRunDigests,
} from "./runlineagestore";
import { dagProgressLabel, finishedRunLabel, runComplete, runStatusView } from "./runmodel";
import { runStage, type StageTone } from "./runstage";
import { FINAL_FILL, PIP_FILL, SEG_FILL, taskStrip, taskStripLabel } from "./runstrip";
import {
    getSubagentExpandAtom,
    toggleSubagentExpand,
} from "./session-models/agentstatusstore";
import { subagentExpanded, visibleSubagents, type SubagentState } from "./session-models/sessionviewmodel";
import { DigitHint } from "./digithint";
import { ServerMark, StatusDot } from "./statusdot";
import { backgroundTasksByIdAtom, focusSubagentAtom, subagentsByIdAtom } from "./subagentsstore";
import { useSubagentTracking } from "./subagenttracking";
import { rowFieldsAtom } from "./rowfieldsstore";
import { runningBackgroundTasks } from "./transcriptprojection";
import { unreadLabel } from "./unreadagents";
import { unreadAgentsAtom } from "./unreadagentsstore";
import { showServiceMenu } from "./servicemenu";
import { canRestart, serviceRowWords, treeServiceInput } from "./servicesmodel";
import { ensureServicesFeed, openService, restartService, servicesAtom } from "./servicesstore";
import { showTerminalMenu, splitCellMenuItems, SplitMark, ToolGlyph } from "./terminalsrail";
import { PanelWeb, TreeSpider } from "./themedecorview";
import { toolIcon, toolTerminalName, type ToolIconName } from "./toolsmodel";
import { failedAtom, installingAtom, loadTools, toolsStatusAtom } from "./toolsstore";
import { folderName } from "./worktreegone";
import { goneTerminalIdsAtom } from "./worktreegonestore";

const SUB_COLOR: Record<SubagentState, string> = {
    working: "var(--color-working)",
    success: "var(--color-success)",
    failure: "var(--color-error)",
    done: "var(--color-muted)",
};

// How many times "Show more" was pressed on each project's Conversations folder (one more page of ended sessions per
// press). Sidebar UI state in a module-level atom, so it outlives the tree's re-renders and unmounts; not persisted. Cast
// like agentDragAtom: with strictNullChecks off, atom<T>(...) resolves to the read-only overload.
const conversationPressesAtom = atom<ReadonlyMap<string, number>>(new Map()) as PrimitiveAtom<
    ReadonlyMap<string, number>
>;

function showMoreConversations(project: string): void {
    globalStore.set(conversationPressesAtom, (prev) => new Map(prev).set(project, (prev.get(project) ?? 0) + 1));
}

// back to the first page in one press: one opens more to look, then wants the list short again
function showLessConversations(project: string): void {
    globalStore.set(conversationPressesAtom, (prev) => {
        const next = new Map(prev);
        next.delete(project);
        return next;
    });
}

// choosing an agent's row brings its terminal back from a session, History or one of its subagents
function selectAgentRow(model: AgentsViewModel, id: string): void {
    globalStore.set(model.focusIdAtom, id);
    globalStore.set(model.focusReplyAtom, false);
    globalStore.set(focusSubagentAtom, null);
    showTerminal();
}

// the row that reads as selected: the focused agent's, unless the centre is showing a session or History instead
function useSelectedRowId(model: AgentsViewModel): string | undefined {
    const focusId = useAtomValue(model.focusIdAtom);
    const mode = useAtomValue(centerModeAtom);
    return mode === "terminal" ? focusId : undefined;
}

// A live agent's row is the drag source for the grid: dropped on a cell of the Agent surface it splits the view.
// A row with no terminal to show (a done worker, a launch with no block yet) is not draggable.
function dragSource(agent: AgentVM | undefined, enabled: boolean): React.HTMLAttributes<HTMLDivElement> {
    if (agent == null || !enabled || agent.blockId == null) {
        return {};
    }
    return {
        draggable: true,
        onDragStart: (e) => beginAgentDrag(e, agent.id),
        onDragEnd: endAgentDrag,
    };
}

// "Open in split" adds the agent as a new cell beside the focused one. Disabled when it already has a cell, the grid
// is full or the roster is not seeded yet (a grid operation prunes against the roster as it is); empty for an agent
// with no terminal. The palette has the same action (cockpit/actions/agent.ts). A cell of the split offers Remove from
// split and End split instead, as its row is where the split is reached from.
function splitMenuItem(model: AgentsViewModel, agent: AgentVM): ContextMenuItem[] {
    if (agent.blockId == null) {
        return [];
    }
    if (isInSplit(model, agent.id)) {
        return splitCellMenuItems(model, agent.id);
    }
    return [
        {
            label: "Open in split",
            icon: <Columns2 size={15} />,
            enabled: globalStore.get(rosterSeededAtom) && canOpenInSplit(model, agent.id),
            // plain focus when it can no longer be split (the grid changed after the menu opened)
            click: () => {
                if (!openInSplit(model, agent.id)) {
                    model.openTerminal(agent.id);
                }
            },
        },
    ];
}

const RUN_ACTION_ICONS: Record<string, React.ReactNode> = {
    "run:dag": <Workflow size={15} />,
    "run:diff": <FileDiff size={15} />,
    "run:lead-terminal": <SquareTerminal size={15} />,
    "run:workers": <Users size={15} />,
    "run:relaunch": <RotateCcw size={15} />,
    "run:resume": <Play size={15} />,
    "run:stop-worker": <Square size={15} />,
    "run:cancel": <Ban size={15} />,
};

// The run part of a run row's menu (runrowmenu.ts): Open in Jarvis (Ctrl peeks), then the palette's run actions that
// fit a menu and Copy run id; its destructive ones come apart for the menu's danger end. Until the lineage and the run
// object have loaded only the open and the copy are offered. `skip` is what the row's own items already do.
function runMenuItems(
    model: AgentsViewModel,
    runId: string,
    skip: string[] = []
): { items: ContextMenuItem[]; danger: ContextMenuItem[] } {
    const open: ContextMenuItem = {
        label: "Open in Jarvis",
        icon: <ExternalLink size={15} />,
        // a menu item's click carries no event, so Ctrl is read from the held flag
        click: () => {
            const target = { kind: "run", runId } as const;
            fireAndForget(() =>
                globalStore.get(ctrlHeldAtom) ? peekTarget(model, target) : openTarget(model, target)
            );
        },
    };
    const copyId: ContextMenuItem = {
        label: "Copy run id",
        icon: <Hash size={15} />,
        click: () => void navigator.clipboard.writeText(runId),
    };
    const lineage = globalStore.get(model.lineageAtom);
    const info = lineage.runs[runId];
    const run = WOS.getObjectValue<Run>(WOS.makeORef("run", runId));
    if (info == null || run == null) {
        return { items: [open, copyId], danger: [] };
    }
    const thing = buildRunThing({ channelId: info.channelId, run }, globalStore.get(model.agentsAtom), lineage, {
        events: globalStore.get(runEventsAtom(runId)),
        cancelling: globalStore.get(cancellingRunIdsAtom).has(runId),
    });
    const items: ContextMenuItem[] = [open];
    const danger: ContextMenuItem[] = [];
    for (const entry of runMenuEntries(RUN_KIND.actions, thing, new Set(["run:open", ...skip]))) {
        const { action } = entry;
        const label = action.label.replace(/…$/, "");
        // the palette shows a rejected action; a menu has closed by then, so it is a toast
        const act = (value?: string) =>
            fireAndForget(async () => {
                try {
                    await action.run(thing, { model }, value);
                } catch (e) {
                    pushToast({
                        title: `${label} failed`,
                        message: e instanceof Error ? e.message : String(e),
                        level: "error",
                    });
                }
            });
        const icon = RUN_ACTION_ICONS[action.id];
        if (entry.kind === "pick") {
            items.push({
                label,
                icon,
                submenu: entry.options.map((o) => ({ label: o.label, click: () => act(o.value) })),
            });
        } else {
            (action.destructive ? danger : items).push({
                label,
                icon,
                danger: action.destructive,
                click: () => act(),
            });
        }
    }
    items.push(copyId);
    return { items, danger };
}

// Wake for a sleeping agent, Sleep for an awake idle one that the server may sleep: a terminal, a background agent,
// a codex agent and anything a run owns (its engine wakes and ends those) are refused there, so the menu leaves
// them out. A failed Wake toasts here; Sleep owns its confirm and toasts in sleepWithConfirm.
function sleepMenuItems(agent: AgentVM): ContextMenuItem[] {
    if (agent.sleeping) {
        return [
            {
                label: "Wake",
                icon: <Sun size={15} />,
                click: () =>
                    fireAndForget(async () => {
                        try {
                            await wakeAgent(agent.id);
                        } catch (e) {
                            wakeErrorToast(agent.name, e);
                        }
                    }),
            },
        ];
    }
    const sleepable =
        agent.state === "idle" &&
        (agent.kind == null || agent.kind === "agent") &&
        agent.runId == null &&
        SLEEPABLE_AGENTS.has(agent.agent ?? "");
    if (!sleepable) {
        return [];
    }
    return [{ label: "Sleep", icon: <Moon size={15} />, click: () => fireAndForget(() => sleepWithConfirm(agent)) }];
}

const PULSE = "pulse-dot";

// An agent row's Alt+1..9 digit (agentDigits), shown over its leading mark only while Alt is held (digithints.ts).
function useHeldDigit(digit: number | undefined): number | undefined {
    return useAtomValue(digitHintAtom) === "alt" ? digit : undefined;
}

// Every row's leading mark sits in one column, so dots, icons and fold marks line up down the tree.
function Slot({ children }: { children: React.ReactNode }) {
    return <span className="flex w-[14px] shrink-0 items-center justify-center">{children}</span>;
}

// A nested row's tree guides: one line per level above it, through that level's leading column.
const GUIDE_LEFT = ["left-[18px]", "left-[35px]"];

function Guides({ depth }: { depth: 1 | 2 }) {
    return (
        <>
            {GUIDE_LEFT.slice(0, depth).map((left) => (
                <span key={left} className={cn("absolute inset-y-0 w-px bg-edge-strong", left)} />
            ))}
        </>
    );
}

// `word` follows the label only where its @container line has room for it, so a narrow sidebar keeps just the count;
// `wide` asks for more room, for a line that also holds a run's progress and badges
function FoldChip({
    label,
    word,
    wide,
    open,
    onToggle,
    ariaShow,
    ariaHide,
}: {
    label: string;
    word?: string;
    wide?: boolean;
    open: boolean;
    onToggle: () => void;
    ariaShow: string;
    ariaHide: string;
}) {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onToggle();
            }}
            aria-label={open ? ariaHide : ariaShow}
            aria-expanded={open}
            title={word ? `${label} ${word}` : undefined}
            className="inline-flex h-[18px] flex-none items-center gap-[3px] rounded-[5px] border border-edge-mid bg-surface-hover pl-[3px] pr-[6px] text-[10.5px] font-semibold tabular-nums text-ink-mid hover:border-accent hover:text-accent-soft"
        >
            {open ? <ChevronDown size={10} aria-hidden /> : <ChevronRight size={10} aria-hidden />}
            {label}
            {word ? <span className={cn("hidden", wide ? "@[250px]:inline" : "@[200px]:inline")}>{word}</span> : null}
        </button>
    );
}

// One click from anywhere on the surface to an agent's canvas, and back to its terminal when that canvas is the
// one showing: a grid icon beside the name, with the accent dot while it holds boards you have not looked at. The click must not reach the row, which would only focus the agent in whatever mode it was left
function CanvasTag({ model, id }: { model: AgentsViewModel; id: string }) {
    const canvas = useAtomValue(canvasStateAtom(id));
    const showing = useSelectedRowId(model) === id && canvas?.mode === "canvas";
    if (canvas == null) {
        return null;
    }
    const unseen = isUnseen(canvas);
    return (
        <button
            type="button"
            aria-pressed={showing}
            onClick={(e) => {
                e.stopPropagation();
                globalStore.set(model.focusIdAtom, id);
                showTerminal();
                setAgentView(id, showing ? "terminal" : "canvas", Date.now());
            }}
            title={
                showing
                    ? "Back to the terminal"
                    : unseen
                      ? "Show the canvas (updated since you last looked)"
                      : "Show the canvas"
            }
            aria-label={showing ? "Back to the terminal" : "Show the canvas"}
            data-agent-canvas={id}
            className={cn(
                "relative flex h-[16px] w-[16px] flex-none cursor-pointer items-center justify-center rounded-[4px]",
                showing ? "bg-accentbg text-accent" : "text-accent-soft hover:bg-surface-hover"
            )}
        >
            <PenTool size={11} strokeWidth={2} aria-hidden />
            {unseen ? (
                <span
                    aria-label="updated since you last looked"
                    className="absolute right-[0px] top-[0px] h-[5px] w-[5px] rounded-full bg-accent"
                />
            ) : null}
        </button>
    );
}

// A folder's agents working now, folded or open: the working dot an agent's row draws, and how many; the words are its
// label, so the folded row has room for its name
function RunningBadge({ n }: { n: number }) {
    return (
        <span
            data-folder-running={n}
            title={`${n} running`}
            aria-label={`${n} running`}
            className="flex flex-none items-center gap-[4px] whitespace-nowrap text-[11px] tabular-nums text-muted"
        >
            <StatusDot state="working" pulse className="!h-[6px] !w-[6px]" />
            {n}
        </span>
    );
}

// What a folded folder holds, the nav rail's agent mark and a terminal's, each with its number, so it fits beside the
// name and the badges; folderCounts' words are its label. It is the part of the far end that gives way: a mark that
// finds no room wraps onto a hidden second line, whole.
function FolderCounts({ agents, terminals }: { agents: number; terminals: number }) {
    const label = folderCounts(agents, terminals);
    if (label === "") {
        return null;
    }
    return (
        <span
            data-folder-counts={label}
            title={label}
            aria-label={label}
            className="flex h-[14px] min-w-0 flex-wrap content-start items-center gap-x-[6px] overflow-hidden whitespace-nowrap text-[11px] tabular-nums text-ink-faint"
        >
            {agents > 0 ? (
                <span className="flex h-[14px] flex-none items-center gap-[3px]">
                    <Bot size={11} aria-hidden />
                    {agents}
                </span>
            ) : null}
            {terminals > 0 ? (
                <span className="flex h-[14px] flex-none items-center gap-[3px]">
                    <SquareTerminal size={11} aria-hidden />
                    {terminals}
                </span>
            ) : null}
        </span>
    );
}

function AskingBadge({ n }: { n: number }) {
    return <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-warning">{n} asking</span>;
}

// TaskStripBar is a run's per-task strip under its second line: a segment per task, or one bar for a long plan,
// then a divider and the tail every run ends in: Final check, Wrap-up, Land (runstage.ts), so a run whose tasks are
// all green still shows it is not over.
function TaskStripBar({ run }: { run: RunInfo }) {
    const strip = taskStrip(run.dag, run.digest);
    if (strip == null) {
        return null;
    }
    const tail = runStage(run).tail;
    return (
        <div
            role="img"
            aria-label={`${taskStripLabel(run.dag, run.digest)}; ${tail.map((p) => `${p.name} ${p.state}`).join(", ")}`}
            className="mt-[6px] flex h-[3px] gap-[5px]"
        >
            <span className="flex min-w-0 flex-1 gap-[2px]">
                {strip.kind === "segments" ? (
                    strip.states.map((st, i) => (
                        <span key={i} className={cn("min-w-[2px] flex-1 rounded-[1.5px]", SEG_FILL[st])} />
                    ))
                ) : (
                    <>
                        <span className="min-w-0 rounded-[1.5px] bg-success" style={{ flexGrow: strip.done }} />
                        <span
                            className="min-w-0 rounded-[1.5px] bg-edge-strong"
                            style={{ flexGrow: strip.total - strip.done }}
                        />
                    </>
                )}
            </span>
            <span data-run-strip-tail className="flex flex-none gap-[2px] border-l border-edge-strong pl-[5px]">
                {tail.map((p) => (
                    <span
                        key={p.name}
                        data-pip={p.state}
                        title={`${p.name}: ${p.state}`}
                        className={cn("w-3 rounded-[1.5px]", PIP_FILL[p.state])}
                    />
                ))}
            </span>
        </div>
    );
}

// a finished run's check and word; a run that landed with its final check unverified says so, in the amber a held
// land uses, so "Complete" does not claim more than the engine could check
function RunCompleteLabel({ run }: { run: RunInfo }) {
    const unverified = runStage(run).outcome === "unverified";
    const label = `${finishedRunLabel(run)}${unverified ? " · unverified" : ""}`;
    return (
        <span
            data-run-complete={unverified ? "unverified" : "done"}
            className={cn("flex min-w-0 items-center gap-[5px]", unverified ? "text-warning" : "text-success")}
        >
            <Check size={11} aria-hidden className="flex-none" />
            <span className="truncate" title={label}>
                {label}
            </span>
        </span>
    );
}

// the progress line's colour by the run's stage: amber when it needs you, red when its final check failed, green
// while the engine moves it on, and the quiet grey otherwise
const PROGRESS_TEXT: Record<StageTone, string> = {
    asking: "text-warning",
    error: "text-error",
    running: "text-working",
    working: "text-muted",
    muted: "text-muted",
    done: "text-muted",
};

// the ↰ on a run's second line: the session that started it with `wsh runs start`, named in its tooltip only, since
// that session's own row says it. A click focuses that session (the row's own click is for the row). Rendered only
// while the session's tab is in the roster.
function OriginFrom({ model, run }: { model: AgentsViewModel; run: Pick<RunInfo, "originId"> }) {
    const name = useOriginName(model, run.originId);
    if (name == null || !run.originId) {
        return null;
    }
    const tabId = run.originId;
    return (
        <button
            type="button"
            data-origin-from={tabId}
            title={`Started from ${name}`}
            aria-label={`Started from ${name}`}
            onClick={(e) => {
                e.stopPropagation();
                openOriginSession(model, tabId);
            }}
            className="flex flex-none cursor-pointer items-center text-ink-faint hover:text-primary"
        >
            <CornerUpLeft size={11} strokeWidth={2} aria-hidden />
        </button>
    );
}

// the runs and queued plans a session started, as one chip on its meta line: the run glyph and where they stand
// (`3/5`, `queued #2`, `merged`, `2 runs`), the run named in full in its tooltip, since the run's own row says it. A
// click goes to the run (or its queued row). Its own ink: a sleeping row's dimming leaves it be, as the person may
// still be talking to that session.
function OriginChip({ model, link }: { model: AgentsViewModel; link: OriginLink }) {
    return (
        <button
            type="button"
            data-origin-link
            title={link.title}
            aria-label={link.title}
            onClick={(e) => {
                e.stopPropagation();
                openOriginLink(model, link.target);
            }}
            className="flex flex-none cursor-pointer items-center gap-[3px] text-muted hover:text-primary"
        >
            <Workflow size={11} strokeWidth={1.8} aria-hidden className="flex-none" />
            {link.label ? <span>{link.label}</span> : null}
        </button>
    );
}

// RunSubline is a run row's second line: a chip folding its workers away, and how far the plan is.
// a lead's second line: its workers chip and progress, then `from <session>` when a session started the run, then
// `trailing` (the lead's own badges) at its right end
function RunSubline({
    model,
    run,
    open,
    live,
    leadless,
    trailing,
}: {
    model: AgentsViewModel;
    run: RunInfo;
    open: boolean;
    live: number;
    leadless?: boolean;
    trailing?: React.ReactNode;
}) {
    // the runs the tree knows, which a land in line is placed among (landPlace keeps to the run's own project)
    const lineageRuns = useAtomValue(model.lineageAtom).runs;
    if (run.dag == null) {
        // no dag means the lead judged the goal bounded and never submitted a plan, not that a plan is
        // still on its way — so the run's own status is the only truth here. Hardcoding "planning" left
        // a finished bounded run's lead row reading planning for good, the same misreading of an absent
        // dag the engine had in ShouldCloseOrchestratorLead.
        return (
            <div className="mt-[3px] flex min-w-0 items-center gap-[6px] text-[10.5px] tabular-nums">
                {runComplete(run) ? (
                    <RunCompleteLabel run={run} />
                ) : (
                    <span
                        className="truncate text-muted"
                        title={runStatusView(run.status ?? "planning", run.land).label}
                    >
                        {runStatusView(run.status ?? "planning", run.land).label}
                    </span>
                )}
                <OriginFrom model={model} run={run} />
                {trailing != null ? <span className="flex-1" /> : null}
                {trailing}
            </div>
        );
    }
    const { done, total } = runProgress(run.dag);
    // not "N done": the done fold under the run says that, and this chip folds the whole run
    const workers = live > 0 || done === 0;
    const progress = dagProgressLabel(
        run,
        leadless ?? false,
        run.land?.state === "queued" ? Object.values(lineageRuns) : undefined
    );
    return (
        <>
            {/* @container: a narrow line keeps the chip's count and drops its word, so the progress is not cut */}
            <div className="@container mt-[3px] flex min-w-0 items-center gap-[6px] text-[10.5px] tabular-nums">
                <FoldChip
                    label={String(workers ? live : total)}
                    word={workers ? (live === 1 ? "worker" : "workers") : "tasks"}
                    wide
                    open={open}
                    onToggle={() => toggleRunCollapsed(run.runId)}
                    ariaShow="Show workers"
                    ariaHide="Hide workers"
                />
                {runComplete(run) ? (
                    <RunCompleteLabel run={run} />
                ) : (
                    <span className={cn("truncate", PROGRESS_TEXT[runStage(run).tone])} title={progress.title}>
                        {progress.text}
                    </span>
                )}
                <OriginFrom model={model} run={run} />
                {trailing != null ? <span className="flex-1" /> : null}
                {trailing}
            </div>
            <TaskStripBar run={run} />
        </>
    );
}

function ParentRow({
    model,
    agent,
    branch,
    tokens,
    lead,
    navDigit,
    inSplit,
    nested,
    waitsFor,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    branch?: string; // the git branch its session is on (liveBranches); absent until the scan has seen it
    tokens?: number; // its session's token total (livetokensstore); absent until read
    lead?: { run: RunInfo; open: boolean; live: number };
    navDigit?: number; // its Alt+1..9 digit
    inSplit?: boolean; // a cell of the split on screen: the row stays in its folder and wears SplitMark
    nested?: boolean; // it waits on the agent just above it, and sits under it on a tree guide
    waitsFor?: string; // the name of the agent it waits on where it cannot nest under it
}) {
    // the meta the person chose to see on a row (Settings → Appearance → Agent sidebar)
    const fields = useAtomValue(rowFieldsAtom);
    const shownBranch = fields.branch ? notableBranch(branch) : undefined;
    const shownModel = fields.model ? agent.model : undefined;
    const focusId = useSelectedRowId(model);
    const now = useAtomValue(model.nowAtom);
    const oref = `block:${agent.blockId}`;
    // drop children that finished (success/done) so a completed fan-out doesn't linger in the tree
    const subs = visibleSubagents(useAtomValue(subagentsByIdAtom)[agent.id] ?? []);
    const expandOverride = useAtomValue(getSubagentExpandAtom(oref));
    const expanded = subagentExpanded(subs, expandOverride);
    const selected = focusId === agent.id;
    // how many turns it finished that you have not looked at (unreadagents.ts): a count at the row's end, as a chat
    // list shows unread messages, and the name reads bold
    const unreadCount = useAtomValue(unreadAgentsAtom).get(agent.id) ?? 0;
    // an idle turn that stopped on part 1/3 of something waits on your reply: its step takes the count's place, and
    // stays after you have read it, since that is when a reply gets forgotten
    const step = agent.state === "idle" ? agent.step : undefined;
    const unread = unreadCount > 0 || step != null;
    const asking = agent.state === "asking";
    const review = asking ? parseDocReview(agent.ask) : null;
    const mark = lead != null ? leadMark(lead.run, agent) : null;
    // its heavy command waiting its turn in the job queue, whose tag takes the working dot's place
    const queued = queuedJobFor(useAtomValue(jobQueueAtom), agent.blockId);
    // its last turn committed, you have read it and no run it started is still going: the row offers to close it
    // (donesuggest.ts). A sleeping agent offers no Close even when its last turn committed: it is parked, not finished
    const lineageRuns = useAtomValue(model.lineageAtom).runs;
    // the plans it queued with `wsh runs start --queue` hold Close back while they wait to start; wavesrv's queue is
    // also where the `→ Queued #2` line reads them
    const queue = useAtomValue(runQueueAtom);
    // the shell commands and Monitors it left running in the background (a build, a dev server): Close waits for them,
    // since closing the agent would end them, and once its turn ends its glyph reads working, or waiting when they only
    // watch (bgactivity.ts); Servers and the rail's Background tasks list them
    const bgTasks = useAtomValue(backgroundTasksByIdAtom)[agent.id];
    const background = runningBackgroundTasks(bgTasks);
    const machineServers = useAtomValue(machineServersReadingAtom).servers;
    const shown = shownState(agent.state, backgroundActivity(bgTasks, machineServers));
    // the dev servers it left listening: not work, so a green server glyph beside the state instead of a working dot
    const servers = launchedServers(bgTasks, machineServers);
    const done = !agent.sleeping && doneSuggestion(agent, unreadCount, lineageRuns, background.length, queue);
    // where the runs and queued plans it started stand: one chip at the head of its meta line
    const originRuns = useOriginRuns(agent, lineageRuns);
    const originLink = originLinks(agent.id, originRuns, queue);
    const originChip = originLink != null ? <OriginChip model={model} link={originLink} /> : null;
    // a sleeping row steps back to the faintest ink, so it reads apart from an idle one at a glance; being chosen or
    // holding unread turns brings its name back
    const dim = agent.sleeping != null && !selected;
    // m4: one-shot settle when this agent reaches idle (working/asking -> idle)
    const settling = useSettle(shown === "idle");

    const renaming = useAtomValue(renamingRowAtom) === agent.id;
    const digit = useHeldDigit(navDigit);
    const laterAt = laterSince(useAtomValue(laterMarksAtom), agent.transcriptPath);

    const select = () => selectAgentRow(model, agent.id);
    const onContextMenu = (e: React.MouseEvent) => {
        // a lead's row is also its run's: the run's items follow the agent's, and Cancel run sits beside Close agent.
        // The lead's terminal is this row itself
        const runMenu = lead != null ? runMenuItems(model, lead.run.runId, ["run:lead-terminal"]) : null;
        const items: ContextMenuItem[] = [
            { label: "Rename", icon: <Pencil size={15} />, click: () => startRowRename(agent.id) },
            { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, agent.id) },
            ...splitMenuItem(model, agent),
            {
                label: "Copy name",
                icon: <Copy size={15} />,
                click: () => void navigator.clipboard.writeText(agent.name),
            },
            mentionMenuItem(agent),
            laterMenuItem(agent.transcriptPath, laterAt != null),
            ...sleepMenuItems(agent),
            ...(runMenu != null ? [{ type: "separator" } as const, ...runMenu.items] : []),
            { type: "separator" },
            ...(runMenu?.danger ?? []),
            {
                label: "Close agent",
                icon: <X size={15} />,
                danger: true,
                click: () => confirmCloseSession(agent, model),
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    const subsChip =
        subs.length > 0 ? (
            <FoldChip
                label={String(subs.length)}
                word={subs.length === 1 ? "subagent" : "subagents"}
                open={expanded}
                onToggle={() => toggleSubagentExpand(oref, expanded)}
                ariaShow="Show subagents"
                ariaHide="Hide subagents"
            />
        ) : null;

    // a double-click opens the row: the agent chosen and typing in its terminal, as Ctrl+Tab from a terminal brings it.
    // Folding a lead's workers or an agent's subagents is its chip's. A click on a button inside the row is that button's.
    const openRow = !renaming
        ? (e: React.MouseEvent) => {
              if (!(e.target as HTMLElement).closest("button")) {
                  globalStore.set(model.typingFollowsAtom, agent.id);
                  select();
              }
          }
        : undefined;
    // the second press of a double-click would select a word of the name; a single press and a drag are untouched
    const keepSelection =
        openRow != null
            ? (e: React.MouseEvent) => {
                  if (e.detail > 1) {
                      e.preventDefault();
                  }
              }
            : undefined;

    // the state: words when it wants something, else tokens and age. They end the row's second line (a lead's after
    // its workers chip and progress), so the name keeps the first line's full width
    const badges = (
        <>
            {/* a row names its state in words only when it wants something; otherwise its glyph says working, idle or
                sleeping, and a count says how many finished turns you have not read, or the part a turn stopped on
                waiting for your reply */}
            {review ? (
                // a Spec or Plan review opens its dialog over whatever agent is focused, and a Doc review
                // focuses its agent in review mode itself, so the click must not reach the row either way
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        openReview(model, agent.id);
                    }}
                    title={`Open the ${review.kind} review`}
                    className="flex flex-none cursor-pointer items-center gap-1 rounded-[5px] border border-warning/45 bg-askingbg px-[6px] py-[1px] text-[10.5px] font-semibold text-warning hover:border-warning"
                >
                    review
                    <ArrowUpRight size={10} strokeWidth={2.2} aria-hidden />
                </button>
            ) : asking ? (
                <>
                    <span className="flex-none text-[10.5px] font-semibold text-warning">{askingLabel(agent)}</span>
                    {/* a question that names its part ("Phần 1/4 ổn chưa?") shows the part beside it */}
                    {agent.step ? (
                        <span
                            data-agent-step={agent.step}
                            aria-label={`asking about part ${agent.step}`}
                            className="flex h-[15px] flex-none items-center justify-center rounded-full border border-warning/45 bg-askingbg px-[5px] text-[9.5px] font-bold tabular-nums text-warning"
                        >
                            {agent.step}
                        </span>
                    ) : null}
                </>
            ) : (
                <>
                    {/* its glyph carries working, idle or (a moon) sleeping; this slot holds its queued command or the
                        Close a finished one offers */}
                    {queued ? (
                        <QueuedJobTag job={queued} />
                    ) : done ? (
                        // the chip's click is its own: it must not select the row it closes
                        <button
                            type="button"
                            data-agent-done={agent.id}
                            onClick={(e) => {
                                e.stopPropagation();
                                confirmCloseSession(agent, model);
                            }}
                            title={DONE_TITLE}
                            aria-label="Close"
                            className="flex h-[16px] w-[16px] flex-none cursor-pointer items-center justify-center rounded-[4px] text-success hover:bg-surface-hover"
                        >
                            <Check size={12} strokeWidth={2.4} aria-hidden />
                        </button>
                    ) : null}
                    <ServerMark servers={servers} />
                    {fields.tokens && tokens ? (
                        <span className={cn(TOKENS_COL, dim && "text-ink-faint")}>{formatTokens(tokens)}</span>
                    ) : null}
                    {fields.age ? (
                        <span className={AGE_COL}>
                            {agent.sleeping ? sleepingAge(agent, now) : formatAgeShort(displayAgeMs(agent, now))}
                        </span>
                    ) : null}
                    {step ? (
                        <span
                            data-agent-step={step}
                            aria-label={`stopped on part ${step}, waiting on your reply`}
                            className="flex h-[15px] flex-none items-center justify-center rounded-full border border-warning/45 bg-askingbg px-[5px] text-[9.5px] font-bold tabular-nums text-warning"
                        >
                            {step}
                        </span>
                    ) : unread ? (
                        <span
                            data-agent-unread={unreadCount}
                            aria-label={`${unreadCount} finished ${unreadCount === 1 ? "turn" : "turns"} not read yet`}
                            className="flex h-[15px] min-w-[15px] flex-none items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold tabular-nums text-background"
                        >
                            {unreadLabel(unreadCount)}
                        </span>
                    ) : null}
                </>
            )}
        </>
    );

    // The animating motion.div wrapper lives in AgentTree (direct AnimatePresence child, required for
    // popLayout to pop an exiting row out of flow). This is just the row body + subagent reveal.
    return (
        <>
            {/* the runtime and name, then its model, a branch other than the default, its subagents, state, tokens
                and age (a lead's second line: its workers chip and progress, then its state, tokens and age) */}
            <div
                onClick={select}
                onDoubleClick={openRow}
                onMouseDown={keepSelection}
                onContextMenu={onContextMenu}
                data-agent-row={agent.id}
                {...dragSource(agent, !renaming)}
                className={cn(
                    "relative flex min-w-0 cursor-pointer flex-col rounded-[6px] px-[10px] py-[8px] transition-colors duration-[140ms]",
                    // selection is the one filled row; an asking agent says so in words, not in a tint
                    selected ? "bg-surface-selected" : "hover:bg-surface-hover",
                    settling && "animate-[settle_0.5s_ease-out] motion-reduce:animate-none",
                    nested && "pl-[28px]"
                )}
            >
                {nested ? <Guides depth={1} /> : null}
                {renaming ? (
                    <RenameBox tabId={agent.id} shown={agent.name} />
                ) : (
                    <div className="flex min-w-0 items-center gap-[6px]">
                        <DigitHint digit={digit}>
                            {mark ? (
                                <Workflow
                                    size={12}
                                    strokeWidth={1.8}
                                    aria-hidden
                                    className={cn("flex-none", LEAD_MARK_CLASS[mark.tone], mark.pulse && PULSE)}
                                />
                            ) : agent.sleeping ? (
                                <SleepGlyph id={agent.id} runtime={agent.agent} />
                            ) : (
                                <RuntimeGlyph runtime={agent.agent} state={shown} />
                            )}
                        </DigitHint>
                        <span
                            className={cn(
                                "min-w-0 flex-1 truncate text-[13px]",
                                selected || unread ? "text-primary" : dim ? "text-ink-faint" : "text-secondary",
                                unread && "font-semibold"
                            )}
                        >
                            {agent.name}
                        </span>
                        {inSplit ? <SplitMark /> : null}
                        <CanvasTag model={model} id={agent.id} />
                        {laterAt != null ? <LaterMark title={laterTitle(laterAt, now, formatAgeShort)} /> : null}
                        {/* a lead's second line already holds its workers chip, progress and badges */}
                        {lead ? subsChip : null}
                    </div>
                )}
                {lead ? (
                    <RunSubline
                        model={model}
                        run={lead.run}
                        open={lead.open}
                        live={lead.live}
                        trailing={
                            <>
                                {originChip}
                                {badges}
                            </>
                        }
                    />
                ) : (
                    // under the name: the runs it started, its model, a branch other than the default, its subagents
                    // chip and its badges. @container: the subagents chip drops its word when this line is narrow, and
                    // the model truncates
                    <div className={cn(CONVERSATION_META, "@container mt-[3px]", UNDER_GLYPH, dim && "text-ink-faint")}>
                        {waitsFor ? (
                            <span className="flex min-w-0 items-center gap-[3px]" title={`Waiting on ${waitsFor}`}>
                                <Hourglass size={10} aria-hidden className="flex-none" />
                                <span className="truncate">waiting on {waitsFor}</span>
                            </span>
                        ) : null}
                        {originChip}
                        {shownModel ? <span className="min-w-0 truncate">{shownModel}</span> : null}
                        {shownModel && shownBranch ? (
                            <span aria-hidden className="flex-none text-ink-faint">
                                ·
                            </span>
                        ) : null}
                        {shownBranch ? <BranchLabel branch={shownBranch} /> : null}
                        <span className="flex-1" />
                        {subsChip}
                        {badges}
                    </div>
                )}
            </div>
            {/* subagent reveal: the children block expands/collapses via composerReveal (height+opacity).
                It is not a layout node itself, so its height animation and the row-list reflow don't fight. */}
            <AnimatePresence initial={false}>
                {expanded ? (
                    <motion.div key="subs" variants={composerReveal} initial="initial" animate="animate" exit="exit" className="overflow-hidden">
                        {subs.map((s) => (
                            <div
                                key={s.id}
                                onClick={() => {
                                    if (!s.transcriptPath) {
                                        return;
                                    }
                                    globalStore.set(model.focusIdAtom, agent.id);
                                    showTerminal();
                                    globalStore.set(focusSubagentAtom, {
                                        parentId: agent.id,
                                        agentId: s.id,
                                        transcriptPath: s.transcriptPath,
                                        label: s.type || "subagent",
                                    });
                                }}
                                className={cn(
                                    "relative flex items-center gap-[9px] rounded-[6px] py-[6px] pl-[28px] pr-[11px] hover:bg-surface-hover",
                                    s.transcriptPath && "cursor-pointer"
                                )}
                            >
                                <Guides depth={1} />
                                <Slot>
                                    <span
                                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                                        style={{ background: SUB_COLOR[s.state] }}
                                    />
                                </Slot>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[11.5px] font-medium text-secondary">
                                        {s.type || "subagent"}
                                    </div>
                                    <div className="mt-[3px] truncate text-[10.5px] text-muted">
                                        {s.model ?? ""}
                                    </div>
                                </div>
                                {/* the dot carries a live child's state; only a failure is worth the words */}
                                {s.state === "failure" ? (
                                    <span className="whitespace-nowrap text-[10.5px] font-semibold text-error">
                                        failed
                                    </span>
                                ) : null}
                            </div>
                        ))}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </>
    );
}

// A run with workers in the roster and no lead there: a plan-path run before its first judgment event, or
// one whose lead session was closed. Its workers nest under it the way they would under a lead. Having no
// session of its own to focus, a click folds its workers: it sits where its lead did, and a click that left the
// surface read as the close gone wrong. Opening the run and closing the tabs left under its folds are its menu.
function RunRow({ model, run, open, live }: { model: AgentsViewModel; run: RunInfo; open: boolean; live: number }) {
    const onContextMenu = (e: React.MouseEvent) => {
        const tabIds = runAgentsOf(
            globalStore.get(model.lineageAtom),
            globalStore.get(model.agentsAtom),
            run.runId
        ).map((a) => a.id);
        const runMenu = runMenuItems(model, run.runId);
        const items: ContextMenuItem[] = [
            ...runMenu.items,
            { type: "separator" },
            ...runMenu.danger,
            {
                label: "Close run",
                icon: <X size={15} />,
                danger: true,
                click: () => confirmCloseRun(run.title, tabIds),
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    // with no lead to show, a click opens the run's tab that asks or works and unfolds the run so its row shows; a
    // double-click also types into it, as a lead row's does. Folding is the workers chip's. With no such tab (every
    // task still queued), the click only unfolds, so a double-click no longer folds and unfolds back
    const show = (typing: boolean) => {
        openRunFold(run.runId);
        const agent = runFocusAgent(globalStore.get(model.lineageAtom), globalStore.get(model.agentsAtom), run.runId);
        if (agent == null) {
            return;
        }
        if (typing) {
            globalStore.set(model.typingFollowsAtom, agent.id);
        }
        selectAgentRow(model, agent.id);
    };
    // drawn as a lead's row (ParentRow) is: a run reads the same whether or not its lead's tab is open, and only the
    // tokens a lead's session carries are missing
    const mark = leadMark(run, undefined);
    return (
        <div
            onClick={() => show(false)}
            onDoubleClick={() => show(true)}
            // the second press of a double-click would select a word of the title
            onMouseDown={(e) => {
                if (e.detail > 1) {
                    e.preventDefault();
                }
            }}
            onContextMenu={onContextMenu}
            data-agent-run-row={run.runId}
            title="No lead tab open: a click opens the worker that asks or works"
            className="relative flex min-w-0 cursor-pointer flex-col rounded-[6px] px-[10px] py-[8px] transition-colors duration-[140ms] hover:bg-surface-hover"
        >
            <div className="flex min-w-0 items-center gap-[6px]">
                <Workflow
                    size={12}
                    strokeWidth={1.8}
                    aria-hidden
                    className={cn("flex-none", LEAD_MARK_CLASS[mark.tone], mark.pulse && PULSE)}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-secondary">{run.title}</span>
            </div>
            <RunSubline model={model} run={run} open={open} live={live} leadless />
        </div>
    );
}

// A task's worker under its run. A done task's worker opens as its read-only transcript, whether or not its tab
// is still in the roster, so the run's history stays readable after its sessions close. The task's other tabs (its
// reviewer, an earlier attempt) are nested rows under it, named by their own session and opening their own tab.
function WorkerRow({
    model,
    run,
    task,
    agent,
    nested,
    extras,
    navDigit,
}: {
    model: AgentsViewModel;
    run: RunInfo;
    task: TaskNode;
    agent?: AgentVM;
    nested?: boolean;
    extras?: { count: number; open: boolean };
    navDigit?: number; // its agent's Alt+1..9 digit
}) {
    const focusId = useSelectedRowId(model);
    const now = useAtomValue(model.nowAtom);
    // the task's state and question belong to its worker's row, not to the tabs nested under it
    const done = !nested && task.state === "done";
    const lane = laneLabel(run.digest, task.id);
    const ask = done || nested ? undefined : workerAsk(run.digest, task.id);
    // with its tab reaped, a task past its worker still opens that worker's transcript
    const ended = !nested && (done || (agent == null && workerEnded(task)));
    const focusKey = ended ? endedWorkerId(run.runId, task.id) : agent?.id;
    const selected = focusKey != null && focusId === focusKey;
    const waits = done || nested ? undefined : unmetDeps(run.dag, task);
    const asksYou = !done && ask?.owner !== "lead" && (ask?.owner === "you" || agent?.state === "asking");
    // its heavy command waiting its turn in the job queue, tagged at the second line's end
    const jobQueue = useAtomValue(jobQueueAtom);
    const queued = done ? null : queuedJobFor(jobQueue, agent?.blockId);
    const sub = workerSubtext({
        taskId: task.id,
        lane,
        // a question's age is how long it has waited; otherwise the worker's own elapsed time, not its last activity
        age: !nested && !ask ? taskElapsed(task, now) : agent ? formatAgeShort(displayAgeMs(agent, now)) : "",
        ask,
        outcome: done ? (task.merged ? "landed" : "done") : undefined,
        waits,
        state: nested ? undefined : taskStateLabel(task, now),
    });
    const title = nested ? agent?.name || task.id : task.label || task.id;
    const digit = useHeldDigit(navDigit);

    const select = () => {
        if (focusKey == null) {
            return;
        }
        selectAgentRow(model, focusKey);
    };
    const onContextMenu = (e: React.MouseEvent) => {
        if (agent == null) {
            return;
        }
        const split = ended ? [] : splitMenuItem(model, agent);
        const items: ContextMenuItem[] = [
            ...split,
            ...(split.length > 0 ? [{ type: "separator" as const }] : []),
            { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    return (
        <div
            onClick={select}
            onContextMenu={onContextMenu}
            data-agent-row={agent?.id}
            {...dragSource(agent, !ended)}
            className={cn(
                "relative flex items-center gap-[9px] rounded-[6px] py-[7px] pr-[11px] transition-colors duration-[140ms]",
                nested ? "pl-[45px]" : "pl-[28px]",
                focusKey != null && "cursor-pointer",
                selected ? "bg-surface-selected" : focusKey != null && "hover:bg-surface-hover"
            )}
        >
            <Guides depth={nested ? 2 : 1} />
            <Slot>
                <DigitHint digit={digit}>
                    {done ? (
                        // a check, not a dot: dots mean a live session, so a landed worker must not read as one
                        <Check size={11} aria-hidden className="text-success" />
                    ) : waits ? (
                        <span className="h-[7px] w-[7px] shrink-0 rounded-full border border-muted" />
                    ) : (task.state === "verifying" || task.state === "reviewing") && !nested ? (
                        <StatusDot state="working" pulse className="!h-[7px] !w-[7px]" />
                    ) : agent == null ? (
                        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-muted" />
                    ) : (
                        <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
                    )}
                </DigitHint>
            </Slot>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-ink-hi">{title}</div>
                <div className="mt-[3px] flex min-w-0 items-center gap-[6px]">
                    {extras != null && extras.count > 0 ? (
                        <FoldChip
                            label={`${extras.count} ${extras.count === 1 ? "session" : "sessions"}`}
                            open={extras.open}
                            onToggle={() => toggleTaskExtrasOpen(run.runId, task.id)}
                            ariaShow="Show reviewer and earlier sessions"
                            ariaHide="Hide reviewer and earlier sessions"
                        />
                    ) : null}
                    <span className={cn("truncate text-[10.5px] tabular-nums", asksYou ? "text-warning" : "text-muted")}>
                        {sub}
                    </span>
                    {/* its canvas tag and who its ask waits on end the second line, so the title keeps the first */}
                    <span className="flex-1" />
                    {agent != null ? <CanvasTag model={model} id={agent.id} /> : null}
                    {ask?.owner === "lead" ? (
                        <span className="flex flex-none items-center gap-[3px] whitespace-nowrap text-[10.5px] font-medium text-muted">
                            <ArrowRight size={10} aria-hidden />
                            lead
                        </span>
                    ) : asksYou ? (
                        <span className="flex-none whitespace-nowrap text-[10.5px] font-semibold text-warning">
                            {agent?.ask?.hold ? askingLabel(agent) : "asking"}
                        </span>
                    ) : queued ? (
                        <QueuedJobTag job={queued} />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

// A session the engine started to judge the whole run, under the run like a task's worker and named by its stage.
// a finished stage's dot, by verdict: accepted means the review failed and the lead proceeded anyway. passed
// draws a check instead, like a landed worker
const STAGE_OUTCOME_DOT: Record<Exclude<StageOutcome, "passed">, string> = {
    accepted: "bg-warning",
    unverified: "bg-warning",
    failed: "bg-error",
};

function StageRow({
    model,
    agent,
    stageRole,
    outcome,
    navDigit,
    lens,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    stageRole: string;
    outcome?: StageOutcome;
    navDigit?: number; // its Alt+1..9 digit
    lens?: string;
}) {
    const focusId = useSelectedRowId(model);
    const now = useAtomValue(model.nowAtom);
    const selected = focusId === agent.id;
    const digit = useHeldDigit(navDigit);
    const select = () => selectAgentRow(model, agent.id);
    const onContextMenu = (e: React.MouseEvent) => {
        const split = splitMenuItem(model, agent);
        const items: ContextMenuItem[] = [
            ...split,
            ...(split.length > 0 ? [{ type: "separator" as const }] : []),
            { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            onClick={select}
            onContextMenu={onContextMenu}
            data-agent-row={agent.id}
            {...dragSource(agent, true)}
            className={cn(
                "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] py-[7px] pl-[28px] pr-[11px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <Guides depth={1} />
            <Slot>
                <DigitHint digit={digit}>
                    {outcome === "passed" ? (
                        <Check size={11} aria-hidden className="text-success" />
                    ) : outcome ? (
                        <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", STAGE_OUTCOME_DOT[outcome])} />
                    ) : (
                        <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
                    )}
                </DigitHint>
            </Slot>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-ink-hi">
                    {lens ? `${stageLabel(stageRole)} · ${planReviewLensTitle(lens)}` : stageLabel(stageRole)}
                </div>
                <div className="mt-[3px] truncate text-[10.5px] tabular-nums text-muted">
                    {stageSubline(outcome, formatAgeShort(displayAgeMs(agent, now)))}
                </div>
            </div>
        </div>
    );
}

const FINAL_SUB_INK: Record<FinalTone, string> = {
    wait: "text-muted",
    run: "text-accent-soft",
    pass: "text-muted",
    fail: "text-error",
    warn: "text-warning",
};

// The run's final stage, under the run like a task's worker: there from the moment the plan's tasks are over,
// before any verifier session exists. Once the current round's verifier is in the roster the row is that session.
function FinalRow({ model, run, agent }: { model: AgentsViewModel; run: RunInfo; agent?: AgentVM }) {
    const focusId = useAtomValue(model.focusIdAtom);
    const now = useAtomValue(model.nowAtom);
    const view = useFinalStageView(run.dag, run.runId, run.channelId, now);
    const focusKey = finalRowFocusId(run, agent ? [agent] : []);
    const selected = focusId === focusKey;
    const select = () => {
        globalStore.set(model.focusIdAtom, focusKey);
        globalStore.set(model.focusReplyAtom, false);
    };
    const onContextMenu = (e: React.MouseEvent) => {
        if (agent == null) {
            return;
        }
        const items: ContextMenuItem[] = [
            { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            data-final-row
            data-final-tone={view.tone}
            onClick={select}
            onContextMenu={onContextMenu}
            className={cn(
                "relative flex cursor-pointer items-center gap-[9px] rounded-[9px] py-[7px] pl-[28px] pr-[11px] transition-colors duration-[140ms]",
                selected ? "bg-accentbg" : "hover:bg-surface-hover"
            )}
        >
            <Guides depth={1} />
            <Slot>
                {view.tone === "pass" ? (
                    <Check size={11} aria-hidden className="text-success" />
                ) : view.tone === "run" ? (
                    <StatusDot state="working" pulse className="!h-[7px] !w-[7px]" />
                ) : view.tone === "wait" ? (
                    <span className="h-[7px] w-[7px] shrink-0 rounded-full border border-muted" />
                ) : (
                    <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", FINAL_FILL[view.tone])} />
                )}
            </Slot>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-ink-hi">{stageLabel("verifier")}</div>
                <div data-final-sub className={cn("mt-[3px] truncate text-[10.5px] tabular-nums", FINAL_SUB_INK[view.tone])}>
                    {view.subline}
                </div>
            </div>
        </div>
    );
}

// The fold holding a run's done workers or its not-yet-started tasks.
function FoldRow({
    glyph,
    label,
    open,
    onToggle,
}: {
    glyph: React.ReactNode;
    label: string;
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <div
            onClick={onToggle}
            className="relative flex cursor-pointer items-center gap-[9px] rounded-[6px] py-[6px] pl-[28px] pr-[11px] text-[10.5px] tabular-nums text-ink-mid hover:bg-surface-hover hover:text-secondary"
        >
            <Guides depth={1} />
            <Slot>{glyph}</Slot>
            {label}
            <span className="ml-auto flex text-muted">
                {open ? <ChevronDown size={10} aria-hidden /> : <ChevronRight size={10} aria-hidden />}
            </span>
        </div>
    );
}

// A conversation row's shell: two lines, filled while selected, the tooltip and menu its caller's
function ConversationShell({
    selected,
    title,
    onClick,
    onContextMenu,
    data,
    children,
}: {
    selected: boolean;
    title: string;
    onClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    data: Record<string, string>;
    children: React.ReactNode;
}) {
    return (
        <div
            {...data}
            onClick={onClick}
            onContextMenu={onContextMenu}
            title={title}
            className={cn(
                "flex min-w-0 cursor-pointer flex-col gap-[3px] rounded-[6px] px-[10px] py-[8px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            {children}
        </div>
    );
}

// a conversation row's first line: its title, `mark` after it, its tokens, and how long ago it last moved
function ConversationHead({
    selected,
    title,
    age,
    icon,
    mark,
    tokens,
}: {
    selected: boolean;
    title: string;
    age: string;
    icon?: React.ReactNode;
    mark?: React.ReactNode;
    tokens?: number;
}) {
    return (
        <div className="flex min-w-0 items-center gap-[6px]">
            {icon}
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", selected ? "text-primary" : "text-secondary")}>
                {title}
            </span>
            {mark}
            {tokens ? <span className={TOKENS_COL}>{formatTokens(tokens)}</span> : null}
            <span data-agent-session-age className={AGE_COL}>
                {age}
            </span>
        </div>
    );
}

const CONVERSATION_META = "flex min-w-0 items-center gap-[5px] text-[10.5px] tabular-nums text-muted";
// a row's tokens and age end its first line as two right-aligned columns, so they line up down the list
const TOKENS_COL = "min-w-[34px] flex-none whitespace-nowrap text-right text-[11px] tabular-nums text-muted";
const AGE_COL = "min-w-[24px] flex-none whitespace-nowrap text-right text-[11px] tabular-nums text-ink-faint";
// a second line starts under the title, past the runtime glyph and the gap after it
const UNDER_GLYPH = "pl-[18px]";

// the runtime's glyph at the head of a row, in a slot as wide as the run icon so titles line up. On an agent's row it
// also carries the agent's state, where a dot used to: working pulses in the working green, asking in the warning colour, and
// an idle one goes muted, so the rows doing something stand out
function RuntimeGlyph({ runtime, state }: { runtime: string; state?: ShownState }) {
    const rt = runtimeMeta(runtime);
    const busy = state === "working" || state === "asking" || state === "waiting";
    return (
        <span
            data-agent-glyph-state={state}
            className={cn(
                "min-w-[12px] flex-none text-center text-[12px] transition-colors duration-200",
                state == null ? rt.text : GLYPH_COLOR[state],
                busy && (state === "waiting" ? "pulse-dot-slow" : PULSE)
            )}
            title={state == null ? rt.label : `${rt.label} · ${state}`}
        >
            {rt.glyph}
        </span>
    );
}

// a sleeping agent's moon takes its runtime glyph's place, the slot that carries a row's state, so a parked agent reads
// apart from an idle one down the glyph column
function SleepGlyph({ id, runtime }: { id: string; runtime: string }) {
    const label = `${runtimeMeta(runtime).label} · sleeping`;
    return (
        <span title={label} className="flex min-w-[12px] flex-none justify-center text-muted">
            <Moon size={11} strokeWidth={2} aria-label={label} data-agent-sleeping={id} />
        </span>
    );
}

const GLYPH_COLOR: Record<ShownState, string> = {
    working: "text-working",
    waiting: "text-working",
    asking: "text-warning",
    idle: "text-muted",
};

function BranchLabel({ branch }: { branch: string }) {
    return (
        <span className="flex min-w-0 items-center gap-[3px]" title={branch}>
            <GitBranch size={10} aria-hidden className="flex-none" />
            <span className="truncate">{branch}</span>
        </span>
    );
}

function copyTitleItem(title: string): ContextMenuItem {
    return {
        label: "Copy title",
        icon: <Copy size={15} />,
        click: () => void navigator.clipboard.writeText(title),
    };
}

// A row menu's mention item: the token another Claude agent's prompt takes to send this one a message
// (mention-core.ts in the Claude mod), shown beside the label so it can be typed without copying.
function mentionMenuItem(agent: AgentVM): ContextMenuItem {
    const token = mentionToken(agent.id);
    return {
        label: "Copy @mention",
        sublabel: token,
        icon: <AtSign size={15} />,
        click: () => void navigator.clipboard.writeText(token),
    };
}

// A row menu's later item (latermodel.ts): Mark for later, or Done once marked. Disabled for a session with no
// transcript yet, which has no id to file the mark under.
function laterMenuItem(transcriptPath: string | undefined, marked: boolean): ContextMenuItem {
    return marked
        ? {
              label: "Done (clear later)",
              icon: <BookmarkCheck size={15} />,
              click: () => setLater(transcriptPath, false),
          }
        : {
              label: "Mark for later",
              icon: <Bookmark size={15} />,
              enabled: !!transcriptPath,
              click: () => setLater(transcriptPath, true),
          };
}

// The mark after a row's name for a session marked for later; `title` says since when.
function LaterMark({ title }: { title: string }) {
    return (
        <span role="img" aria-label={title} title={title} data-agent-later className="flex flex-none text-ink-faint">
            <Bookmark size={11} fill="currentColor" aria-hidden />
        </span>
    );
}

// laterLabel is an ended conversation's later tooltip, or undefined when it is not marked (a run is never one)
function laterLabel(marks: LaterMarks, row: ConversationEntry, now: number): string | undefined {
    const since = row.kind === "session" ? laterSince(marks, row.session.transcriptpath) : undefined;
    return since != null ? laterTitle(since, now, formatAgeShort) : undefined;
}

// An ended conversation in the Conversations section, on one line: its runtime, first prompt, tokens and how long ago
// it last moved (the folder, or the app bar's filter, names the project). A second line comes only when it tells the
// row apart: a branch other than the default, or, when another shown row has the same title, when it started.
// A click reads its transcript in the centre, where Resume lives. It is not a live row, so it carries no state dot (only
// a small one when it is waiting for you); the title is the prompt on one line and the row's tooltip holds all of it.
// Memoized on strings and booleans: the list re-renders with the 1s clock, a row only when its age label or its
// selection changes.
const ConversationRow = memo(function ConversationRow({
    model,
    row,
    age,
    started,
    selected,
    later,
}: {
    model: AgentsViewModel;
    row: EndedSessionRow;
    age: string;
    started?: string; // startedLabel, for a row whose title another shown row shares
    selected: boolean;
    later?: string; // laterTitle, for a session marked for later
}) {
    const { session } = row;
    const branch = notableBranch(session.branch);
    const onContextMenu = (e: React.MouseEvent) => {
        const items: ContextMenuItem[] = [];
        if (session.resumecommand) {
            items.push({
                label: "Resume",
                icon: <Play size={15} />,
                click: () => runSessionPrimary(model, session),
            });
        }
        items.push(copyTitleItem(row.title), laterMenuItem(session.transcriptpath, later != null));
        if (canDeleteSession(session)) {
            items.push(
                { type: "separator" },
                {
                    label: DELETE_SESSION_LABEL,
                    icon: <Trash2 size={15} />,
                    danger: true,
                    click: () => confirmDeleteSession(session),
                }
            );
        }
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <ConversationShell
            data={{ "data-agent-session-row": row.key, "data-agent-session-project": row.project }}
            selected={selected}
            title={row.tooltip}
            onClick={() => showSession(model, row.key)}
            onContextMenu={onContextMenu}
        >
            <ConversationHead
                selected={selected}
                title={row.title}
                age={age}
                tokens={session.tokenstotal}
                icon={<RuntimeGlyph runtime={session.runtime} />}
                mark={
                    <>
                        {later != null ? <LaterMark title={later} /> : null}
                        {session.needsAttention ? (
                            <span
                                role="img"
                                aria-label="waiting for you"
                                className="h-[6px] w-[6px] flex-none rounded-full bg-warning"
                            />
                        ) : null}
                    </>
                }
            />
            {branch || started ? (
                <div className={cn(CONVERSATION_META, UNDER_GLYPH)}>
                    {branch ? <BranchLabel branch={branch} /> : null}
                    {branch && started ? (
                        <span aria-hidden className="flex-none text-ink-faint">
                            ·
                        </span>
                    ) : null}
                    {started ? <span className="flex-none whitespace-nowrap">{started}</span> : null}
                </div>
            ) : null}
        </ConversationShell>
    );
});

// An ended orchestrator run in the Conversations section, read like a live lead's row: its title, the tokens of all its
// sessions and its age, then how many landed, with its state when that is more than done (cancelled, a task that needs
// you), and a segment per task across the row.
// A click reads its detail in the centre (the run pane), on the member it opens on.
const RunConversationRow = memo(function RunConversationRow({
    model,
    row,
    view,
    age,
    selected,
}: {
    model: AgentsViewModel;
    row: EndedRunRow;
    view: RunView;
    age: string;
    selected: boolean;
}) {
    const landed = view.total > 0 ? `${view.landed}/${view.total} landed` : view.complete ? "complete" : "no tasks";
    return (
        <ConversationShell
            data={{ "data-agent-run-conversation": view.runId, "data-agent-session-project": row.project }}
            selected={selected}
            title={view.title}
            onClick={() => showSession(model, row.key, defaultMember(view))}
            onContextMenu={(e) => ContextMenuModel.getInstance().showContextMenu([copyTitleItem(view.title)], e)}
        >
            <ConversationHead
                selected={selected}
                title={view.title}
                age={age}
                tokens={runTokens(row.group)}
                icon={<Workflow size={12} strokeWidth={1.8} aria-hidden className="flex-none text-ink-mid" />}
            />
            <div className={cn(CONVERSATION_META, UNDER_GLYPH)}>
                {view.complete ? (
                    <span className="flex min-w-0 items-center gap-[4px] text-success">
                        <Check size={11} aria-hidden className="flex-none" />
                        <span className="truncate">{landed}</span>
                    </span>
                ) : (
                    <span className="min-w-0 truncate">{landed}</span>
                )}
                <span className="flex-1" />
                {view.head.key !== "done" ? <StatusMark status={view.head} /> : null}
            </div>
            {/* a segment per task across the whole row, coloured as a live lead's row draws its plan: a landed task green */}
            {view.segs.length > 0 ? (
                <div aria-hidden className="mt-[3px] flex h-[3px] gap-[2px]">
                    {view.segs.map((k, i) => (
                        <span
                            key={i}
                            className="min-w-[2px] flex-1 rounded-[1.5px]"
                            style={{ backgroundColor: k === "done" ? "var(--color-success)" : SEG_COLOR[k] }}
                        />
                    ))}
                </div>
            ) : null}
        </ConversationShell>
    );
});

const PAGER_BUTTON =
    "flex cursor-pointer items-center gap-[6px] rounded-[6px] px-[10px] py-[5px] text-left text-[11.5px] text-ink-mid outline-none transition-colors duration-[140ms] hover:bg-surface-hover hover:text-secondary focus-visible:ring-1 focus-visible:ring-accent";

// The end of a project's ended conversations: one more page, saying how many are still hidden (the count inside the
// words, so it never reads as an age in the column above), and once a press opened more, back to the first page
function ShowMoreConversations({ project, hidden, less }: { project: string; hidden: number; less: boolean }) {
    return (
        <div className="flex items-center gap-[4px]">
            {hidden > 0 ? (
                <button
                    type="button"
                    data-agent-sessions-more={project}
                    aria-label={`Show ${hidden} more ${project} conversations`}
                    onClick={() => showMoreConversations(project)}
                    className={PAGER_BUTTON}
                >
                    <ChevronDown size={11} aria-hidden className="w-[12px] flex-none" />
                    <span className="tabular-nums">Show {hidden} more</span>
                </button>
            ) : null}
            {less ? (
                <button
                    type="button"
                    data-agent-sessions-less={project}
                    aria-label={`Show fewer ${project} conversations`}
                    onClick={() => showLessConversations(project)}
                    className={cn(PAGER_BUTTON, hidden > 0 && "ml-auto")}
                >
                    {hidden > 0 ? null : <ChevronUp size={11} aria-hidden className="w-[12px] flex-none" />}
                    Show less
                    {hidden > 0 ? <ChevronUp size={11} aria-hidden className="flex-none" /> : null}
                </button>
            ) : null}
        </div>
    );
}

const SECTION_LABEL = "flex-none text-[11.5px] font-semibold text-muted";

// a row under a folder row sits one step in; a list the project filter left flat has no folder to sit under
const UNDER_FOLDER = "pl-[14px]";
const rowIndent = (filtered: boolean): string | undefined => (filtered ? undefined : UNDER_FOLDER);

// A sidebar section's header: its label and count, and a chevron that folds the section, read like the details rail's
// section headers. `trailing` sits at the far end and stays while the section is folded, so Active's asking badge is
// never folded away.
function SectionHeader({
    section,
    label,
    count,
    first,
    trailing,
}: {
    section: SidebarSection;
    label: string;
    count: number;
    first?: boolean;
    trailing?: React.ReactNode;
}) {
    const collapsed = useAtomValue(collapsedSectionsAtom);
    const open = !collapsed.includes(section);
    return (
        <div className={cn("flex items-center gap-[6px] px-[8px] pb-[2px]", first ? "pt-[4px]" : "pt-[14px]")}>
            <button
                type="button"
                data-agent-section-toggle={section}
                aria-expanded={open}
                onClick={() => globalStore.set(collapsedSectionsAtom, toggleFold(collapsed, section))}
                className="group flex min-w-0 cursor-pointer items-center gap-[6px] rounded-[5px] text-left outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
                <span className={cn(SECTION_LABEL, "group-hover:text-secondary")}>{label}</span>
                {count > 0 ? <span className="text-[11px] tabular-nums text-ink-faint">{count}</span> : null}
                <ChevronRight
                    size={12}
                    aria-hidden
                    className={cn("flex-none text-ink-faint transition-transform", open && "rotate-90")}
                />
            </button>
            {trailing}
        </div>
    );
}

// is a sidebar section open (its header folds it)
function useSectionOpen(section: SidebarSection): boolean {
    return !useAtomValue(collapsedSectionsAtom).includes(section);
}

// The rows under a section's or a folder's header, opening and closing with foldReveal. initial={false}, so the first
// paint does not reveal them, nor does a section opening replay the folders inside it.
function FoldBody({ open, children }: { open: boolean; children: React.ReactNode }) {
    return (
        <AnimatePresence initial={false}>
            {open ? (
                <motion.div key="body" variants={foldReveal} initial="initial" animate="animate" exit="exit">
                    {children}
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

// A project's folder row, in either section: the chevron and the folder say whether it is open, then the project's name
// (`label` where the folder's key reads otherwise: Home) and, at the far end, `trailing`, which a folded folder keeps
// (what in it wants you, how much it holds).
function FolderRow({
    section,
    project,
    label,
    open,
    onToggle,
    trailing,
}: {
    section: SidebarSection;
    project: string;
    label?: string;
    open: boolean;
    onToggle: () => void;
    trailing?: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            data-agent-folder={project}
            data-agent-folder-section={section}
            data-project-folder={section === "active" ? project : undefined}
            className="flex w-full cursor-pointer items-center gap-[7px] overflow-hidden rounded-[6px] px-[8px] py-[6px] text-left hover:bg-surface-hover"
        >
            <ChevronRight
                size={12}
                aria-hidden
                className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-90")}
            />
            {open ? (
                <FolderOpen size={14} aria-hidden className="shrink-0 text-muted" />
            ) : (
                <Folder size={14} aria-hidden className="shrink-0 text-muted" />
            )}
            {/* the name keeps a few letters however much the far end holds */}
            <span className="min-w-[40px] flex-1 truncate text-[13px] text-secondary">{label ?? project}</span>
            {trailing}
        </button>
    );
}

// Opens a plain terminal in a registered project, the New launcher's Terminal pick without the dialog. Like the
// launcher's, it takes the centre and lands in its project's folder. The Diff panel's sync failure opens one
// in its worktree with it.
export function quickTerminal(model: AgentsViewModel, project: string, path: string) {
    fireAndForget(() =>
        launchAgent(model, {
            runtime: "terminal",
            startupCommand: "",
            task: "",
            projectPath: path,
            projectName: project,
        })
    );
}

// The words after a terminal row's name that say it is an install terminal (Install glow): a spinner and "installing"
// while it runs, "install failed" in the danger token once it exited non-zero and was kept with its output
function InstallState({ state }: { state: Exclude<TerminalRowState, "removed"> }) {
    return state === "installing" ? (
        <span className="flex flex-none items-center gap-[4px] text-[11px] text-ink-faint">
            <Loader2 size={11} aria-hidden className="animate-spin" />
            installing
        </span>
    ) : (
        <span className="flex-none whitespace-nowrap text-[11px] text-error-soft">install failed</span>
    );
}

// A plain terminal or tool in its project's folder, a peer of the agent rows above the divider: the tool's icon and
// name (a plain shell: the terminal icon and its last command), the folder it runs in when that is not the project's
// root, a pulsing dot while its shell runs a command, and where it shows when that is not the centre (the split mark, `panel`).
// A click gives it the centre, as an agent's row does. It drags onto the grid and takes an Alt digit like one, and its
// menu (showTerminalMenu) can open it in a split or move it to the panel. An install terminal reads installing, or
// install failed once it exited non-zero; one whose folder was removed (worktreegone.ts) strikes its folder through and
// reads removed.
function TerminalRow({
    model,
    terminal,
    name,
    icon,
    place,
    shows,
    state,
    navDigit,
}: {
    model: AgentsViewModel;
    terminal: AgentVM;
    name: string; // the tool's name while the terminal still carries the launch label (toolTerminalName)
    icon: ToolIconName;
    place?: string; // the folder it runs in when that is not the project's root (terminalPlace)
    shows?: TerminalShows;
    state?: TerminalRowState;
    navDigit?: number; // its Alt+1..9 digit
}) {
    const selected = useSelectedRowId(model) === terminal.id;
    const renaming = useAtomValue(renamingRowAtom) === terminal.id;
    const digit = useHeldDigit(navDigit);
    const removed = state === "removed";
    // a removed terminal always names the folder it was in, even where no project root says which part is the worktree
    const chip = place ?? (removed ? folderName(terminal.cwd) : undefined);
    return (
        <div
            data-agent-terminal-row={terminal.id}
            data-tree-terminal-row={terminal.id}
            data-terminal-state={state}
            onClick={() => selectAgentRow(model, terminal.id)}
            onContextMenu={(e) => showTerminalMenu(model, terminal, e, name)}
            {...dragSource(terminal, true)}
            className={cn(
                "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <DigitHint digit={digit}>
                <Slot>
                    <ToolGlyph name={icon} className="text-muted" />
                </Slot>
            </DigitHint>
            {renaming ? (
                <RenameBox tabId={terminal.id} shown={name} />
            ) : (
                <span
                    title={name}
                    className={cn(
                        "truncate text-[13px]",
                        // the name takes the row unless a branch chip shares it
                        chip == null ? "min-w-0 flex-1" : "min-w-0 shrink-0 max-w-[60%]",
                        selected ? "text-primary" : "text-secondary"
                    )}
                >
                    {name}
                </span>
            )}
            {chip != null ? (
                <span
                    data-terminal-branch
                    title={removed ? `${chip} was removed` : `Runs in ${chip}`}
                    className="flex min-w-0 flex-1 items-center gap-[3px] overflow-hidden text-[11px] text-muted"
                >
                    <GitBranch size={10} aria-hidden className="flex-none" />
                    <span className={cn("truncate", removed && "line-through")}>{chip}</span>
                </span>
            ) : null}
            {state === "installing" || state === "failed" ? <InstallState state={state} /> : null}
            {removed ? <span className="flex-none whitespace-nowrap text-[11px] text-muted">removed</span> : null}
            {/* a command still running (a dev server, a build) pulses like a working agent; at its prompt, no dot */}
            {terminal.running && state == null ? (
                <span title="Running a command" aria-label="running a command" className="flex flex-none">
                    <StatusDot state="working" pulse className="!h-[6px] !w-[6px]" />
                </span>
            ) : null}
            {shows === "split" ? (
                <SplitMark />
            ) : shows != null ? (
                <span data-terminal-place={shows} className="flex-none text-[11px] text-ink-faint">
                    {shows}
                </span>
            ) : null}
        </div>
    );
}

const SERVICE_TONE = {
    working: { text: "text-working", dot: "bg-working", ring: "border-working" },
    error: { text: "text-error", dot: "bg-error", ring: "border-error" },
    warning: { text: "text-warning", dot: "bg-warning", ring: "border-warning" },
    muted: { text: "text-muted", dot: "bg-muted", ring: "border-muted" },
} as const;

// The Jobs popover's row button (jobqueuepanel.tsx)
const SERVICE_BUTTON =
    "flex-none cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover";

// A held service in its project's folder (servicesstore.ts), after the divider: the app-window icon, its name, what its
// state says (serviceRowWords: words in the tone token, the port, a 6 px dot that is solid, hollow or pulsing; the
// words carry the state, never the color alone) and, on a crashed one, Restart on hover. A click never starts it: one
// with a tab takes the centre as any terminal does, and one that never ran is given its tab and block (openService) and
// takes the centre on its log. Its menu (showServiceMenu) holds the rest.
function ServiceRow({
    model,
    serviceId,
    navDigit,
}: {
    model: AgentsViewModel;
    serviceId: string;
    navDigit?: number; // its Alt+1..9 digit
}) {
    const service = useAtomValue(servicesAtom)?.find((s) => s.id === serviceId);
    const now = useAtomValue(model.nowAtom);
    const selected = useSelectedRowId(model) === (service?.tabid ?? "");
    const digit = useHeldDigit(navDigit);
    if (service == null) {
        return null;
    }
    const w = serviceRowWords(service, now);
    const tone = SERVICE_TONE[w.tone];
    const select = () => {
        if (service.tabid) {
            selectAgentRow(model, service.tabid);
            return;
        }
        fireAndForget(async () => {
            const opened = await openService(service.id);
            if (opened?.tabid) {
                selectAgentRow(model, opened.tabid);
            }
        });
    };
    const restartable = w.action === "restart" && canRestart(service);
    return (
        <div
            data-service-row={service.id}
            data-service-state={service.state}
            onClick={select}
            onContextMenu={(e) => showServiceMenu(model, service, e)}
            className={cn(
                "group relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <DigitHint digit={digit}>
                <Slot>
                    <AppWindow size={13} aria-hidden className="text-muted" />
                </Slot>
            </DigitHint>
            <span
                data-service-name
                title={service.name}
                className={cn(
                    "truncate text-[13px]",
                    // the name keeps its width and the words give way; a row with no words lets the name fill it
                    w.words !== "" ? "max-w-[60%] flex-none" : "min-w-0 flex-1",
                    selected ? "text-primary" : "text-secondary"
                )}
            >
                {service.name}
            </span>
            {w.words !== "" ? (
                <span
                    data-service-words
                    title={w.words}
                    className={cn("min-w-0 flex-1 truncate whitespace-nowrap text-[11px]", tone.text)}
                >
                    {w.words}
                </span>
            ) : null}
            {w.port != null ? (
                <span data-service-port className="flex-none text-[11px] tabular-nums text-muted">
                    {w.port}
                </span>
            ) : null}
            {restartable ? (
                <button
                    type="button"
                    data-service-act="restart"
                    onClick={(e) => {
                        e.stopPropagation();
                        fireAndForget(() => restartService(service.id));
                    }}
                    className={cn(
                        SERVICE_BUTTON,
                        "opacity-0 transition-opacity duration-100 focus-visible:opacity-100 group-hover:opacity-100"
                    )}
                >
                    Restart
                </button>
            ) : null}
            <span
                aria-hidden
                data-service-dot={w.dot}
                className={cn(
                    "h-[6px] w-[6px] flex-none rounded-full",
                    w.dot === "hollow" ? cn("border bg-transparent", tone.ring) : tone.dot,
                    w.dot === "pulse" && "pulse-dot"
                )}
            />
        </div>
    );
}

// A plan queued to start (the run queue, runqueuestore.ts). It has no session or run yet, so a click selects nothing and
// shows nothing in the centre; the tooltip carries the plan, its route and its age instead. Hover offers Start now and
// Remove, and the menu adds Run next (not on the head of the queue, which has nowhere to go). A blocked entry reads in the
// warning token, as a held land does.
function QueuedEntryRow({ model, row }: { model: AgentsViewModel; row: QueuedRow }) {
    const { entry } = row;
    const now = useAtomValue(model.nowAtom);
    const blocked = isBlockedEntry(entry);
    const meta = queuedMeta(row);
    const start = () => fireAndForget(() => startQueuedNow(entry));
    const onContextMenu = (e: React.MouseEvent) => {
        const items: ContextMenuItem[] = [
            { label: "Start now", icon: <Play size={15} />, click: start },
            ...(row.place === 1
                ? []
                : [
                      {
                          label: "Run next",
                          icon: <ChevronUp size={15} />,
                          click: () => fireAndForget(() => runQueuedNext(entry)),
                      },
                  ]),
            { type: "separator" },
            { label: "Remove", icon: <X size={15} />, danger: true, click: () => confirmRemoveQueued(entry) },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    const act =
        "flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[4px] text-muted hover:text-primary";
    return (
        <div
            data-run-queue-row={entry.id}
            title={queuedTooltip(entry, now)}
            onContextMenu={onContextMenu}
            className="group relative flex items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms] hover:bg-surface-hover"
        >
            <Slot>
                <Clock size={13} aria-hidden className={blocked ? LEAD_MARK_CLASS.warning : "text-muted"} />
            </Slot>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-secondary">{entry.title}</div>
                {/* a blocked reason can outrun the row: its own tooltip says all of it */}
                <div
                    data-run-queue-meta
                    title={blocked ? meta : undefined}
                    className={cn("truncate text-[11px]", blocked ? "text-warning" : "text-muted")}
                >
                    {meta}
                </div>
            </div>
            <span className="flex flex-none items-center gap-[2px] opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100">
                <button
                    type="button"
                    data-queue-act="start"
                    title="Start now"
                    aria-label={`Start ${entry.title} now`}
                    onClick={start}
                    className={act}
                >
                    <Play size={12} aria-hidden />
                </button>
                <button
                    type="button"
                    data-queue-act="remove"
                    title="Remove from queue"
                    aria-label={`Remove ${entry.title} from the queue`}
                    onClick={() => confirmRemoveQueued(entry)}
                    className={cn(act, "hover:text-error")}
                >
                    <X size={12} aria-hidden />
                </button>
            </span>
        </div>
    );
}

// The sidebar's second section: every ended conversation and orchestrator run, in a folder per project (the one with the
// newest conversation first), or the chosen project's alone when the app bar narrows the sidebar
// (the switcher names it). A plain list, not the Active section's animated one: it can run
// past a hundred rows (a page at a time per folder), and a row that slid when the filter changed would be noise. The scan
// fills it after first paint, so nothing renders under the header until the archive has loaded.
function ConversationsSection({ model }: { model: AgentsViewModel }) {
    const agents = useAtomValue(model.agentsAtom);
    const archive = useAtomValue(sessionsArchiveAtom);
    const registered = useAtomValue(projectsAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const collapsedList = useAtomValue(collapsedConversationProjectsAtom);
    const presses = useAtomValue(conversationPressesAtom);
    const now = useAtomValue(model.nowAtom);
    const mode = useAtomValue(centerModeAtom);
    const sel = useAtomValue(model.sessionsSelAtom);
    const open = useSectionOpen("conversations");
    // filed under the project name the Active section's folders use (agentsidebarmodel.ts); only the projects added to
    // arcterm, the rest being Conversation History's
    const laterMarks = useAtomValue(laterMarksAtom);
    const { ended, elsewhere } = useMemo(
        () =>
            registeredConversations(
                laterFirst(endedConversationsByProject(archive, agents, registered), laterMarks),
                registered
            ),
        [archive, agents, registered, laterMarks]
    );
    // a clock that moves once a day, so the run views below do not rebuild on every tick
    const today = startOfDay(now);
    const rows = useMemo(
        () => conversationTree(ended, filter, new Set(collapsedList), presses),
        [ended, filter, collapsedList, presses]
    );
    // each shown run's view, from its own objects (loaded on first read); an ended run's dag no longer moves
    const shownRuns = useMemo(() => rows.filter((r): r is EndedRunRow => r.kind === "run"), [rows]);
    const runObjs = useRunObjects(shownRuns.map((r) => r.group.runId));
    const runViews = useMemo(() => {
        const out = new Map<string, RunView>();
        for (const r of shownRuns) {
            const o = runObjs[r.group.runId];
            // `now` reads only into a done run's age text, which the row does not show: it shows its own
            out.set(r.key, runView({ group: r.group, run: o?.run, dag: o?.dag, now: today }));
        }
        return out;
    }, [shownRuns, runObjs, today]);
    const filtered = filter !== ALL_PROJECTS;
    const colliding = useMemo(() => collidingTitles(rows), [rows]);

    return (
        <div data-agent-conversations>
            <SectionHeader section="conversations" label="Conversations" count={conversationCount(ended, filter)} />
            <FoldBody open={open}>
                {archive == null ? null : rows.length === 0 ? (
                    <div className="px-[10px] py-[6px] text-[12px] text-muted">
                        {filtered ? `No past conversations in ${filter}` : "No past conversations"}
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {folderBlocks(rows).map(({ head, body }) => (
                            <Fragment key={head?.kind === "folder" ? `f-${head.project}` : "flat"}>
                                {head?.kind === "folder" ? (
                                    <FolderRow
                                        section="conversations"
                                        project={head.project}
                                        open={head.open}
                                        onToggle={() =>
                                            globalStore.set(
                                                collapsedConversationProjectsAtom,
                                                toggleFold(collapsedList, head.project)
                                            )
                                        }
                                        trailing={
                                            <>
                                                {head.attn > 0 && !head.open ? (
                                                    <span
                                                        role="img"
                                                        aria-label={`${head.attn} waiting for you`}
                                                        className="h-[6px] w-[6px] flex-none rounded-full bg-warning"
                                                    />
                                                ) : null}
                                                <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                                                    {head.count}
                                                </span>
                                            </>
                                        }
                                    />
                                ) : null}
                                <FoldBody open={body.length > 0}>
                                    {body.map((r) => {
                                        switch (r.kind) {
                                            case "more":
                                                return (
                                                    <div key={`more-${r.project}`} className={rowIndent(filtered)}>
                                                        <ShowMoreConversations
                                                            project={r.project}
                                                            hidden={r.hidden}
                                                            less={r.less}
                                                        />
                                                    </div>
                                                );
                                            case "run":
                                                return (
                                                    <div key={r.key} className={rowIndent(filtered)}>
                                                        <RunConversationRow
                                                            model={model}
                                                            row={r}
                                                            view={runViews.get(r.key)}
                                                            age={sessionAgeLabel(r.lastactivets, now)}
                                                            selected={mode === "run" && sel === r.key}
                                                        />
                                                    </div>
                                                );
                                            case "session":
                                                return (
                                                    <div key={r.key} className={rowIndent(filtered)}>
                                                        <ConversationRow
                                                            model={model}
                                                            row={r}
                                                            age={sessionAgeLabel(r.lastactivets, now)}
                                                            started={
                                                                colliding.has(r.key) && r.session.startedts > 0
                                                                    ? startedLabel(r.session.startedts, now)
                                                                    : undefined
                                                            }
                                                            selected={mode === "session" && sel === r.key}
                                                            later={laterLabel(laterMarks, r, now)}
                                                        />
                                                    </div>
                                                );
                                            default:
                                                return null;
                                        }
                                    })}
                                </FoldBody>
                            </Fragment>
                        ))}
                    </div>
                )}
                {archive != null && !filtered && elsewhere > 0 ? (
                    <HistoryElsewhereRow model={model} count={elsewhere} />
                ) : null}
            </FoldBody>
        </div>
    );
}

// Under Conversations: how many conversations belong to folders never added to arcterm, which only Conversation History
// lists. A click opens it.
function HistoryElsewhereRow({ model, count }: { model: AgentsViewModel; count: number }) {
    return (
        <button
            type="button"
            data-agent-conversations-elsewhere
            title="Open Conversation History"
            onClick={() => showHistory(model)}
            className="flex w-full cursor-pointer items-center gap-[6px] rounded-[6px] px-[10px] py-[5px] text-left text-[11.5px] tabular-nums text-ink-mid transition-colors duration-[140ms] hover:bg-surface-hover hover:text-secondary"
        >
            <span className="min-w-0 truncate">{count} in projects not added · History</span>
            <ArrowUpRight size={11} aria-hidden className="ml-auto flex-none" />
        </button>
    );
}

// Under Active while the app bar narrows the sidebar to a project: how many live agents the filter hides, and how many
// of them are asking, so one waiting in another project is not lost. A click widens the sidebar to every project.
function ElsewhereRow({ model, agents, asking }: { model: AgentsViewModel; agents: number; asking: number }) {
    return (
        <button
            type="button"
            data-agent-elsewhere
            title="Show every project"
            onClick={() => globalStore.set(model.projectFilterAtom, ALL_PROJECTS)}
            className="flex w-full cursor-pointer items-center gap-[6px] rounded-[6px] px-[10px] py-[5px] text-left text-[11.5px] tabular-nums text-ink-mid transition-colors duration-[140ms] hover:bg-surface-hover hover:text-secondary"
        >
            <span className="min-w-0 truncate">
                {agents} in other {agents === 1 ? "project" : "projects"}
            </span>
            {asking > 0 ? (
                <span className="whitespace-nowrap font-semibold text-warning">· {asking} asking</span>
            ) : null}
            <ArrowUpRight size={11} aria-hidden className="ml-auto flex-none" />
        </button>
    );
}

// memo: a surface switch re-renders AgentSurface in the same commit that flips it to display:none, and a
// render there has motion measure every layout="position" row at (0,0) and start sliding it there, so
// returning within the ~400ms tween shows the whole list shrinking back into place.
export const AgentTree = memo(function AgentTree({ model }: { model: AgentsViewModel }) {
    const agents = useAtomValue(model.agentsAtom);
    const order = useAtomValue(model.orderAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const folds = useAtomValue(treeFoldsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const collapsedList = useAtomValue(collapsedProjectsAtom);
    const center = useAtomValue(centerModeAtom);
    // One tree per project: each project's live agents, a divider, then its terminals and tools (projectTree), a collapsed
    // project folding to its folder row. The ended conversations are the section under it (ConversationsSection).
    const filter = useAtomValue(model.projectFilterAtom);
    const filtered = filter !== ALL_PROJECTS;
    // an agent waiting on another (a `wsh agents wait`, a watch loop naming its tab) nests under it (agentwaits.ts)
    const bgTasks = useAtomValue(backgroundTasksByIdAtom);
    const waits = useMemo(() => waitMap(agents, bgTasks), [agents, bgTasks]);
    const tree = buildAgentTree(agents, order, lineage, folds, focusId, waits);
    // the split the Agent surface shows (the focused tab's project's grid as it reconciles it, agents and terminals
    // alike): its cells keep their rows, each marked. The docked terminal is no cell: the surface prunes it.
    const projectGrids = useAtomValue(projectGridsAtom);
    const seeded = useAtomValue(rosterSeededAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const dockedId = useAtomValue(dockedTerminalAtom);
    const cells = shownGrid(
        reconcileProjectGrids(projectGrids, {
            focusId,
            eligible: eligibleIds([...agents, ...terminals.filter((t) => t.id !== dockedId)]),
            projectOf: gridProjects([...agents, ...terminals]),
            seeded,
        })
    ).ids;
    // project name -> root path, as activenav.ts builds it: the folders a terminal's branch chip is read against
    const registered = useAtomValue(projectsAtom);
    const roots = useMemo(() => {
        const out = new Map<string, string>();
        for (const [name, project] of Object.entries(registered ?? {})) {
            if (project?.path) {
                out.set(name, project.path);
            }
        }
        return out;
    }, [registered]);
    // the tool library names and icons the terminals opened from it; read once on first mount
    const toolStatus = useAtomValue(toolsStatusAtom);
    useEffect(() => {
        if (toolStatus == null) {
            void loadTools();
        }
    }, [toolStatus]);
    const tools = toolStatus ?? [];
    const installing = useAtomValue(installingAtom);
    const failed = useAtomValue(failedAtom);
    // the terminals whose folder was removed (worktreegonestore.ts); the surface keeps them read
    const gone = useAtomValue(goneTerminalIdsAtom);
    // the plans queued to start (the run queue), each a row in its project's folder under the agents
    useRunQueueFeed();
    const queue = useAtomValue(queuedRowsAtom);
    // the held services (wavesrv's) that are up or in trouble: a row each in its project's folder, after the divider. A
    // sleeping one has none (the selected one keeps its row), and its tab is still no terminal row.
    useEffect(() => ensureServicesFeed(), []);
    const serviceList = useAtomValue(servicesAtom);
    const { services, serviceTabs } = useMemo(
        () => treeServiceInput(serviceList ?? [], focusId),
        [serviceList, focusId]
    );
    const rows = projectTree({
        tree,
        terminals,
        filter,
        collapsed: collapsedList,
        roots,
        queue,
        services,
        serviceTabs,
    });
    // numbered as Alt+1..9 reach them: focusAgentAt walks activeNavOrder, which builds this list from the same inputs
    const digits = agentDigits(treeNavIds(rows));
    // the rows the split on screen shows, each marked (a grid of one cell is no split)
    const splitIds = new Set(cells.length > 1 ? cells : []);
    // what the filter hides: the row under the tree says how many agents are in other projects and how many are asking
    const elsewhere = agentsElsewhere(tree, filter);
    // every project's, whatever the filter: it lights the spider, so an agent asking in a project the filter hides is
    // never out of sight
    const asking = askingCount(agents);
    // each live agent's branch, for its row's second line (as a Conversations row reads its own)
    const archive = useAtomValue(sessionsArchiveAtom);
    const branches = useMemo(() => liveBranches(archive, agents), [archive, agents]);
    useLiveTokens(agents);
    const tokens = useAtomValue(liveTokensAtom);

    useRunDigests(Object.values(lineage.runs));

    useSubagentTracking(agents);

    // no-cascade guard (single constant key — the surface has one roster): mounting or switching to the
    // surface seeds silently, so only agents that arrive after mount fade in. See motiontokens.ts.
    const rowIds = agents.map((a) => a.id);
    const entranceRef = useRef(initialEntranceState());
    const { animate: entranceIds } = computeEntrances(entranceRef.current, "agents", rowIds);
    const idsKey = rowIds.join(",");
    useLayoutEffect(() => {
        entranceRef.current = computeEntrances(entranceRef.current, "agents", rowIds).state;
    }, [idsKey]);

    return (
        <div data-agent-tree className="relative isolate flex w-[248px] shrink-0 select-none flex-col border-r border-border bg-surface">
            <PanelWeb />
            <TreeSpider sensing={asking > 0} />
            <div className="flex flex-col gap-[4px] px-[8px] pb-[4px] pt-[10px]">
                {/* no New agent button here: the app bar's is always on screen above it */}
                <button
                    type="button"
                    data-agent-history-open
                    aria-current={center === "history" ? "true" : undefined}
                    onClick={() => showHistory(model)}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-[8px] rounded-[8px] px-[10px] py-[7px] text-[13px]",
                        center === "history"
                            ? "bg-surface-selected text-primary"
                            : "text-secondary hover:bg-surface-hover hover:text-primary"
                    )}
                >
                    <HistoryIcon size={14} aria-hidden />
                    Conversation History
                </button>
                {/* no count: the row reads nothing from disk until the gallery opens */}
                <button
                    type="button"
                    data-agent-canvases-open
                    aria-current={center === "canvases" ? "true" : undefined}
                    onClick={() => showCanvases(model)}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-[8px] rounded-[8px] px-[10px] py-[7px] text-[13px]",
                        center === "canvases"
                            ? "bg-surface-selected text-primary"
                            : "text-secondary hover:bg-surface-hover hover:text-primary"
                    )}
                >
                    <LayoutGrid size={14} aria-hidden />
                    Canvas gallery
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
                {/* the rows are this wrapper's direct children (AnimatePresence renders no element); relative so popLayout
                    pops an exiting row out of flow in this wrapper's own coordinates */}
                <div data-agent-active-rows className="relative">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {rows.map((r, i) => {
                            // the rows other than an agent's slide into place but never fade: a terminal and a divider
                            // come and go with no entrance or exit of their own
                            const plain = (key: string, body: React.ReactNode) => (
                                <motion.div key={key} layout="position" className={rowIndent(filtered)}>
                                    {body}
                                </motion.div>
                            );
                            switch (r.kind) {
                                case "group": {
                                    return (
                                        <motion.div
                                            key={`g-${r.project}`}
                                            layout="position"
                                            className={i > 0 ? "mt-[4px]" : undefined}
                                        >
                                            <FolderRow
                                                section="active"
                                                project={r.project}
                                                label={projectLabel(r.project)}
                                                open={r.open}
                                                onToggle={() =>
                                                    globalStore.set(
                                                        collapsedProjectsAtom,
                                                        toggleFold(collapsedList, r.project)
                                                    )
                                                }
                                                trailing={
                                                    <>
                                                        {r.running > 0 ? <RunningBadge n={r.running} /> : null}
                                                        {r.attn > 0 ? <AskingBadge n={r.attn} /> : null}
                                                        {r.open ? null : (
                                                            <FolderCounts agents={r.agents} terminals={r.terminals} />
                                                        )}
                                                    </>
                                                }
                                            />
                                        </motion.div>
                                    );
                                }
                                case "divider":
                                    return plain(
                                        `div-${r.project}`,
                                        <div
                                            data-project-divider={r.project}
                                            aria-hidden
                                            className="mx-[10px] my-[4px] h-px bg-border"
                                        />
                                    );
                                case "queuedentry":
                                    return plain(
                                        `queued-entry-${r.entry.id}`,
                                        <QueuedEntryRow model={model} row={r} />
                                    );
                                case "service":
                                    return plain(
                                        `service-${r.serviceId}`,
                                        <ServiceRow
                                            model={model}
                                            serviceId={r.serviceId}
                                            navDigit={r.tabId != null ? digits.get(r.tabId) : undefined}
                                        />
                                    );
                                case "terminal":
                                    return plain(
                                        r.terminal.id,
                                        <TerminalRow
                                            model={model}
                                            terminal={r.terminal}
                                            name={toolTerminalName(r.terminal, tools)}
                                            icon={toolIcon(tools.find((t) => t.id === r.terminal.toolId))}
                                            place={r.place}
                                            shows={terminalShows(r.terminal.id, cells, dockedId)}
                                            state={terminalRowState(r.terminal.id, installing, failed, gone)}
                                            navDigit={digits.get(r.terminal.id)}
                                        />
                                    );
                            }
                            // an agent's row keeps the agent's key wherever it moves (a worker folding into done, an
                            // agent nesting once its run loads), so the move animates instead of remounting
                            let key: string;
                            let body: React.ReactNode;
                            switch (r.kind) {
                                case "parent":
                                    key = r.agent.id;
                                    body = (
                                        <ParentRow
                                            model={model}
                                            agent={r.agent}
                                            branch={branches.get(r.agent.id)}
                                            tokens={tokens.get(r.agent.id)}
                                            navDigit={digits.get(r.agent.id)}
                                            inSplit={splitIds.has(r.agent.id)}
                                            nested={r.nested}
                                            waitsFor={r.waitsFor}
                                        />
                                    );
                                    break;
                                case "lead":
                                    key = r.agent.id;
                                    body = (
                                        <ParentRow
                                            model={model}
                                            agent={r.agent}
                                            branch={branches.get(r.agent.id)}
                                            tokens={tokens.get(r.agent.id)}
                                            lead={{ run: r.run, open: r.open, live: r.live }}
                                            navDigit={digits.get(r.agent.id)}
                                            inSplit={splitIds.has(r.agent.id)}
                                        />
                                    );
                                    break;
                                case "run":
                                    key = `run-${r.run.runId}`;
                                    body = <RunRow model={model} run={r.run} open={r.open} live={r.live} />;
                                    break;
                                case "worker":
                                    key = r.agent?.id ?? `task-${r.run.runId}-${r.task.id}`;
                                    body = (
                                        <WorkerRow
                                            model={model}
                                            run={r.run}
                                            task={r.task}
                                            agent={r.agent}
                                            nested={r.nested}
                                            extras={
                                                r.nested
                                                    ? undefined
                                                    : { count: r.extras ?? 0, open: r.extrasOpen ?? false }
                                            }
                                            navDigit={r.agent != null ? digits.get(r.agent.id) : undefined}
                                        />
                                    );
                                    break;
                                case "stage":
                                    key = r.agent.id;
                                    body = (
                                        <StageRow
                                            model={model}
                                            agent={r.agent}
                                            stageRole={r.stageRole}
                                            outcome={r.outcome}
                                            navDigit={digits.get(r.agent.id)}
                                            lens={r.lens}
                                        />
                                    );
                                    break;
                                case "final":
                                    // the stage's own key before a verifier stands for it, then the session's
                                    key = r.agent?.id ?? `final-${r.run.runId}`;
                                    body = <FinalRow model={model} run={r.run} agent={r.agent} />;
                                    break;
                                case "done":
                                    key = `done-${r.run.runId}`;
                                    body = (
                                        <FoldRow
                                            glyph={
                                                r.failed > 0 ? (
                                                    <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-error" />
                                                ) : (
                                                    <Check size={11} aria-hidden className="text-success" />
                                                )
                                            }
                                            label={[
                                                r.count > 0 ? `${r.count} done` : "",
                                                r.stages > 0
                                                    ? `${r.stages} ${r.stages === 1 ? "review" : "reviews"}`
                                                    : "",
                                                r.failed > 0 ? `${r.failed} failed` : "",
                                            ]
                                                .filter(Boolean)
                                                .join(" · ")}
                                            open={r.open}
                                            onToggle={() => toggleRunDoneOpen(r.run.runId, r.open, r.count)}
                                        />
                                    );
                                    break;
                                case "queued":
                                    key = `queued-${r.run.runId}`;
                                    body = (
                                        <FoldRow
                                            glyph={
                                                <span className="h-[7px] w-[7px] shrink-0 rounded-full border border-muted" />
                                            }
                                            label={`${r.count} queued`}
                                            open={r.open}
                                            onToggle={() => toggleRunQueuedOpen(r.run.runId)}
                                        />
                                    );
                                    break;
                            }
                            // layout="position" so a subagent expand doesn't scale-distort the row — only its
                            // position animates on reflow. Must be the direct AnimatePresence child: popLayout
                            // measures it via ref to pop an exiting row out of flow (else its space lingers).
                            return (
                                <motion.div
                                    key={key}
                                    layout="position"
                                    className={rowIndent(filtered)}
                                    variants={cardVariants}
                                    initial={entranceIds.has(key) ? "initial" : false}
                                    animate="animate"
                                    exit="exit"
                                >
                                    {body}
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
                {rows.length === 0 ? (
                    <div className="px-[10px] py-[6px] text-[12px] text-muted">
                        {filtered ? `No agents running in ${filter}` : "No agents running"}
                    </div>
                ) : null}
                {elsewhere.agents > 0 ? (
                    <ElsewhereRow model={model} agents={elsewhere.agents} asking={elsewhere.asking} />
                ) : null}
                <ConversationsSection model={model} />
            </div>
        </div>
    );
});
