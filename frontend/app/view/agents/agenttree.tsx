// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ctrlHeldAtom } from "@/app/cockpit/ctrlheld";
import { useSettle } from "@/app/element/motionhooks";
import { cardVariants, composerReveal, computeEntrances, initialEntranceState } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { openTarget, peekTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    ArrowRight,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronRight,
    Copy,
    CopyPlus,
    ExternalLink,
    Pencil,
    SquareTerminal,
    Workflow,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { agentBranchesAtom, loadAgentBranch } from "./agentbranchstore";
import { confirmCloseRun, confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import { buildAgentTree, stageSubline, treeAgentCount, type StageOutcome } from "./agenttreemodel";
import { isUnseen } from "./canvasmodel";
import { canvasStateAtom, setCanvasMode } from "./canvasstore";
import { renamingRowAtom } from "./rowrenameatom";
import { duplicateSession, renameSession, sessionCustomLabel } from "./session-models/sessionsidebarmodel";
import { displayAgeMs, formatAgeShort, type AgentVM } from "./agentsviewmodel";
import { docReviewAtom, parseDocReview } from "./docreview";
import { finalRowFocusId, type FinalTone } from "./finalstage";
import { useFinalStageView } from "./finalstageviews";
import { LEAD_MARK_CLASS, leadMark } from "./leadcardmodel";
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
import { FINAL_FILL, finalSlot, SEG_FILL, taskStrip, treeStripLabel } from "./runstrip";
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
            className="inline-flex h-[18px] flex-none items-center gap-[3px] rounded-[5px] border border-edge-mid bg-surface-hover pl-[3px] pr-[6px] font-mono text-[10.5px] font-semibold text-ink-mid hover:border-accent hover:text-accent-soft"
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
    const showing = useAtomValue(model.focusIdAtom) === id && canvas?.mode === "canvas";
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
                setCanvasMode(id, showing ? "terminal" : "canvas", Date.now());
            }}
            title={showing ? "Back to the terminal" : "Show the canvas"}
            className={cn(
                "flex flex-none cursor-pointer items-center gap-[4px] rounded-[5px] border px-[6px] py-[1px] font-mono text-[10.5px] font-semibold text-accent-soft",
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
    return (
        <span className="whitespace-nowrap rounded-[5px] bg-askingbg px-[6px] py-[1px] font-mono text-[10.5px] font-semibold text-warning">
            {n} asking
        </span>
    );
}

// TaskStripBar is a run's per-task strip under its second line: a segment per task, or one bar for a long plan,
// then the final stage's slot once the stage has a row.
function TaskStripBar({ run }: { run: RunInfo }) {
    const strip = taskStrip(run.dag, run.digest);
    if (strip == null) {
        return null;
    }
    const slot = finalSlot(run.dag);
    return (
        <div role="img" aria-label={treeStripLabel(run.dag, run.digest)} className="mt-[6px] flex h-[3px] gap-[2px]">
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
            {slot != null ? (
                <>
                    <span className="w-[4px] flex-none" />
                    {/* twice a task's segment; a long plan's bar grows by its task counts, so the slot is fixed there */}
                    <span
                        data-final-slot={slot}
                        className={cn(
                            "rounded-[1.5px]",
                            strip.kind === "segments" ? "flex-[2]" : "w-[16px] flex-none",
                            FINAL_FILL[slot]
                        )}
                    />
                </>
            ) : null}
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
            <div className="mt-[3px] flex min-w-0 font-mono text-[10.5px]">
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
            <div className="mt-[3px] flex min-w-0 items-center gap-[6px] font-mono text-[10.5px]">
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
    const focusId = useAtomValue(model.focusIdAtom);
    const branch = useAtomValue(agentBranchesAtom)[agent.id];
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

    const select = () => {
        globalStore.set(model.focusIdAtom, agent.id);
        globalStore.set(model.focusReplyAtom, false);
    };
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
                    "relative flex cursor-pointer items-center gap-[9px] rounded-[9px] px-[11px] py-[9px] transition-colors duration-[140ms]",
                    // m3 attention: a static amber tint marks an asking row (the pulse lives in the dot, not the row);
                    // selection wins the background so the focused row still reads as focused.
                    selected ? "bg-accentbg" : asking ? "bg-warning/[0.06]" : "hover:bg-surface-hover",
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
                            <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-hi">
                                {agent.name}
                            </div>
                            {/* a lead's second line holds its workers chip and progress, which need its full width */}
                            {lead ? subsChip : null}
                        </div>
                    )}
                    {lead ? (
                        <RunSubline run={lead.run} open={lead.open} live={lead.live} />
                    ) : (
                        <div className="mt-[3px] flex min-w-0 items-center gap-[6px]">
                            {subsChip}
                            <span className="truncate font-mono text-[10.5px] text-muted">{branch || "—"}</span>
                        </div>
                    )}
                </div>
                <CanvasTag model={model} id={agent.id} />
                {/* a row names its state only when it wants something; the dot already says working or idle */}
                {review ? (
                    // opens the dialog over whatever agent is focused, so the click must not reach the row
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            globalStore.set(docReviewAtom, agent.id);
                        }}
                        title={`Open the ${review.kind} review`}
                        className="flex cursor-pointer items-center gap-1 rounded-[5px] border border-warning/45 bg-askingbg px-[6px] py-[1px] font-mono text-[10.5px] font-semibold text-warning hover:border-warning"
                    >
                        review
                        <ArrowUpRight size={10} strokeWidth={2.2} aria-hidden />
                    </button>
                ) : asking ? (
                    <span className="font-mono text-[10.5px] font-semibold text-warning">asking</span>
                ) : null}
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
                                    globalStore.set(focusSubagentAtom, {
                                        parentId: agent.id,
                                        agentId: s.id,
                                        transcriptPath: s.transcriptPath,
                                        label: s.type || "subagent",
                                    });
                                }}
                                className={cn(
                                    "relative flex items-center gap-[9px] rounded-[9px] py-[6px] pl-[28px] pr-[11px] hover:bg-surface-hover",
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
                                    <div className="truncate font-mono text-[11.5px] font-medium text-secondary">
                                        {s.type || "subagent"}
                                    </div>
                                    <div className="mt-[3px] truncate font-mono text-[10.5px] text-muted">
                                        {s.model ?? ""}
                                    </div>
                                </div>
                                {/* the dot carries a live child's state; only a failure is worth the words */}
                                {s.state === "failure" ? (
                                    <span className="whitespace-nowrap font-mono text-[10.5px] font-semibold text-error">
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
            className="relative flex cursor-pointer items-center gap-[9px] rounded-[9px] px-[11px] py-[9px] transition-colors duration-[140ms] hover:bg-surface-hover"
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
    const focusId = useAtomValue(model.focusIdAtom);
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
            onClick={select}
            onContextMenu={onContextMenu}
            className={cn(
                "relative flex items-center gap-[9px] rounded-[9px] py-[7px] pr-[11px] transition-colors duration-[140ms]",
                nested ? "pl-[45px]" : "pl-[28px]",
                focusKey != null && "cursor-pointer",
                selected
                    ? "bg-accentbg"
                    : asksYou
                      ? "bg-warning/[0.06]"
                      : focusKey != null && "hover:bg-surface-hover"
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
                    <span className={cn("truncate font-mono text-[10.5px]", asksYou ? "text-warning" : "text-muted")}>
                        {sub}
                    </span>
                </div>
            </div>
            {agent != null ? <CanvasTag model={model} id={agent.id} /> : null}
            {ask?.owner === "lead" ? (
                <span className="flex items-center gap-[3px] whitespace-nowrap font-mono text-[10.5px] font-medium text-muted">
                    <ArrowRight size={10} aria-hidden />
                    lead
                </span>
            ) : asksYou ? (
                <span className="whitespace-nowrap font-mono text-[10.5px] font-semibold text-warning">asking</span>
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
    const focusId = useAtomValue(model.focusIdAtom);
    const now = useAtomValue(model.nowAtom);
    const selected = focusId === agent.id;
    const select = () => {
        globalStore.set(model.focusIdAtom, agent.id);
        globalStore.set(model.focusReplyAtom, false);
    };
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
                "relative flex cursor-pointer items-center gap-[9px] rounded-[9px] py-[7px] pl-[28px] pr-[11px] transition-colors duration-[140ms]",
                selected ? "bg-accentbg" : "hover:bg-surface-hover"
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
                <div className="mt-[3px] truncate font-mono text-[10.5px] text-muted">
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
                <div className={cn("mt-[3px] truncate font-mono text-[10.5px]", FINAL_SUB_INK[view.tone])}>
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
            className="relative flex cursor-pointer items-center gap-[9px] rounded-[9px] py-[6px] pl-[28px] pr-[11px] font-mono text-[10.5px] text-ink-mid hover:bg-surface-hover hover:text-secondary"
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
    const focusId = useAtomValue(model.focusIdAtom);
    const selected = focusId === terminal.id;
    const renaming = useAtomValue(renamingRowAtom) === terminal.id;
    const select = () => {
        globalStore.set(model.focusIdAtom, terminal.id);
        globalStore.set(model.focusReplyAtom, false);
    };
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
                "relative flex cursor-pointer items-center gap-[9px] rounded-[9px] px-[11px] py-[9px] transition-colors duration-[140ms]",
                selected ? "bg-accentbg" : "hover:bg-surface-hover"
            )}
        >
            <Slot>
                <SquareTerminal size={13} aria-hidden className="text-muted" />
            </Slot>
            <div className="min-w-0 flex-1">
                {renaming ? (
                    <RenameBox tabId={terminal.id} />
                ) : (
                    <div className="truncate text-[13px] font-medium text-ink-hi">{terminal.name}</div>
                )}
            </div>
            <CanvasTag model={model} id={terminal.id} />
        </div>
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
    const rows = buildAgentTree(agents, order, lineage, folds, focusId);
    // the project group only earns a row when several projects are live: with one, its name and count
    // just restate the header, so suppressing it reads the tree at two levels instead of three. Counts
    // come off the unfiltered rows, and the lone group's attention moves to the header with it.
    const total = treeAgentCount(rows);
    const groupRows = rows.filter((r) => r.kind === "group");
    const multiProject = groupRows.length > 1;
    const visibleRows = multiProject ? rows : rows.filter((r) => r.kind !== "group");
    const headerAttn = multiProject ? 0 : groupRows.reduce((n, r) => n + (r.kind === "group" ? r.attn : 0), 0);

    useRunDigests(Object.values(lineage.runs));

    useSubagentTracking(agents);

    // resolve each agent's real branch for its row (cached per cwd-source; see agentbranchstore.ts)
    useEffect(() => {
        for (const a of agents) {
            void loadAgentBranch(a.id, a.transcriptPath, a.blockId);
        }
    }, [agents.map((a) => `${a.id}:${a.transcriptPath ?? ""}:${a.blockId ?? ""}`).join(",")]);

    // no-cascade guard (single constant key — the surface has one roster): mounting or switching to the
    // surface seeds silently, so only agents/terminals that arrive after mount fade in. See motiontokens.ts.
    const rowIds = [...agents.map((a) => a.id), ...terminals.map((t) => t.id)];
    const entranceRef = useRef(initialEntranceState());
    const { animate: entranceIds } = computeEntrances(entranceRef.current, "agents", rowIds);
    const idsKey = rowIds.join(",");
    useLayoutEffect(() => {
        entranceRef.current = computeEntrances(entranceRef.current, "agents", rowIds).state;
    }, [idsKey]);

    return (
        <div data-agent-tree className="flex w-[248px] shrink-0 flex-col border-r border-border bg-surface">
            <div className="border-b border-edge-faint px-[16px] pb-[12px] pt-[16px]">
                <div className="flex items-center justify-between">
                    <h3 className="font-mono text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-mid">Agents</h3>
                    <div className="flex items-center gap-[6px]">
                        {headerAttn > 0 ? <AskingBadge n={headerAttn} /> : null}
                        <span className="font-mono text-[10.5px] font-semibold text-muted">{total}</span>
                    </div>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
                <AnimatePresence mode="popLayout" initial={false}>
                    {visibleRows.map((r) => {
                        if (r.kind === "group") {
                            return (
                                <motion.div
                                    key={`g-${r.project}`}
                                    layout="position"
                                    className="flex items-center gap-[8px] px-[11px] pb-[6px] pt-[14px]"
                                >
                                    <span className="truncate font-mono text-[10.5px] font-bold uppercase tracking-[.1em] text-muted">
                                        {r.project}
                                    </span>
                                    <div className="h-px flex-1 bg-edge-mid" />
                                    {r.attn > 0 ? <AskingBadge n={r.attn} /> : null}
                                    <span className="font-mono text-[10.5px] font-semibold text-muted">{r.count}</span>
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
                            case "final":
                                // the stage's own key before a verifier stands for it, then the session's
                                key = r.agent?.id ?? `final-${r.run.runId}`;
                                body = <FinalRow model={model} run={r.run} agent={r.agent} />;
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
                            className="flex items-center gap-[8px] px-[11px] pb-[6px] pt-[14px]"
                        >
                            <span className="truncate font-mono text-[10.5px] font-bold uppercase tracking-[.1em] text-muted">
                                Terminals
                            </span>
                            <div className="h-px flex-1 bg-edge-mid" />
                            <span className="font-mono text-[10.5px] font-semibold text-muted">{terminals.length}</span>
                        </motion.div>
                    ) : null}
                    {terminals.map((t) => (
                        <motion.div
                            key={t.id}
                            layout="position"
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
