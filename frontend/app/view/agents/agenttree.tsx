// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ctrlHeldAtom } from "@/app/cockpit/ctrlheld";
import { useSettle } from "@/app/element/motionhooks";
import { cardVariants, composerReveal, computeEntrances, initialEntranceState } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { openTarget, peekTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import {
    ArrowRight,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronRight,
    Copy,
    CopyPlus,
    ExternalLink,
    Folder,
    FolderOpen,
    History as HistoryIcon,
    MessageSquare,
    Pencil,
    Play,
    Plus,
    SquareTerminal,
    Workflow,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { confirmCloseRun, confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import { buildAgentTree, stageSubline, type StageOutcome } from "./agenttreemodel";
import { setAgentView } from "./agentview";
import { isUnseen } from "./canvasmodel";
import { canvasStateAtom } from "./canvasstore";
import { renamingRowAtom } from "./rowrenameatom";
import { centerModeAtom, showHistory, showSession, showTerminal } from "./agentcenter";
import {
    buildSidebarRows,
    endedSessionsByProject,
    sessionAgeLabel,
    showMore,
    type EndedSessionRow,
} from "./agentsidebarmodel";
import { projectsAtom } from "./projectsstore";
import { sessionsArchiveAtom } from "./sessionsarchivestore";
import { runSessionPrimary } from "./sessionsdetail";
import { duplicateSession, renameSession, sessionCustomLabel } from "./session-models/sessionsidebarmodel";
import { displayAgeMs, formatAgeShort, type AgentVM } from "./agentsviewmodel";
import { parseDocReview } from "./docreview";
import { openReview } from "./docreviewstore";
import { LEAD_MARK_CLASS, leadMark } from "./leadcardmodel";
import { collapsedProjectsAtom, toggleProject } from "./projectfoldstore";
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
import {
    labelChanged,
    subagentExpanded,
    visibleSubagents,
    type SubagentState,
} from "./session-models/sessionviewmodel";
import { StatusDot } from "./statusdot";
import { focusSubagentAtom, subagentsByIdAtom } from "./subagentsstore";
import { useSubagentTracking } from "./subagenttracking";

const SUB_COLOR: Record<SubagentState, string> = {
    working: "var(--color-accent)",
    success: "var(--color-success)",
    failure: "var(--color-error)",
    done: "var(--color-muted)",
};

function startRowRename(tabId: string): void {
    globalStore.set(renamingRowAtom, tabId);
}

// Scoped to one row on purpose: starting a rename on a second row has already moved the atom, and the
// first box unmounting must not then cancel the box that replaced it.
function endRowRename(tabId: string): void {
    if (globalStore.get(renamingRowAtom) === tabId) {
        globalStore.set(renamingRowAtom, null);
    }
}

// how many times "Show more" was pressed under each project (five more ended sessions per press). Sidebar UI state in a
// module-level atom, so it outlives the tree's re-renders and unmounts; it is not persisted
const sessionPagesAtom = atom<Record<string, number>>({});

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

// The inline rename editor, shared by both row kinds — a session is a tab either way, so both rename
// through the same `session:label` meta. Mounted in place of the row's name while renaming, which is
// why the seed is read on mount: this component's whole lifetime IS the edit.
function RenameBox({ tabId }: { tabId: string }) {
    const [initial] = useState(() => sessionCustomLabel(tabId));
    const [draft, setDraft] = useState(initial);
    // Enter and blur both mean commit and Escape means cancel, but removing a focused input also
    // fires blur — so without this latch, cancelling would immediately commit the draft it discarded.
    const settled = useRef(false);
    const finish = (save: boolean) => {
        if (settled.current) {
            return;
        }
        settled.current = true;
        if (save && labelChanged(draft, initial)) {
            renameSession(tabId, draft);
        }
        endRowRename(tabId);
    };
    // The row can vanish under an open box — its session closed, or the agent exited — and React does
    // not deliver blur to an unmounting input. Without this the atom would keep naming a dead tab and
    // the Escape guard in bindings.ts would go on yielding to a box nobody can see.
    useEffect(() => () => endRowRename(tabId), [tabId]);
    return (
        <input
            autoFocus
            value={draft}
            // the row itself is a click target (select/focus); a click meant for the caret is not one
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    finish(true);
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    finish(false);
                }
            }}
            onBlur={() => finish(true)}
            placeholder="Name this session"
            aria-label="Session name"
            className="w-full min-w-0 rounded-[5px] border border-accent bg-surface px-[5px] text-[13px] font-medium text-primary focus:outline-none"
        />
    );
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
    lead,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    lead?: { run: RunInfo; open: boolean; live: number };
}) {
    const focusId = useSelectedRowId(model);
    const now = useAtomValue(model.nowAtom);
    const oref = `block:${agent.blockId}`;
    // drop children that finished (success/done) so a completed fan-out doesn't linger in the tree
    const subs = visibleSubagents(useAtomValue(subagentsByIdAtom)[agent.id] ?? []);
    const expandOverride = useAtomValue(getSubagentExpandAtom(oref));
    const expanded = subagentExpanded(subs, expandOverride);
    const selected = focusId === agent.id;
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

    // The animating motion.div wrapper lives in AgentTree (direct AnimatePresence child, required for
    // popLayout to pop an exiting row out of flow). This is just the row body + subagent reveal.
    return (
        <>
            <div
                onClick={select}
                onContextMenu={onContextMenu}
                className={cn(
                    "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                    // selection is the one filled row; an asking agent says so in words, not in a tint
                    selected ? "bg-surface-selected" : "hover:bg-surface-hover",
                    settling && "animate-[settle_0.5s_ease-out] motion-reduce:animate-none"
                )}
            >
                <Slot>
                    {mark ? (
                        <Workflow
                            size={13}
                            aria-hidden
                            className={cn(LEAD_MARK_CLASS[mark.tone], mark.pulse && PULSE)}
                        />
                    ) : (
                        <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[7px] !w-[7px]" />
                    )}
                </Slot>
                <div className="min-w-0 flex-1">
                    {renaming ? (
                        <RenameBox tabId={agent.id} />
                    ) : (
                        <div className="flex min-w-0 items-center gap-[6px]">
                            <div
                                className={cn(
                                    "min-w-0 flex-1 truncate text-[13px]",
                                    selected ? "text-primary" : "text-secondary"
                                )}
                            >
                                {agent.name}
                            </div>
                            {/* a lead's second line holds its workers chip and progress, which need its full width */}
                            {lead ? subsChip : null}
                        </div>
                    )}
                    {lead ? <RunSubline run={lead.run} open={lead.open} live={lead.live} /> : null}
                </div>
                {lead ? null : subsChip}
                <CanvasTag model={model} id={agent.id} />
                {/* a row names its state only when it wants something; the dot already says working or idle */}
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
                        className="flex cursor-pointer items-center gap-1 rounded-[5px] border border-warning/45 bg-askingbg px-[6px] py-[1px] text-[10.5px] font-semibold text-warning hover:border-warning"
                    >
                        review
                        <ArrowUpRight size={10} strokeWidth={2.2} aria-hidden />
                    </button>
                ) : asking ? (
                    <span className="text-[10.5px] font-semibold text-warning">asking</span>
                ) : (
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                        {formatAgeShort(displayAgeMs(agent, now))}
                    </span>
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
                                    <div className="mt-[3px] truncate font-mono text-[10.5px] text-muted">
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
        const items: ContextMenuItem[] = [
            { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    return (
        <div
            onClick={select}
            onContextMenu={onContextMenu}
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
        const items: ContextMenuItem[] = [
            { label: "Close agent", icon: <X size={15} />, danger: true, click: () => confirmCloseSession(agent) },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            onClick={select}
            onContextMenu={onContextMenu}
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

// A background terminal row: no agent chrome (no status dot / model / subagents) — just a glyph +
// name that focuses the terminal's block in the surface's focus pane.
function TerminalRow({ model, terminal }: { model: AgentsViewModel; terminal: AgentVM }) {
    const focusId = useSelectedRowId(model);
    const selected = focusId === terminal.id;
    const renaming = useAtomValue(renamingRowAtom) === terminal.id;
    const select = () => selectAgentRow(model, terminal.id);
    // The same actions an agent row offers, minus the agent-only wording: a terminal duplicates into a
    // fresh shell in the same cwd (buildDuplicateBlockMeta copies only launch keys). Rename matters
    // more here than on an agent row — a terminal has no ai-title to name it, so without a rename it
    // is stuck forever on the launch-time label it shares with every other shell in the repo.
    const onContextMenu = (e: React.MouseEvent) => {
        const items: ContextMenuItem[] = [
            { label: "Rename", icon: <Pencil size={15} />, click: () => startRowRename(terminal.id) },
            { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, terminal.id) },
            {
                label: "Copy name",
                icon: <Copy size={15} />,
                click: () => void navigator.clipboard.writeText(terminal.name),
            },
            { type: "separator" },
            {
                label: "Close terminal",
                icon: <X size={15} />,
                danger: true,
                click: () => confirmCloseSession(terminal),
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            onClick={select}
            onContextMenu={onContextMenu}
            className={cn(
                "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <Slot>
                <SquareTerminal size={13} aria-hidden className="text-muted" />
            </Slot>
            <div className="min-w-0 flex-1">
                {renaming ? (
                    <RenameBox tabId={terminal.id} />
                ) : (
                    <div className={cn("truncate text-[13px]", selected ? "text-primary" : "text-secondary")}>
                        {terminal.name}
                    </div>
                )}
            </div>
            <CanvasTag model={model} id={terminal.id} />
        </div>
    );
}

// An ended session under its project: its first prompt and how long ago it last moved. A click reads its transcript in
// the centre, where Resume lives. It is not a live row, so it carries no state dot; the title is the prompt on one line
// and the row's tooltip holds all of it.
function SessionRow({ model, row }: { model: AgentsViewModel; row: EndedSessionRow }) {
    const now = useAtomValue(model.nowAtom);
    const mode = useAtomValue(centerModeAtom);
    const sel = useAtomValue(model.sessionsSelAtom);
    const selected = mode === "session" && sel === row.key;
    const onContextMenu = (e: React.MouseEvent) => {
        const items: ContextMenuItem[] = [];
        if (row.session.resumecommand) {
            items.push({
                label: "Resume",
                icon: <Play size={15} />,
                click: () => runSessionPrimary(model, row.session),
            });
        }
        items.push({
            label: "Copy title",
            icon: <Copy size={15} />,
            click: () => void navigator.clipboard.writeText(row.title),
        });
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };
    return (
        <div
            data-agent-session-row={row.key}
            data-agent-session-project={row.project}
            onClick={() => showSession(model, row.key)}
            onContextMenu={onContextMenu}
            title={row.tooltip}
            className={cn(
                "relative flex cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[6px] transition-colors duration-[140ms]",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <Slot>
                <MessageSquare size={12} aria-hidden className="text-ink-faint" />
            </Slot>
            <div className={cn("min-w-0 flex-1 truncate text-[13px]", selected ? "text-primary" : "text-muted")}>
                {row.title}
            </div>
            <span data-agent-session-age className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
                {sessionAgeLabel(row.lastactivets, now)}
            </span>
        </div>
    );
}

// Five more ended sessions under a project, with how many are still hidden
function MoreSessionsRow({ project, hidden }: { project: string; hidden: number }) {
    return (
        <button
            type="button"
            data-agent-sessions-more={project}
            aria-label={`Show more sessions in ${project}`}
            onClick={() => globalStore.set(sessionPagesAtom, (pages) => showMore(pages, project))}
            className="relative flex w-full cursor-pointer items-center gap-[9px] rounded-[6px] px-[10px] py-[5px] text-left text-[11.5px] text-ink-mid transition-colors duration-[140ms] hover:bg-surface-hover hover:text-secondary"
        >
            <Slot>
                <ChevronDown size={11} aria-hidden />
            </Slot>
            Show more
            <span className="ml-auto tabular-nums text-ink-faint">{hidden}</span>
        </button>
    );
}

// memo: a surface switch re-renders AgentSurface in the same commit that flips it to display:none, and a
// render there has motion measure every layout="position" row at (0,0) and start sliding it there, so
// returning within the ~400ms tween shows the whole list shrinking back into place.
export const AgentTree = memo(function AgentTree({ model }: { model: AgentsViewModel }) {
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const order = useAtomValue(model.orderAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const folds = useAtomValue(treeFoldsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const collapsedList = useAtomValue(collapsedProjectsAtom);
    const archive = useAtomValue(sessionsArchiveAtom);
    const registered = useAtomValue(projectsAtom);
    const pages = useAtomValue(sessionPagesAtom);
    const center = useAtomValue(centerModeAtom);
    const collapsed = new Set(collapsedList);
    const rows = buildAgentTree(agents, order, lineage, folds, focusId);
    // every project is a folder: its live agents, then its ended sessions (agentsidebarmodel.ts), filed under the
    // project name the agents use. A collapsed project hides both; the archive is null until the post-paint scan
    // lands, so the first paint is the agents alone
    const ended = useMemo(() => endedSessionsByProject(archive, agents, registered), [archive, agents, registered]);
    const visibleRows = buildSidebarRows(rows, ended, collapsed, pages);

    useRunDigests(Object.values(lineage.runs));

    useSubagentTracking(agents);

    // no-cascade guard (single constant key — the surface has one roster): mounting or switching to the
    // surface seeds silently, so only agents/terminals that arrive after mount fade in. See motiontokens.ts.
    const rowIds = [...agents.map((a) => a.id), ...terminals.map((t) => t.id)];
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
                <button
                    type="button"
                    onClick={() => globalStore.set(model.newAgentOpenAtom, true)}
                    className="flex w-full cursor-pointer items-center gap-[8px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[7px] text-[13px] text-secondary hover:bg-surface-hover hover:text-primary"
                >
                    <Plus size={14} aria-hidden />
                    New agent
                </button>
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
                <AnimatePresence mode="popLayout" initial={false}>
                    {visibleRows.map((r) => {
                        if (r.kind === "group") {
                            return (
                                <motion.div key={`g-${r.project}`} layout="position">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            globalStore.set(
                                                collapsedProjectsAtom,
                                                toggleProject(collapsedList, r.project)
                                            )
                                        }
                                        aria-expanded={!collapsed.has(r.project)}
                                        className="flex w-full cursor-pointer items-center gap-[7px] rounded-[6px] px-[8px] py-[6px] text-left hover:bg-surface-hover"
                                    >
                                        <ChevronRight
                                            size={12}
                                            aria-hidden
                                            className={cn(
                                                "shrink-0 text-ink-faint transition-transform",
                                                !collapsed.has(r.project) && "rotate-90"
                                            )}
                                        />
                                        {collapsed.has(r.project) ? (
                                            <Folder size={14} aria-hidden className="shrink-0 text-muted" />
                                        ) : (
                                            <FolderOpen size={14} aria-hidden className="shrink-0 text-muted" />
                                        )}
                                        <span className="min-w-0 flex-1 truncate text-[13px] text-secondary">
                                            {r.project}
                                        </span>
                                        {r.attn > 0 ? <AskingBadge n={r.attn} /> : null}
                                    </button>
                                </motion.div>
                            );
                        }
                        if (r.kind === "session" || r.kind === "more") {
                            // initial={false} only drops these rows' own entrance animation, since they arrive after the
                            // post-paint scan; the rows below them keep layout="position" and slide down when the first
                            // scan lands
                            return (
                                <motion.div
                                    key={r.kind === "session" ? `ended-${r.key}` : `more-${r.project}`}
                                    layout="position"
                                    className="pl-[14px]"
                                    variants={cardVariants}
                                    initial={false}
                                    animate="animate"
                                    exit="exit"
                                >
                                    {r.kind === "session" ? (
                                        <SessionRow model={model} row={r} />
                                    ) : (
                                        <MoreSessionsRow project={r.project} hidden={r.hidden} />
                                    )}
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
                                body = <ParentRow model={model} agent={r.agent} />;
                                break;
                            case "lead":
                                key = r.agent.id;
                                body = (
                                    <ParentRow
                                        model={model}
                                        agent={r.agent}
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
                                            r.nested ? undefined : { count: r.extras ?? 0, open: r.extrasOpen ?? false }
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
                                            r.stages > 0 ? `${r.stages} ${r.stages === 1 ? "review" : "reviews"}` : "",
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
                                className="pl-[14px]"
                                variants={cardVariants}
                                initial={entranceIds.has(key) ? "initial" : false}
                                animate="animate"
                                exit="exit"
                            >
                                {body}
                            </motion.div>
                        );
                    })}
                    {terminals.length > 0 ? (
                        <motion.div
                            key="terminals-header"
                            layout="position"
                            className="flex items-center gap-[7px] px-[8px] pb-[4px] pt-[14px]"
                        >
                            <SquareTerminal size={14} aria-hidden className="shrink-0 text-muted" />
                            <span className="min-w-0 flex-1 truncate text-[13px] text-secondary">Terminals</span>
                            <span className="text-[11px] tabular-nums text-ink-faint">{terminals.length}</span>
                        </motion.div>
                    ) : null}
                    {terminals.map((t) => (
                        <motion.div
                            key={t.id}
                            layout="position"
                            className="pl-[14px]"
                            variants={cardVariants}
                            initial={entranceIds.has(t.id) ? "initial" : false}
                            animate="animate"
                            exit="exit"
                        >
                            <TerminalRow model={model} terminal={t} />
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
});
