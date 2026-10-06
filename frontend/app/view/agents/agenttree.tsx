// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ctrlHeldAtom } from "@/app/cockpit/ctrlheld";
import { useSettle } from "@/app/element/motionhooks";
import { cardVariants, composerReveal, computeEntrances, initialEntranceState } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { openTarget, peekTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import {
    ArrowRight,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronRight,
    Columns2,
    Copy,
    CopyPlus,
    ExternalLink,
    Folder,
    FolderOpen,
    History as HistoryIcon,
    Pencil,
    Play,
    SquareTerminal,
    Workflow,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { confirmCloseRun, confirmCloseSession } from "./agentactions";
import { beginAgentDrag, endAgentDrag } from "./agentdragstore";
import type { AgentsViewModel } from "./agents";
import { buildAgentTree, stageSubline, type StageOutcome } from "./agenttreemodel";
import { setAgentView } from "./agentview";
import { isUnseen } from "./canvasmodel";
import { canvasStateAtom } from "./canvasstore";
import { RenameBox, startRowRename } from "./rowrename";
import { renamingRowAtom } from "./rowrenameatom";
import { centerModeAtom, showHistory, showSession, showTerminal } from "./agentcenter";
import {
    activeView,
    ALL_PROJECTS,
    conversationCount,
    conversationTree,
    endedConversationsByProject,
    liveBranches,
    sessionAgeLabel,
    splitActive,
    startOfDay,
    terminalTree,
    type EndedRunRow,
    type EndedSessionRow,
} from "./agentsidebarmodel";
import { projectsAtom } from "./projectsstore";
import { useRunObjects } from "./runobjects";
import { runtimeMeta } from "./runtimemeta";
import { sessionsArchiveAtom } from "./sessionsarchivestore";
import { runSessionPrimary, SEG_COLOR, StatusMark } from "./sessionsdetail";
import { defaultMember, runView, type RunView } from "./sessionsruns";
import { duplicateSession } from "./session-models/sessionsidebarmodel";
import { askingCount, displayAgeMs, formatAgeShort, formatTokens, type AgentVM } from "./agentsviewmodel";
import { parseDocReview } from "./docreview";
import { openReview } from "./docreviewstore";
import { reconcileGrid } from "./agentgrid";
import { agentGridAtom, canOpenInSplit, eligibleIds, endSplit, openInSplit, removeFromGrid } from "./gridstore";
import { LEAD_MARK_CLASS, leadMark } from "./leadcardmodel";
import { rosterSeededAtom } from "./liveagents";
import {
    collapsedConversationProjectsAtom,
    collapsedProjectsAtom,
    collapsedSectionsAtom,
    collapsedTerminalProjectsAtom,
    toggleFold,
    type SidebarSection,
} from "./projectfoldstore";
import {
    endedWorkerId,
    laneLabel,
    runAgentsOf,
    runProgress,
    stageLabel,
    taskStateLabel,
    unmetDeps,
    workerAsk,
    workerEnded,
    workerSubtext,
    type RunInfo,
} from "./runlineage";
import {
    toggleRunCollapsed,
    toggleRunDoneOpen,
    toggleRunQueuedOpen,
    toggleTaskExtrasOpen,
    treeFoldsAtom,
    useRunDigests,
} from "./runlineagestore";
import { dagProgressLabel, finishedRunLabel, runComplete, runStatusView } from "./runmodel";
import { SEG_FILL, taskStrip, taskStripLabel } from "./runstrip";
import {
    getSubagentExpandAtom,
    toggleSubagentExpand,
} from "./session-models/agentstatusstore";
import { subagentExpanded, visibleSubagents, type SubagentState } from "./session-models/sessionviewmodel";
import { StatusDot } from "./statusdot";
import { focusSubagentAtom, subagentsByIdAtom } from "./subagentsstore";
import { useSubagentTracking } from "./subagenttracking";
import { unreadLabel } from "./unreadagents";
import { unreadAgentsAtom } from "./unreadagentsstore";
import { showTerminalMenu } from "./terminalsrail";

const SUB_COLOR: Record<SubagentState, string> = {
    working: "var(--color-accent)",
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

// choosing an agent's row brings its terminal back from a session or History
function selectAgentRow(model: AgentsViewModel, id: string): void {
    globalStore.set(model.focusIdAtom, id);
    globalStore.set(model.focusReplyAtom, false);
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
// with no terminal. The palette has the same action (cockpit/actions/agent.ts).
function splitMenuItem(model: AgentsViewModel, agent: AgentVM): ContextMenuItem[] {
    if (agent.blockId == null) {
        return [];
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

const PULSE = "pulse-dot";

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

function FoldChip({
    label,
    open,
    onToggle,
    ariaShow,
    ariaHide,
}: {
    label: string;
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
            className="inline-flex h-[18px] flex-none items-center gap-[3px] rounded-[5px] border border-edge-mid bg-surface-hover pl-[3px] pr-[6px] text-[10.5px] font-semibold tabular-nums text-ink-mid hover:border-accent hover:text-accent-soft"
        >
            {open ? <ChevronDown size={10} aria-hidden /> : <ChevronRight size={10} aria-hidden />}
            {label}
        </button>
    );
}

// One click from anywhere on the surface to an agent's canvas, and back to its terminal when that canvas is the
// one showing. The click must not reach the row, which would only focus the agent in whatever mode it was left
function CanvasTag({ model, id }: { model: AgentsViewModel; id: string }) {
    const canvas = useAtomValue(canvasStateAtom(id));
    const showing = useSelectedRowId(model) === id && canvas?.mode === "canvas";
    if (canvas == null) {
        return null;
    }
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
            title={showing ? "Back to the terminal" : "Show the canvas"}
            className={cn(
                "flex flex-none cursor-pointer items-center gap-[4px] rounded-[5px] border px-[6px] py-[1px] text-[10.5px] font-semibold text-accent-soft",
                showing ? "border-accent bg-accentbg" : "border-edge-mid hover:border-edge-strong"
            )}
        >
            canvas
            {isUnseen(canvas) ? (
                <span aria-label="updated since you last looked" className="h-[5px] w-[5px] rounded-full bg-accent" />
            ) : null}
        </button>
    );
}

function AskingBadge({ n }: { n: number }) {
    return <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-warning">{n} asking</span>;
}

// TaskStripBar is a run's per-task strip under its second line: a segment per task, or one bar for a long plan.
function TaskStripBar({ run }: { run: RunInfo }) {
    const strip = taskStrip(run.dag, run.digest);
    if (strip == null) {
        return null;
    }
    return (
        <div role="img" aria-label={taskStripLabel(run.dag, run.digest)} className="mt-[6px] flex h-[3px] gap-[2px]">
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
        </div>
    );
}

function RunCompleteLabel({ run }: { run: RunInfo }) {
    return (
        <span className="flex min-w-0 items-center gap-[5px] text-success">
            <Check size={11} aria-hidden className="flex-none" />
            <span className="truncate">{finishedRunLabel(run)}</span>
        </span>
    );
}

// RunSubline is a run row's second line: a chip folding its workers away, and how far the plan is.
function RunSubline({ run, open, live, leadless }: { run: RunInfo; open: boolean; live: number; leadless?: boolean }) {
    if (run.dag == null) {
        // no dag means the lead judged the goal bounded and never submitted a plan, not that a plan is
        // still on its way — so the run's own status is the only truth here. Hardcoding "planning" left
        // a finished bounded run's lead row reading planning for good, the same misreading of an absent
        // dag the engine had in ShouldCloseOrchestratorLead.
        return (
            <div className="mt-[3px] flex min-w-0 text-[10.5px] tabular-nums">
                {runComplete(run) ? (
                    <RunCompleteLabel run={run} />
                ) : (
                    <span className="truncate text-muted">
                        {runStatusView(run.status ?? "planning", run.land).label}
                    </span>
                )}
            </div>
        );
    }
    const { done, total } = runProgress(run.dag);
    // not "N done": the done fold under the run says that, and this chip folds the whole run
    const chip = live > 0 || done === 0 ? `${live} ${live === 1 ? "worker" : "workers"}` : `${total} tasks`;
    const progress = dagProgressLabel(run, leadless ?? false);
    return (
        <>
            <div className="mt-[3px] flex min-w-0 items-center gap-[6px] text-[10.5px] tabular-nums">
                <FoldChip
                    label={chip}
                    open={open}
                    onToggle={() => toggleRunCollapsed(run.runId)}
                    ariaShow="Show workers"
                    ariaHide="Hide workers"
                />
                {runComplete(run) ? (
                    <RunCompleteLabel run={run} />
                ) : (
                    <span className="truncate text-muted">{progress}</span>
                )}
            </div>
            <TaskStripBar run={run} />
        </>
    );
}

function ParentRow({
    model,
    agent,
    branch,
    lead,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    branch?: string; // the git branch its session is on (liveBranches); absent until the scan has seen it
    lead?: { run: RunInfo; open: boolean; live: number };
}) {
    const rt = runtimeMeta(agent.agent);
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
    const unread = unreadCount > 0;
    const asking = agent.state === "asking";
    const review = asking ? parseDocReview(agent.ask) : null;
    const mark = lead != null ? leadMark(lead.run, agent) : null;
    // m4: one-shot settle when this agent reaches idle (working/asking -> idle)
    const settling = useSettle(agent.state === "idle");

    const renaming = useAtomValue(renamingRowAtom) === agent.id;

    const select = () => selectAgentRow(model, agent.id);
    const onContextMenu = (e: React.MouseEvent) => {
        const items: ContextMenuItem[] = [
            { label: "Rename", icon: <Pencil size={15} />, click: () => startRowRename(agent.id) },
            { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, agent.id) },
            ...splitMenuItem(model, agent),
            {
                label: "Copy name",
                icon: <Copy size={15} />,
                click: () => void navigator.clipboard.writeText(agent.name),
            },
            { type: "separator" },
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
                label={`${subs.length} ${subs.length === 1 ? "subagent" : "subagents"}`}
                open={expanded}
                onToggle={() => toggleSubagentExpand(oref, expanded)}
                ariaShow="Show subagents"
                ariaHide="Hide subagents"
            />
        ) : null;

    // a double-click anywhere on the row folds what its chip folds (a lead's workers, an agent's subagents),
    // so the small chip is not the only target. A click on a button inside the row is that button's own.
    const fold =
        lead != null
            ? () => toggleRunCollapsed(lead.run.runId)
            : subs.length > 0
              ? () => toggleSubagentExpand(oref, expanded)
              : null;
    const foldRow =
        fold != null && !renaming
            ? (e: React.MouseEvent) => {
                  if (!(e.target as HTMLElement).closest("button")) {
                      fold();
                  }
              }
            : undefined;
    // the second press of a double-click would select a word of the name; a single press and a drag are untouched
    const keepSelection =
        foldRow != null
            ? (e: React.MouseEvent) => {
                  if (e.detail > 1) {
                      e.preventDefault();
                  }
              }
            : undefined;

    // The animating motion.div wrapper lives in AgentTree (direct AnimatePresence child, required for
    // popLayout to pop an exiting row out of flow). This is just the row body + subagent reveal.
    return (
        <>
            {/* two lines, as a Conversations row reads: the name, its state and age, then its runtime, branch and model
                (a lead's: its workers chip and progress) */}
            <div
                onClick={select}
                onDoubleClick={foldRow}
                onMouseDown={keepSelection}
                onContextMenu={onContextMenu}
                data-agent-row={agent.id}
                {...dragSource(agent, !renaming)}
                className={cn(
                    "relative flex min-w-0 cursor-pointer flex-col rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                    // selection is the one filled row; an asking agent says so in words, not in a tint
                    selected ? "bg-surface-selected" : "hover:bg-surface-hover",
                    settling && "animate-[settle_0.5s_ease-out] motion-reduce:animate-none"
                )}
            >
                {renaming ? (
                    <RenameBox tabId={agent.id} />
                ) : (
                    <div className="flex min-w-0 items-center gap-[6px]">
                        {mark ? (
                            <Workflow
                                size={12}
                                strokeWidth={1.8}
                                aria-hidden
                                className={cn("flex-none", LEAD_MARK_CLASS[mark.tone], mark.pulse && PULSE)}
                            />
                        ) : null}
                        <span
                            className={cn(
                                "min-w-0 flex-1 truncate text-[13px]",
                                selected || unread ? "text-primary" : "text-secondary",
                                unread && "font-semibold"
                            )}
                        >
                            {agent.name}
                        </span>
                        {/* a lead's second line holds its workers chip and progress, which need its full width */}
                        {lead ? subsChip : null}
                        <CanvasTag model={model} id={agent.id} />
                        {/* a row names its state in words only when it wants something; otherwise the dot says
                            working or idle, and a count says how many finished turns you have not read */}
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
                            <span className="flex-none text-[10.5px] font-semibold text-warning">asking</span>
                        ) : (
                            <>
                                {/* the count stands in for an idle agent's grey dot; a working one keeps its pulse */}
                                {mark || (unread && agent.state === "idle") ? null : (
                                    <StatusDot
                                        state={agent.state}
                                        pulse={agent.state !== "idle"}
                                        className="!h-[6px] !w-[6px] flex-none"
                                    />
                                )}
                                <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                                    {formatAgeShort(displayAgeMs(agent, now))}
                                </span>
                                {unread ? (
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
                    </div>
                )}
                {lead ? (
                    <RunSubline run={lead.run} open={lead.open} live={lead.live} />
                ) : (
                    <div className={cn(CONVERSATION_META, "mt-[3px]")}>
                        <span className={cn("flex-none", rt.text)} title={rt.label}>
                            {rt.glyph}
                        </span>
                        {branch ? (
                            <span className="min-w-0 truncate" title={branch}>
                                {branch}
                            </span>
                        ) : null}
                        {agent.model ? (
                            <>
                                <span aria-hidden className="flex-none text-ink-faint">
                                    ·
                                </span>
                                <span className="flex-none whitespace-nowrap">{agent.model}</span>
                            </>
                        ) : null}
                        <span className="flex-1" />
                        {subsChip}
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
        const items: ContextMenuItem[] = [
            {
                label: "Open run",
                icon: <ExternalLink size={15} />,
                // a menu item's click carries no event, so Ctrl is read from the held flag
                click: () => {
                    const target = { kind: "run", runId: run.runId } as const;
                    fireAndForget(() =>
                        globalStore.get(ctrlHeldAtom) ? peekTarget(model, target) : openTarget(model, target)
                    );
                },
            },
            { type: "separator" },
            {
                label: "Close run",
                icon: <X size={15} />,
                danger: true,
                click: () => confirmCloseRun(run.title, tabIds),
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            onClick={() => toggleRunCollapsed(run.runId)}
            onContextMenu={onContextMenu}
            className="relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms] hover:bg-surface-hover"
        >
            <Slot>
                <Workflow size={13} aria-hidden className={LEAD_MARK_CLASS[leadMark(run, undefined).tone]} />
            </Slot>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink-hi">{run.title}</div>
                <RunSubline run={run} open={open} live={live} leadless />
            </div>
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
}: {
    model: AgentsViewModel;
    run: RunInfo;
    task: TaskNode;
    agent?: AgentVM;
    nested?: boolean;
    extras?: { count: number; open: boolean };
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
    const sub = workerSubtext({
        taskId: task.id,
        lane,
        age: agent ? formatAgeShort(displayAgeMs(agent, now)) : "",
        ask,
        outcome: done ? (task.merged ? "landed" : "done") : undefined,
        waits,
        state: nested ? undefined : taskStateLabel(task, now),
    });
    const title = nested ? agent?.name || task.id : task.label || task.id;

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
                </div>
            </div>
            {agent != null ? <CanvasTag model={model} id={agent.id} /> : null}
            {ask?.owner === "lead" ? (
                <span className="flex items-center gap-[3px] whitespace-nowrap text-[10.5px] font-medium text-muted">
                    <ArrowRight size={10} aria-hidden />
                    lead
                </span>
            ) : asksYou ? (
                <span className="whitespace-nowrap text-[10.5px] font-semibold text-warning">asking</span>
            ) : null}
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
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    stageRole: string;
    outcome?: StageOutcome;
}) {
    const focusId = useSelectedRowId(model);
    const now = useAtomValue(model.nowAtom);
    const selected = focusId === agent.id;
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
                {outcome === "passed" ? (
                    <Check size={11} aria-hidden className="text-success" />
                ) : outcome ? (
                    <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", STAGE_OUTCOME_DOT[outcome])} />
                ) : (
                    <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
                )}
            </Slot>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-ink-hi">{stageLabel(stageRole)}</div>
                <div className="mt-[3px] truncate text-[10.5px] tabular-nums text-muted">
                    {stageSubline(outcome, formatAgeShort(displayAgeMs(agent, now)))}
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
                "flex min-w-0 cursor-pointer flex-col gap-[3px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            {children}
        </div>
    );
}

// a conversation row's first line: its title, `mark` after it, and how long ago it last moved
function ConversationHead({
    selected,
    title,
    age,
    icon,
    mark,
}: {
    selected: boolean;
    title: string;
    age: string;
    icon?: React.ReactNode;
    mark?: React.ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-center gap-[6px]">
            {icon}
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", selected ? "text-primary" : "text-secondary")}>
                {title}
            </span>
            {mark}
            <span data-agent-session-age className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                {age}
            </span>
        </div>
    );
}

const CONVERSATION_META = "flex min-w-0 items-center gap-[5px] text-[10.5px] tabular-nums text-muted";

function copyTitleItem(title: string): ContextMenuItem {
    return {
        label: "Copy title",
        icon: <Copy size={15} />,
        click: () => void navigator.clipboard.writeText(title),
    };
}

// An ended conversation in the Conversations section, read like a History card on two lines: its first prompt and how
// long ago it last moved, then its runtime, branch and tokens (the folder, or the app bar's filter, names the project).
// A click reads its transcript in the centre, where Resume lives. It is not a live row, so it carries no state dot (only
// a small one when it is waiting for you); the title is the prompt on one line and the row's tooltip holds all of it.
// Memoized on strings and booleans: the list re-renders with the 1s clock, a row only when its age label or its
// selection changes.
const ConversationRow = memo(function ConversationRow({
    model,
    row,
    age,
    selected,
}: {
    model: AgentsViewModel;
    row: EndedSessionRow;
    age: string;
    selected: boolean;
}) {
    const { session } = row;
    const rt = runtimeMeta(session.runtime);
    const onContextMenu = (e: React.MouseEvent) => {
        const items: ContextMenuItem[] = [];
        if (session.resumecommand) {
            items.push({
                label: "Resume",
                icon: <Play size={15} />,
                click: () => runSessionPrimary(model, session),
            });
        }
        items.push(copyTitleItem(row.title));
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
                mark={
                    session.needsAttention ? (
                        <span
                            role="img"
                            aria-label="waiting for you"
                            className="h-[6px] w-[6px] flex-none rounded-full bg-warning"
                        />
                    ) : null
                }
            />
            <div className={CONVERSATION_META}>
                <span className={cn("flex-none", rt.text)} title={rt.label}>
                    {rt.glyph}
                </span>
                {session.branch ? (
                    <span className="min-w-0 truncate" title={session.branch}>
                        {session.branch}
                    </span>
                ) : null}
                {session.tokenstotal > 0 ? (
                    <>
                        <span aria-hidden className="flex-none text-ink-faint">
                            ·
                        </span>
                        <span className="flex-none whitespace-nowrap">{formatTokens(session.tokenstotal)} tok</span>
                    </>
                ) : null}
            </div>
        </ConversationShell>
    );
});

// An ended orchestrator run in the Conversations section, read like History's run card: its title and age, then a
// segment per task and how many landed, with its state when that is more than done (cancelled, a task that needs you).
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
                icon={<Workflow size={12} strokeWidth={1.8} aria-hidden className="flex-none text-ink-mid" />}
            />
            <div className={CONVERSATION_META}>
                {view.segs.length > 0 ? (
                    <span aria-hidden className="flex w-[64px] flex-none gap-[2px]">
                        {view.segs.map((k, i) => (
                            <span
                                key={i}
                                className="h-[3px] min-w-[2px] flex-1 rounded-[1.5px]"
                                style={{ backgroundColor: view.complete ? "var(--color-success)" : SEG_COLOR[k] }}
                            />
                        ))}
                    </span>
                ) : null}
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
        </ConversationShell>
    );
});

// One more page of a project's ended conversations, with how many are still hidden
function ShowMoreConversations({ project, hidden }: { project: string; hidden: number }) {
    return (
        <button
            type="button"
            data-agent-sessions-more={project}
            aria-label={`Show more ${project} conversations`}
            onClick={() => showMoreConversations(project)}
            className="flex w-full cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[5px] text-left text-[11.5px] text-ink-mid transition-colors duration-[140ms] hover:bg-surface-hover hover:text-secondary"
        >
            <ChevronDown size={11} aria-hidden className="flex-none" />
            Show more
            <span className="ml-auto tabular-nums text-ink-faint">{hidden}</span>
        </button>
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
                className="group flex min-w-0 cursor-pointer items-center gap-[6px] rounded-[5px] text-left"
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

// The Agent surface's split as one row at the top of Active, as a browser shows split tabs: a segment per cell, laid
// out as the cells are (two side by side, three as two over one, four as 2x2), so the row is a map of the screen.
// A click focuses that cell; a segment drags onto the grid like any agent row. The 1px gaps over the edge colour are
// the dividers.
function SplitRow({ model, agents }: { model: AgentsViewModel; agents: AgentVM[] }) {
    const focusId = useSelectedRowId(model);
    const segmentMenu = (agent: AgentVM, e: React.MouseEvent) => {
        const items: ContextMenuItem[] = [
            { label: "Remove from split", icon: <X size={15} />, click: () => removeFromGrid(model, agent.id) },
            { label: "End split", icon: <Columns2 size={15} />, click: () => endSplit(model) },
            {
                label: "Copy name",
                icon: <Copy size={15} />,
                click: () => void navigator.clipboard.writeText(agent.name),
            },
            { type: "separator" },
            {
                label: "Close agent",
                icon: <X size={15} />,
                danger: true,
                click: () => confirmCloseSession(agent, model),
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            data-agent-split-row
            role="group"
            aria-label={`Split, ${agents.length} agents`}
            className="mb-[4px] grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-edge-mid bg-edge-mid"
        >
            {agents.map((agent, i) => {
                const selected = focusId === agent.id;
                return (
                    <div
                        key={agent.id}
                        data-agent-split-cell={agent.id}
                        title={agent.name}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => selectAgentRow(model, agent.id)}
                        onContextMenu={(e) => segmentMenu(agent, e)}
                        {...dragSource(agent, true)}
                        className={cn(
                            "flex min-w-0 cursor-pointer items-center gap-[6px] px-[9px] py-[7px] transition-colors duration-[140ms]",
                            // three cells: the third spans the bottom, as it does on screen
                            agents.length === 3 && i === 2 && "col-span-2",
                            selected ? "bg-surface-selected" : "bg-surface hover:bg-surface-hover"
                        )}
                    >
                        {agent.state === "asking" ? (
                            <span className="h-[7px] w-[7px] flex-none rounded-full bg-warning" aria-label="asking" />
                        ) : (
                            <StatusDot state={agent.state} pulse={agent.state !== "idle"} />
                        )}
                        <span
                            className={cn(
                                "min-w-0 flex-1 truncate text-[12.5px]",
                                selected ? "text-primary" : "text-secondary"
                            )}
                        >
                            {agent.name}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// A project's folder row, in either section: the chevron and the folder say whether it is open, then the project's name
// and, at the far end, `trailing`, which a folded folder keeps (what in it wants you, how much it holds).
function FolderRow({
    section,
    project,
    open,
    onToggle,
    trailing,
}: {
    section: SidebarSection;
    project: string;
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
            className="flex w-full cursor-pointer items-center gap-[7px] rounded-[6px] px-[8px] py-[6px] text-left hover:bg-surface-hover"
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
            <span className="min-w-0 flex-1 truncate text-[13px] text-secondary">{project}</span>
            {trailing}
        </button>
    );
}

// A plain terminal in the Terminals section: its name, filled while it is the focused one. A click focuses it the way
// an agent's row does; its menu is the one a focused terminal's rail offers (showTerminalMenu). Not draggable: only
// agents are grid cells.
function TerminalRow({ model, terminal }: { model: AgentsViewModel; terminal: AgentVM }) {
    const selected = useSelectedRowId(model) === terminal.id;
    const renaming = useAtomValue(renamingRowAtom) === terminal.id;
    return (
        <div
            data-agent-terminal-row={terminal.id}
            onClick={() => selectAgentRow(model, terminal.id)}
            onContextMenu={(e) => showTerminalMenu(model, terminal, e)}
            className={cn(
                "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <Slot>
                <SquareTerminal size={13} aria-hidden className="text-muted" />
            </Slot>
            {renaming ? (
                <RenameBox tabId={terminal.id} />
            ) : (
                <span
                    title={terminal.name}
                    className={cn("min-w-0 flex-1 truncate text-[13px]", selected ? "text-primary" : "text-secondary")}
                >
                    {terminal.name}
                </span>
            )}
        </div>
    );
}

// The sidebar's Terminals section, pinned under the scrolling sections so it is in view however long Conversations runs:
// the plain shells, in a folder per project, or the chosen project's alone (with those that name no project) when the
// app bar narrows the sidebar. With no terminal in view it keeps its header and says so.
function TerminalsSection({ model }: { model: AgentsViewModel }) {
    const terminals = useAtomValue(model.terminalsAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const collapsedList = useAtomValue(collapsedTerminalProjectsAtom);
    const open = useSectionOpen("terminals");
    const rows = useMemo(
        () => terminalTree(terminals, filter, new Set(collapsedList)),
        [terminals, filter, collapsedList]
    );
    // filtered, the list is flat: every row is a terminal
    const count = filter === ALL_PROJECTS ? terminals.length : rows.length;
    return (
        <div
            data-agent-terminals
            className="max-h-[40%] flex-none overflow-y-auto border-t border-border px-[8px] pb-[8px] pt-[6px]"
        >
            <SectionHeader section="terminals" label="Terminals" count={count} first />
            {open && rows.length === 0 ? (
                <div className="px-[10px] py-[6px] text-[12px] text-muted">
                    {filter !== ALL_PROJECTS ? `No terminals in ${filter}` : "No terminals open"}
                </div>
            ) : null}
            {open && rows.length > 0 ? (
                <div className="flex flex-col">
                    {rows.map((r) =>
                        r.kind === "folder" ? (
                            <FolderRow
                                key={`f-${r.project}`}
                                section="terminals"
                                project={r.project}
                                open={r.open}
                                onToggle={() =>
                                    globalStore.set(collapsedTerminalProjectsAtom, toggleFold(collapsedList, r.project))
                                }
                                trailing={
                                    r.open ? null : (
                                        <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                                            {r.count}
                                        </span>
                                    )
                                }
                            />
                        ) : (
                            <div key={r.terminal.id} className={rowIndent(filter !== ALL_PROJECTS)}>
                                <TerminalRow model={model} terminal={r.terminal} />
                            </div>
                        )
                    )}
                </div>
            ) : null}
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
    // filed under the project name the Active section's folders use (agentsidebarmodel.ts)
    const ended = useMemo(
        () => endedConversationsByProject(archive, agents, registered),
        [archive, agents, registered]
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

    return (
        <div data-agent-conversations>
            <SectionHeader section="conversations" label="Conversations" count={conversationCount(ended, filter)} />
            {!open || archive == null ? null : rows.length === 0 ? (
                <div className="px-[10px] py-[6px] text-[12px] text-muted">
                    {filtered ? `No past conversations in ${filter}` : "No past conversations"}
                </div>
            ) : (
                <div className="flex flex-col">
                    {rows.map((r) => {
                        switch (r.kind) {
                            case "folder":
                                return (
                                    <FolderRow
                                        key={`f-${r.project}`}
                                        section="conversations"
                                        project={r.project}
                                        open={r.open}
                                        onToggle={() =>
                                            globalStore.set(
                                                collapsedConversationProjectsAtom,
                                                toggleFold(collapsedList, r.project)
                                            )
                                        }
                                        trailing={
                                            <>
                                                {r.attn > 0 && !r.open ? (
                                                    <span
                                                        role="img"
                                                        aria-label={`${r.attn} waiting for you`}
                                                        className="h-[6px] w-[6px] flex-none rounded-full bg-warning"
                                                    />
                                                ) : null}
                                                <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                                                    {r.count}
                                                </span>
                                            </>
                                        }
                                    />
                                );
                            case "more":
                                return (
                                    <div key={`more-${r.project}`} className={rowIndent(filtered)}>
                                        <ShowMoreConversations project={r.project} hidden={r.hidden} />
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
                                            selected={mode === "session" && sel === r.key}
                                        />
                                    </div>
                                );
                        }
                    })}
                </div>
            )}
        </div>
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
    const collapsed = new Set(collapsedList);
    const activeOpen = useSectionOpen("active");
    // the Active section: each project's live agents, a collapsed project folding to its folder row. The ended
    // conversations are the section under it (ConversationsSection), and the plain terminals are pinned at the foot of
    // the sidebar (TerminalsSection), never mixed in
    const filter = useAtomValue(model.projectFilterAtom);
    const filtered = filter !== ALL_PROJECTS;
    const tree = buildAgentTree(agents, order, lineage, folds, focusId);
    // the split the Agent surface shows (the grid as it reconciles it) leaves the folders for one row of its own;
    // lifted before the folds apply, so a collapsed folder stops counting what it lost
    const gridState = useAtomValue(agentGridAtom);
    const seeded = useAtomValue(rosterSeededAtom);
    const cells = reconcileGrid(gridState, { focusId, eligible: eligibleIds(agents), seeded }).ids;
    const { split, rows: unsplit } = splitActive(tree, cells, agents);
    const active = activeView(unsplit, filter, collapsed);
    const visibleRows = active.rows;
    // every project's, whatever the filter: the badge stays on the header while the section is folded, so an agent asking
    // in a project the filter hides is never out of sight
    const asking = askingCount(agents);
    // each live agent's branch, for its row's second line (as a Conversations row reads its own)
    const archive = useAtomValue(sessionsArchiveAtom);
    const branches = useMemo(() => liveBranches(archive, agents), [archive, agents]);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    return (
        <div data-agent-tree className="flex w-[248px] shrink-0 flex-col border-r border-border bg-surface">
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
                <SectionHeader
                    section="active"
                    label="Active"
                    count={active.count + split.length}
                    first
                    trailing={
                        asking > 0 ? (
                            <span className="ml-auto">
                                <AskingBadge n={asking} />
                            </span>
                        ) : null
                    }
                />
                {/* the rows are this wrapper's direct children (AnimatePresence renders no element); relative so popLayout
                    pops an exiting row out of flow in this wrapper's own coordinates. A folded section unmounts it, and
                    its AnimatePresence starts over with initial={false}, so unfolding never replays the entrances */}
                {activeOpen && split.length > 0 ? <SplitRow model={model} agents={split} /> : null}
                {activeOpen ? (
                    <div data-agent-active-rows className="relative">
                        <AnimatePresence mode="popLayout" initial={false}>
                            {visibleRows.map((r) => {
                                if (r.kind === "group") {
                                    return (
                                        <motion.div key={`g-${r.project}`} layout="position">
                                            <FolderRow
                                                section="active"
                                                project={r.project}
                                                open={!collapsed.has(r.project)}
                                                onToggle={() =>
                                                    globalStore.set(
                                                        collapsedProjectsAtom,
                                                        toggleFold(collapsedList, r.project)
                                                    )
                                                }
                                                trailing={r.attn > 0 ? <AskingBadge n={r.attn} /> : null}
                                            />
                                        </motion.div>
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
                                            <ParentRow model={model} agent={r.agent} branch={branches.get(r.agent.id)} />
                                        );
                                        break;
                                    case "lead":
                                        key = r.agent.id;
                                        body = (
                                            <ParentRow
                                                model={model}
                                                agent={r.agent}
                                                branch={branches.get(r.agent.id)}
                                                lead={{ run: r.run, open: r.open, live: r.live }}
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
                                            />
                                        );
                                        break;
                                    case "done":
                                        key = `done-${r.run.runId}`;
                                        body = (
                                            <FoldRow
                                                glyph={<Check size={11} aria-hidden className="text-success" />}
                                                label={[
                                                    r.count > 0 ? `${r.count} done` : "",
                                                    r.stages > 0
                                                        ? `${r.stages} ${r.stages === 1 ? "review" : "reviews"}`
                                                        : "",
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
                ) : null}
                {activeOpen && visibleRows.length === 0 && split.length === 0 ? (
                    <div className="px-[10px] py-[6px] text-[12px] text-muted">
                        {filtered ? `No agents running in ${filter}` : "No agents running"}
                    </div>
                ) : null}
                {activeOpen && active.elsewhere.agents > 0 ? (
                    <ElsewhereRow model={model} agents={active.elsewhere.agents} asking={active.elsewhere.asking} />
                ) : null}
                <ConversationsSection model={model} />
            </div>
            <TerminalsSection model={model} />
        </div>
    );
});
