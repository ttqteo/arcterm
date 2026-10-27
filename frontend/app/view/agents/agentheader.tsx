// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Identity + controls bar shown above the focused agent's live terminal in the Agent surface.
// Extracted from the former AgentTranscript header (now removed): the real Claude Code TUI has no
// chrome of its own, so this keeps name/status/model/context% + the details-rail toggle visible.

import { isPeekGesture, peekClickLabel } from "@/app/cockpit/ctrlheld";
import { queuedJobFor } from "@/app/cockpit/jobqueue";
import { QueuedJobTag } from "@/app/cockpit/jobqueuechip";
import { jobQueueAtom } from "@/app/cockpit/jobqueuestore";
import { pushToast } from "@/app/cockpit/notificationstore";
import { KeyCap } from "@/app/element/keycap";
import { useSettle } from "@/app/element/motionhooks";
import { MOTION } from "@/app/element/motiontokens";
import { Segmented } from "@/app/element/segmented";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { attachAgent, createIdea, effortDetailAtom, loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { initiativeLinkText } from "@/app/view/jarvis/initiativework";
import { InitiativePicker } from "@/app/view/jarvis/initiativepicker";
import { openOrPeek, openTarget } from "@/app/view/jarvis/openref";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { redrawTerminal } from "@/app/view/term/termwrap";
import { formatChordString } from "@/util/keysym";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    Check,
    ChevronDown,
    ChevronLeft,
    CircleStop,
    Columns2,
    Ellipsis,
    Maximize2,
    Minimize2,
    PanelRight,
    PictureInPicture2,
    Plus,
    RotateCw,
    Workflow,
    Wrench,
    X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { closeAgentChord, confirmCloseSession, interruptAgent } from "./agentactions";
import { contextLevel, contextTokens } from "./agentrailmodel";
import type { AgentsViewModel } from "./agents";
import { askingLabel, askSentKey, formatTokens, projectOf, type AgentVM } from "./agentsviewmodel";
import { setAgentView, type AgentView } from "./agentview";
import { backgroundActivity, launchedServers, shownState, type ShownState } from "./bgactivity";
import { isAsking } from "./brainstormmodel";
import { brainstormAtom, shownBrainstormFile } from "./brainstormstore";
import { isUnseen } from "./canvasmodel";
import { canvasStateAtom } from "./canvasstore";
import { DOC_REVIEW_HEADERS, docReviewAtom, parseDocReview } from "./docreview";
import { docReviewStateAtom, openReview } from "./docreviewstore";
import { DONE_TITLE, doneSuggestion } from "./donesuggest";
import { floatModeAtom, toggleFloat } from "./floatstore";
import { agentGridAtom, currentGrid, eligibleIds, gridProjects, openInSplit, removeFromGrid } from "./gridstore";
import { InitiativePopover, initiativePopoverAtom } from "./initiativepopover";
import { liveTokensAtom } from "./livetokensstore";
import { rosterSeededAtom } from "./liveagents";
import { machineServersReadingAtom } from "./machineserversstore";
import { isFinalStageId } from "./finalstage";
import { planEditChunks } from "./planreviewmodel";
import { useInitiativeReread, usePlanReview } from "./planreviewstore";
import { openRailSection } from "./railsection";
import { railVisibleAtom, terminalFullscreenAtom } from "./railstore";
import { agentProject, isEndedWorkerId, leadAgentOf } from "./runlineage";
import { startedRunsText } from "./runorigin";
import { openRunOrigin, useRunOrigin, useRunsStartedBy } from "./runoriginstore";
import { runQueueAtom } from "./runqueuestore";
import { RuntimeMark } from "./runtimemark";
import { runtimeMeta } from "./runtimemeta";
import { splitMenuState } from "./splitmenu";
import { ServerMark, StatusDot } from "./statusdot";
import { backgroundTasksByIdAtom } from "./subagentsstore";
import { openToolPicker } from "./toolsstore";
import { runningBackgroundTasks } from "./transcriptprojection";
import { unreadAgentsAtom } from "./unreadagentsstore";
import { openLauncher } from "./launcherstore";

export const STATE_COLOR: Record<ShownState, string> = {
    asking: "var(--color-warning)",
    working: "var(--color-working)",
    waiting: "var(--color-working)",
    idle: "var(--color-muted)",
};
export const STATE_LABEL: Record<ShownState, string> = {
    asking: "asking",
    working: "working",
    waiting: "waiting",
    idle: "idle",
};

// header context chip color by context level (mirrors the rail gauge, as text not fill)
export const CTX_TEXT: Record<"ok" | "warn" | "hot", string> = {
    ok: "text-accent",
    warn: "text-warning",
    hot: "text-error",
};

// shared compact icon-button: a bare icon that takes a fill on hover. The border stays transparent so a button that
// turns on (ICON_BTN_ON) keeps its size.
export const ICON_BTN =
    "flex cursor-pointer items-center justify-center rounded-[6px] border border-transparent p-[5px] text-muted hover:bg-surface-hover hover:text-primary";
// an icon-button that is on (split shown, fullscreen, pinned)
export const ICON_BTN_ON = "border-accent/50 bg-accentbg text-accent hover:bg-accentbg hover:text-accent";

// useRunLineage reads what the header says about an agent a run spawned: a lead's run, a worker's task and
// lead, or a stage session's run and lead.
function useRunLineage(model: AgentsViewModel, agent: AgentVM) {
    const lineage = useAtomValue(model.lineageAtom);
    const agents = useAtomValue(model.agentsAtom);
    const role = lineage.roles[agent.id];
    if (role == null) {
        return null;
    }
    if (role.kind === "lead") {
        return { kind: "lead" as const, runId: role.runId };
    }
    const run = lineage.runs[role.leadRunId];
    const lead = leadAgentOf(lineage, agents, role.leadRunId);
    if (role.kind === "stage") {
        return { kind: "stage" as const, run, lead };
    }
    const task = run?.dag?.tasks?.find((t) => t.id === role.taskId);
    return {
        kind: "worker" as const,
        run,
        task,
        lead,
    };
}

// The initiative this session works on. A click opens its popover in place (initiativepopover.tsx); the peek click keeps
// the way to it on the Brief.
function InitiativeLink({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const oref = "effort:" + agent.effortId;
    const effort = useAtomValue(effortDetailAtom).get(oref);
    const open = useAtomValue(initiativePopoverAtom) === agent.id;
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    useEffect(() => {
        // the title is decoration: a failed load leaves the plain link, which still opens the initiative
        loadEffortDetail(oref).catch(() => {});
    }, [oref]);
    return (
        <>
            {" · "}
            <button
                ref={setAnchor}
                type="button"
                data-peek
                data-initiative-link-open
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={(e) => {
                    if (isPeekGesture(e)) {
                        fireAndForget(() => openOrPeek(model, { kind: "effort", effortId: agent.effortId! }, e));
                        return;
                    }
                    globalStore.set(initiativePopoverAtom, open ? null : agent.id);
                }}
                title={`${effort?.title ?? "This initiative"}: details here (i), ${peekClickLabel()} to open it in Jarvis`}
                className={cn(
                    "cursor-pointer rounded-[5px] px-[5px] py-[1px] text-accent-soft hover:underline",
                    open && "bg-surface-selected"
                )}
            >
                {initiativeLinkText(agent.name, effort)}
                <ChevronDown size={11} aria-hidden className="ml-[3px] inline-block align-[-1px]" />
            </button>
            <InitiativePopover model={model} agent={agent} anchor={anchor} />
        </>
    );
}

// An agent with no initiative: "+ Link to initiative" opens the picker. A pick writes the tab's session:effort, and
// attaches the agent to the initiative's active chunk (else its first pending one) so the chunk reads as its work; a new
// initiative made from the session is an idea with no chunk, so nothing is attached.
function LinkToInitiative({ agent, project }: { agent: AgentVM; project: string }) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const link = (pick: string) => {
        setOpen(false);
        fireAndForget(async () => {
            try {
                const oref = pick === "new" ? await createIdea(agent.name) : pick;
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("tab", agent.id),
                    meta: { "session:effort": oref },
                });
                if (pick === "new") {
                    return;
                }
                await loadEffortDetail(oref, Number.MAX_SAFE_INTEGER);
                const chunks = globalStore.get(effortDetailAtom).get(oref)?.chunks ?? [];
                const chunk = chunks.find((c) => c.status === "active") ?? chunks.find((c) => c.status === "pending");
                if (chunk != null) {
                    await attachAgent(oref, chunkRef(planEditChunks(chunks), chunk.label), agent.id);
                }
            } catch (e) {
                pushToast({
                    title: `Couldn't link ${agent.name} to an initiative`,
                    message: e instanceof Error ? e.message : String(e),
                    level: "error",
                });
            }
        });
    };
    return (
        <>
            {" · "}
            <button
                ref={setAnchor}
                type="button"
                data-initiative-link
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                title="Link this agent to an initiative (i)"
                className={cn(
                    "inline-flex h-[20px] cursor-pointer items-center rounded-[5px] border border-dashed border-edge-strong px-[7px] align-middle text-[11px] text-ink-mid hover:text-primary",
                    open && "bg-surface-selected"
                )}
            >
                + Link to initiative
            </button>
            <InitiativePicker
                open={open}
                anchor={anchor}
                project={project}
                onPick={link}
                onClose={() => {
                    setOpen(false);
                    anchor?.focus({ preventScroll: true });
                }}
            />
        </>
    );
}

// "N TO REVIEW": the initiative holds chunks that wait for a decision, and this opens the details rail on them. It is
// its own flex item, after the truncating text, so a long project or initiative name never clips it away.
function PlanReviewChip({ agent }: { agent: AgentVM }) {
    // the header is what is on screen when the agent stops with a plan, so it reads the initiative again too (the
    // rail's own read is the same one in flight, see planreviewstore.ts)
    useInitiativeReread(agent.effortId, agent.state, false);
    const { proposed } = usePlanReview(agent.effortId);
    if (proposed === 0) {
        return null;
    }
    return (
        <button
            type="button"
            data-plan-review-chip
            onClick={() => openRailSection(agent.id, "plan")}
            title="Review the proposed plan on the details rail"
            className="inline-flex h-[18px] flex-none cursor-pointer items-center self-center rounded-[5px] border border-asking/30 bg-askingbg px-[7px] text-[10px] font-bold uppercase tracking-[.04em] text-asking hover:border-asking/60"
        >
            {proposed} to review
        </button>
    );
}

// The session that started this agent's run with `wsh runs start`, linking back to it. The tree no longer lists the
// run under that session, so this is where the two meet.
function RunOriginLink({ model, runId }: { model: AgentsViewModel; runId: string }) {
    const run = useAtomValue(WOS.getWaveObjectAtom<Run>(WOS.makeORef("run", runId)));
    const origin = useRunOrigin(model, run);
    if (origin == null) {
        return null;
    }
    return (
        <>
            {" · "}
            {origin.kind === "gone" ? (
                <span data-run-origin="gone" title="Started from a session that has since closed">
                    ↰ a closed session
                </span>
            ) : (
                <button
                    type="button"
                    data-run-origin={origin.kind}
                    onClick={() => openRunOrigin(model, origin)}
                    title={`Started from ${origin.name}: go to that session`}
                    className="cursor-pointer text-accent-soft hover:underline"
                >
                    ↰ {origin.name}
                </button>
            )}
        </>
    );
}

// The other way round: the runs this session started with `wsh runs start`. One opens its run sheet; several offer a
// menu of them, the ones still going first.
function StartedRunsLink({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const runs = useRunsStartedBy(agent);
    if (runs.length === 0) {
        return null;
    }
    const open = (runId: string) => fireAndForget(() => openTarget(model, { kind: "run", runId }));
    const onClick = (e: React.MouseEvent) => {
        if (runs.length === 1) {
            open(runs[0].oid);
            return;
        }
        ContextMenuModel.getInstance().showContextMenu(
            runs.map((r) => ({ label: `${startedRunsText([r])} · ${r.status}`, click: () => open(r.oid) })),
            e
        );
    };
    return (
        <>
            {" · "}
            <button
                type="button"
                data-started-runs={runs.length}
                onClick={onClick}
                title={
                    runs.length === 1
                        ? `A run this session started (${runs[0].status}): open it`
                        : "Runs this session started: pick one to open"
                }
                className="cursor-pointer text-accent-soft hover:underline"
            >
                ↳ {startedRunsText(runs)}
            </button>
        </>
    );
}

export function AgentHeader({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const railVisible = useAtomValue(railVisibleAtom);
    const fullscreen = useAtomValue(terminalFullscreenAtom);
    const floating = useAtomValue(floatModeAtom);
    const brainstorm = useAtomValue(brainstormAtom(agent.id));
    // an agent with a brainstorm never shows its canvas: the brainstorm pane opens its boards, and takes the canvas's slot
    const canvas = useAtomValue(canvasStateAtom(agent.id));
    const hasCanvas = canvas != null && brainstorm == null;
    // the roster overlay already turned a question the file asks into state "asking"
    const brainstormFile = shownBrainstormFile(brainstorm);
    const brainstormAsking = brainstormFile != null && isAsking(brainstormFile) && agent.state === "asking";
    const lineage = useRunLineage(model, agent);
    const project = agentProject(useAtomValue(model.lineageAtom), useAtomValue(model.agentsAtom), agent);
    const name =
        lineage?.kind === "worker" && lineage.task
            ? `${lineage.task.id} · ${lineage.task.label || lineage.task.id}`
            : agent.name;
    const rt = runtimeMeta(agent.agent);
    const blockId = agent.blockId;
    // a done task's worker reads as what its task came to, not as an idle session
    const ended = isEndedWorkerId(agent.id);
    // the final stage's own id is no session: it has no runtime, and its pane says its state
    const stage = isFinalStageId(agent.id);
    const landed = lineage?.kind === "worker" && lineage.task?.merged;
    // a plain session can be linked to an initiative from here; a run's worker has its task, a terminal no session
    const canLink =
        agent.blockId != null && agent.kind !== "terminal" && !ended && !stage && lineage?.kind !== "worker";
    // its turn ended but background work it started still runs: working, or waiting when that work only watches
    const bgTasks = useAtomValue(backgroundTasksByIdAtom)[agent.id];
    const machineServers = useAtomValue(machineServersReadingAtom).servers;
    const shown = shownState(agent.state, backgroundActivity(bgTasks, machineServers));
    // the dev servers it left listening, which do not count as work: a green server glyph and their ports
    const servers = ended ? [] : launchedServers(bgTasks, machineServers);
    const liveText = agent.state === "asking" ? askingLabel(agent) : STATE_LABEL[shown];
    const stateText = ended ? (landed ? "landed" : "done") : liveText;
    const stateColor = ended ? "var(--color-success)" : STATE_COLOR[shown];
    // a working agent whose heavy command waits its turn in the job queue reads as its place there, not as working
    const queuedJob = queuedJobFor(useAtomValue(jobQueueAtom), blockId);
    const queued = !ended && agent.state === "working" ? queuedJob : null;
    // m4: one-shot settle on the state pill when the focused agent reaches idle
    const settling = useSettle(!ended && shown === "idle");
    const review = parseDocReview(agent.ask);
    const dialogOpen = useAtomValue(docReviewAtom) != null;
    const docReview = useAtomValue(docReviewStateAtom(agent.id));
    const sent = useAtomValue(model.sentIdsAtom).has(askSentKey(agent) ?? "");
    // a Doc review switches in the segmented control below; the amber button opens a Spec or Plan review's dialog
    const showDialogButton = review != null && review.kind !== "doc" && !dialogOpen;
    const view: AgentView =
        docReview?.mode === "review"
            ? "review"
            : brainstorm?.mode === "brainstorm"
              ? "brainstorm"
              : hasCanvas && canvas.mode === "canvas"
                ? "canvas"
                : "terminal";
    // the bare key that goes back to the terminal from the first view the agent has to swap to
    const swapKey = docReview != null ? "r" : brainstorm != null ? "b" : "c";

    // The grid's cells, to tell the Split button whether a split is showing. Only agents and terminals with a terminal
    // can be cells (gridstore.eligibleIds).
    const gridState = useAtomValue(agentGridAtom);
    const rosterSeeded = useAtomValue(rosterSeededAtom);
    const rosterAgents = useAtomValue(model.agentsAtom);
    const rosterTerminals = useAtomValue(model.terminalsAtom);
    const cellIds = eligibleIds([...rosterAgents, ...rosterTerminals]);
    const cellCount = gridState.ids.filter((id) => cellIds.has(id)).length;
    const splitShown = cellCount > 1;
    const canSplit = blockId != null && !ended;

    // The visible way to a second cell: every other live agent and terminal of this agent's project (a split holds one
    // project's), and what to do with none (dragging a sidebar row onto the terminal works too, but nothing on screen
    // says so). Built when opened, from the grid as it is then.
    const openSplitMenu = (e: React.MouseEvent) => {
        const grid = currentGrid(model);
        const roster = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
        const projects = gridProjects(roster);
        const mine = roster.filter((a) => projects.get(a.id) === projects.get(agent.id));
        const s = splitMenuState(
            mine.map((a) => ({ id: a.id, name: a.name, blockId: a.blockId, project: projectOf(a) })),
            grid.ids
        );
        const items: ContextMenuItem[] = [{ label: "Show beside this agent", type: "header" }];
        if (s.full) {
            items.push({ label: `The grid is full (${s.cells} of 4)`, enabled: false });
        } else if (s.targets.length === 0) {
            items.push({ label: "No other agent or terminal is running in this project", enabled: false });
        } else {
            for (const t of s.targets) {
                items.push({
                    label: t.name,
                    icon: <Columns2 size={15} />,
                    enabled: rosterSeeded,
                    click: () => {
                        if (!openInSplit(model, t.id)) {
                            model.openTerminal(t.id);
                        }
                    },
                });
            }
        }
        items.push({ type: "separator" });
        items.push({
            label: "New agent…",
            icon: <Plus size={15} />,
            click: () => openLauncher(model, "agent"),
        });
        if (s.cells > 1) {
            items.push({
                label: "Close split",
                icon: <Minimize2 size={15} />,
                click: () => {
                    for (const id of grid.ids) {
                        if (id !== agent.id) {
                            removeFromGrid(model, id);
                        }
                    }
                },
            });
        }
        items.push({ type: "separator" });
        items.push({ label: "Or drag an agent from the sidebar onto the terminal", enabled: false });
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    // Esc cancels the current Claude turn — same PTY-write path as the composer (ControllerInputCommand).
    const interrupt = () => interruptAgent(blockId);

    // Close the whole session (a tab, per launchAgent) — shared with the double-Ctrl+C handler. The
    // header also fronts background terminals, so the noun follows what is actually focused.
    const closeTerminal = () => confirmCloseSession(agent, model);
    // its last turn committed, you have read it and no run it started is still going: the header offers Close with the
    // session's token total, the figure its sidebar row shows (donesuggest.ts)
    const done = doneSuggestion(
        agent,
        useAtomValue(unreadAgentsAtom).get(agent.id) ?? 0,
        useAtomValue(model.lineageAtom).runs,
        runningBackgroundTasks(useAtomValue(backgroundTasksByIdAtom)[agent.id]).length,
        useAtomValue(runQueueAtom)
    );
    const sessionTokens = useAtomValue(liveTokensAtom).get(agent.id);
    const closeLabel = agent.kind === "terminal" ? "Close terminal" : "Close agent";
    // garbled text in the pane: repaint it and have the TUI draw itself again, without restarting the session
    const redraw = () => {
        if (blockId != null) {
            redrawTerminal(blockId);
        }
    };

    // The "…" button and a right-click on the header open the one menu: what the button row leaves out (a tool, Float,
    // Redraw, Interrupt, the details toggle), then Fullscreen and Close again.
    const openHeaderMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const items: ContextMenuItem[] = [];
        if (canSplit) {
            // the header is the focused agent's, which is whose folder the picker opens a tool in
            items.push({
                label: "Open a tool…",
                sublabel: "lazygit, yazi, btop… in this agent's folder",
                icon: <Wrench size={15} />,
                accel: "Mod:Shift:o",
                click: () => openToolPicker(model),
            });
        }
        if (blockId != null) {
            items.push({
                label: floating ? "Leave float" : "Float window",
                icon: <PictureInPicture2 size={15} />,
                accel: "Shift:f",
                click: () => fireAndForget(() => toggleFloat(model)),
            });
            items.push({
                label: "Redraw terminal",
                icon: <RotateCw size={15} />,
                // ⌘R is a Mac key only: on Windows Ctrl+R stays the shell's reverse search (bindings.ts agent:redraw)
                accel: isMacOS() ? "Mod:r" : undefined,
                click: redraw,
            });
            items.push({ label: "Interrupt turn", icon: <CircleStop size={15} />, click: interrupt });
            items.push({
                label: fullscreen ? "Exit fullscreen" : "Fullscreen terminal",
                icon: fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />,
                accel: "f",
                click: () => globalStore.set(terminalFullscreenAtom, !fullscreen),
            });
        }
        items.push({
            label: railVisible ? "Hide details" : "Show details",
            icon: <PanelRight size={15} />,
            click: () => globalStore.set(railVisibleAtom, !railVisible),
        });
        if (blockId != null) {
            items.push({ type: "separator" });
            items.push({
                label: closeLabel,
                icon: <X size={15} />,
                danger: true,
                accel: closeAgentChord(),
                click: closeTerminal,
            });
        }
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    return (
        <div
            data-agent-header
            onContextMenu={openHeaderMenu}
            className="flex shrink-0 select-none items-center gap-[10px] border-b border-border bg-background px-[18px] py-[8px]"
        >
            {stage ? null : ended ? (
                <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: stateColor }} />
            ) : (
                <StatusDot state={shown} pulse={shown !== "idle"} className="!h-[8px] !w-[8px]" />
            )}
            {/* one row: the name first (it is the header's first line of text), then what it is and where it works,
                the project and its lineage truncating first when the pane is narrow */}
            <div className="flex min-w-0 items-baseline gap-[8px] whitespace-nowrap">
                <span className="min-w-0 shrink truncate text-[14px] font-semibold text-foreground">
                    {lineage?.kind === "lead" ? (
                        <Workflow
                            size={13}
                            aria-hidden
                            className="mr-[5px] inline-block align-[-1px] text-accent-soft"
                        />
                    ) : null}
                    {name}
                </span>
                {stage ? null : (
                    <>
                        <span title={rt.label} className={cn("flex-none self-center", rt.text)}>
                            <RuntimeMark runtime={agent.agent} className="text-[12px] leading-none" />
                        </span>
                        {queued ? (
                            <QueuedJobTag job={queued} />
                        ) : (
                            <span
                                className={cn(
                                    "flex-none text-[11px] font-medium transition-colors duration-[140ms]",
                                    settling && "animate-[settle_0.5s_ease-out] motion-reduce:animate-none"
                                )}
                                style={{ color: stateColor }}
                            >
                                {stateText}
                            </span>
                        )}
                        <span className="flex-none self-center">
                            <ServerMark servers={servers} ports />
                        </span>
                    </>
                )}
                {agent.model ? <span className="flex-none text-[11px] text-muted">{agent.model}</span> : null}
                {agent.usage?.contextpct != null ? (
                    <span
                        title={`context: ${Math.round(agent.usage.contextpct)}% of the window`}
                        className={cn(
                            "flex-none text-[11px] font-semibold tabular-nums",
                            CTX_TEXT[contextLevel(agent.usage.contextpct, agent.usage.contextmax)]
                        )}
                    >
                        {contextTokens(agent.usage.contextpct, agent.usage.contextmax) ??
                            `${Math.round(agent.usage.contextpct)}%`}
                    </span>
                ) : null}
                <span className="min-w-0 shrink-[2] truncate text-[11px] text-muted">
                    <span aria-hidden className="text-ink-faint">
                        ·{" "}
                    </span>
                    {project || "—"}
                    {agent.effortId != null ? (
                        <InitiativeLink model={model} agent={agent} />
                    ) : canLink ? (
                        <LinkToInitiative agent={agent} project={project} />
                    ) : null}
                    {lineage?.kind === "lead" ? (
                        <>
                            {" "}
                            · orchestrator run <span className="font-mono">{lineage.runId.slice(0, 8)}</span>
                        </>
                    ) : null}
                    {lineage?.kind === "worker" || lineage?.kind === "stage" ? (
                        <>
                            {" · "}
                            {lineage.lead ? (
                                <button
                                    type="button"
                                    onClick={() => globalStore.set(model.focusIdAtom, lineage.lead!.id)}
                                    title="Go to the lead"
                                    className="cursor-pointer text-accent-soft hover:underline"
                                >
                                    ↑ {lineage.lead.name}
                                </button>
                            ) : (
                                <span>↑ {lineage.run?.title ?? "no lead"}</span>
                            )}
                        </>
                    ) : null}
                    {/* a worker's way back is its lead; a lead or a Quick run's agent links the session it came from */}
                    {agent.runId && lineage?.kind !== "worker" && lineage?.kind !== "stage" ? (
                        <RunOriginLink model={model} runId={agent.runId} />
                    ) : null}
                    <StartedRunsLink model={model} agent={agent} />
                </span>
                {agent.effortId != null ? <PlanReviewChip agent={agent} /> : null}
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-[7px]">
                {showDialogButton ? (
                    <button
                        type="button"
                        onClick={() => openReview(model, agent.id)}
                        title={`Show the review (${formatChordString("r")})`}
                        className="flex cursor-pointer items-center gap-[7px] rounded-[7px] border border-warning/45 bg-askingbg px-[11px] py-[6px] text-[11px] font-semibold text-warning hover:border-warning"
                    >
                        <span className="h-[6px] w-[6px] rounded-full bg-warning" aria-hidden />
                        {DOC_REVIEW_HEADERS[review.kind]}
                        <ChevronLeft size={12} strokeWidth={2} aria-hidden />
                    </button>
                ) : null}
                {hasCanvas || docReview != null || brainstorm != null ? (
                    // the bare b, c and r are typed into the TUI while it holds focus, so the chord that switches from
                    // inside it sits on screen beside the control
                    <KeyCap
                        chord="Alt:c"
                        variant="inline"
                        className="cursor-default"
                        title={
                            brainstorm != null
                                ? "Switch Terminal, Brainstorm and Review, also from inside the terminal"
                                : "Switch Terminal, Canvas and Review, also from inside the terminal"
                        }
                    />
                ) : null}
                {hasCanvas || docReview != null || brainstorm != null ? (
                    // one control for whatever can stand in the terminal's place: a canvas or a brainstorm (never both), a
                    // Doc review, or both
                    <Segmented<AgentView>
                        role="group"
                        ariaLabel={
                            docReview == null
                                ? brainstorm != null
                                    ? "Show terminal or brainstorm"
                                    : "Show terminal or canvas"
                                : brainstorm != null
                                  ? "Show terminal, brainstorm or review"
                                  : !hasCanvas
                                    ? "Show terminal or review"
                                    : "Show terminal, canvas or review"
                        }
                        value={view}
                        options={[
                            {
                                key: "terminal",
                                label: "Terminal",
                                title: `Terminal (${formatChordString(swapKey)}, ${formatChordString("Alt:c")} from the terminal)`,
                            },
                            ...(brainstorm != null
                                ? [
                                      {
                                          key: "brainstorm" as const,
                                          label: (
                                              <>
                                                  Brainstorm
                                                  {brainstormAsking ? (
                                                      <span
                                                          aria-label="asking you"
                                                          className="h-[6px] w-[6px] rounded-full bg-warning"
                                                      />
                                                  ) : null}
                                              </>
                                          ),
                                          title: `Brainstorm (${formatChordString("b")}, ${formatChordString("Ctrl:Shift:b")} from the terminal)`,
                                      },
                                  ]
                                : []),
                            ...(hasCanvas
                                ? [
                                      {
                                          key: "canvas" as const,
                                          label: (
                                              <>
                                                  Canvas
                                                  {isUnseen(canvas) ? (
                                                      <span
                                                          aria-label="updated since you last looked"
                                                          className="h-[6px] w-[6px] rounded-full bg-accent"
                                                      />
                                                  ) : null}
                                              </>
                                          ),
                                          title: `Canvas (${formatChordString("c")}, ${formatChordString("Alt:c")} from the terminal)`,
                                      },
                                  ]
                                : []),
                            ...(docReview != null
                                ? [
                                      {
                                          key: "review" as const,
                                          label: (
                                              <>
                                                  Review
                                                  {view !== "review" && !sent ? (
                                                      <span
                                                          aria-label="waiting on you"
                                                          className="h-[6px] w-[6px] rounded-full bg-warning"
                                                      />
                                                  ) : null}
                                              </>
                                          ),
                                          title: `Review (${formatChordString("r")}, ${formatChordString("Alt:c")} from the terminal)`,
                                      },
                                  ]
                                : []),
                        ]}
                        onChange={(v) => setAgentView(agent.id, v, Date.now())}
                    />
                ) : null}
                {blockId != null ? (
                    <button
                        type="button"
                        data-agent-header-more
                        aria-haspopup="menu"
                        aria-label="More"
                        onClick={openHeaderMenu}
                        title="More: open a tool, float, redraw, interrupt, details"
                        className={ICON_BTN}
                    >
                        <Ellipsis size={15} strokeWidth={1.8} aria-hidden />
                    </button>
                ) : null}
                {canSplit ? (
                    <button
                        type="button"
                        data-agent-split
                        aria-haspopup="menu"
                        aria-pressed={splitShown}
                        onClick={openSplitMenu}
                        title="Split: show another agent beside this one (or drag a row from the sidebar onto the terminal)"
                        className={cn(ICON_BTN, "gap-[6px] text-[12px]", splitShown && ICON_BTN_ON)}
                    >
                        <Columns2 size={15} strokeWidth={1.8} aria-hidden />
                        {splitShown ? <span className="tabular-nums">{cellCount}</span> : null}
                    </button>
                ) : null}
                {blockId != null ? (
                    <>
                        {done ? (
                            <button
                                type="button"
                                data-agent-header-done
                                onClick={closeTerminal}
                                title={`${DONE_TITLE} (${formatChordString("Alt:w")})`}
                                className="flex cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-success/45 px-[9px] py-[5px] text-[12px] font-semibold text-success hover:border-success"
                            >
                                <Check size={14} strokeWidth={2.2} aria-hidden />
                                Close
                                {sessionTokens ? (
                                    <span className="font-normal tabular-nums text-muted">
                                        · {formatTokens(sessionTokens)} tok
                                    </span>
                                ) : null}
                            </button>
                        ) : null}
                        <motion.button
                            type="button"
                            onClick={() => globalStore.set(terminalFullscreenAtom, !fullscreen)}
                            title={
                                fullscreen
                                    ? `Exit fullscreen (${formatChordString("f")} or ${formatChordString("Escape")})`
                                    : `Fullscreen terminal (${formatChordString("f")})`
                            }
                            aria-pressed={fullscreen}
                            whileHover={{ scale: 1.06 }}
                            whileTap={{ scale: 0.85 }}
                            className={cn(ICON_BTN, fullscreen && ICON_BTN_ON)}
                        >
                            {/* re-keyed so each toggle replays the rotate-in, reinforcing the state flip */}
                            <motion.span
                                key={fullscreen ? "min" : "max"}
                                initial={{ rotate: -90, opacity: 0 }}
                                animate={{ rotate: 0, opacity: 1 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                className="block"
                            >
                                {fullscreen ? (
                                    <Minimize2 size={15} strokeWidth={1.8} />
                                ) : (
                                    <Maximize2 size={15} strokeWidth={1.8} />
                                )}
                            </motion.span>
                        </motion.button>
                        <button
                            type="button"
                            onClick={closeTerminal}
                            title={
                                agent.kind === "terminal"
                                    ? `Close terminal — ends its shell (${formatChordString(closeAgentChord())})`
                                    : `Close agent — ends its session (${formatChordString(closeAgentChord())})`
                            }
                            className={cn(ICON_BTN, "hover:bg-error/15 hover:text-error")}
                        >
                            <X size={15} strokeWidth={1.9} />
                        </button>
                    </>
                ) : null}
            </div>
        </div>
    );
}
