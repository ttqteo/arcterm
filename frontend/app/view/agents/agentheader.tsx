// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Identity + controls bar shown above the focused agent's live terminal in the Agent surface.
// Extracted from the former AgentTranscript header (now removed): the real Claude Code TUI has no
// chrome of its own, so this keeps name/status/model/context% + the details-rail toggle visible.

import { useSettle } from "@/app/element/motionhooks";
import { MOTION } from "@/app/element/motiontokens";
import { Segmented } from "@/app/element/segmented";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { effortDetailAtom, loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { initiativeLinkText } from "@/app/view/jarvis/initiativework";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { redrawTerminal } from "@/app/view/term/termwrap";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    Check,
    ChevronLeft,
    CircleStop,
    Columns2,
    Maximize2,
    Minimize2,
    PanelRight,
    PictureInPicture2,
    Plus,
    RotateCw,
    Workflow,
    X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { confirmCloseSession, interruptAgent } from "./agentactions";
import { contextLevel, contextTokens } from "./agentrailmodel";
import type { AgentsViewModel } from "./agents";
import { askingLabel, askSentKey, formatTokens, projectOf, type AgentVM } from "./agentsviewmodel";
import { setAgentView, type AgentView } from "./agentview";
import { isUnseen } from "./canvasmodel";
import { canvasStateAtom } from "./canvasstore";
import { DOC_REVIEW_HEADERS, docReviewAtom, parseDocReview } from "./docreview";
import { docReviewStateAtom, openReview } from "./docreviewstore";
import { DONE_TITLE, doneSuggestion } from "./donesuggest";
import { floatModeAtom, toggleFloat } from "./floatstore";
import { agentGridAtom, currentGrid, eligibleIds, openInSplit, removeFromGrid } from "./gridstore";
import { liveTokensAtom } from "./livetokensstore";
import { rosterSeededAtom } from "./liveagents";
import { railVisibleAtom, terminalFullscreenAtom } from "./railstore";
import { agentProject, isEndedWorkerId, leadAgentOf } from "./runlineage";
import { RuntimeMark } from "./runtimemark";
import { runtimeMeta } from "./runtimemeta";
import { splitMenuState } from "./splitmenu";
import { StatusDot } from "./statusdot";
import { unreadAgentsAtom } from "./unreadagentsstore";
import { openLauncher } from "./launcherstore";

export const STATE_COLOR: Record<AgentVM["state"], string> = {
    asking: "var(--color-warning)",
    working: "var(--color-accent)",
    idle: "var(--color-muted)",
};
export const STATE_LABEL: Record<AgentVM["state"], string> = { asking: "asking", working: "working", idle: "idle" };

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
// an icon-button that is on (split shown, floating, fullscreen, pinned)
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

// The initiative this session works on, linking back to it on the Brief.
function InitiativeLink({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const oref = "effort:" + agent.effortId;
    const effort = useAtomValue(effortDetailAtom).get(oref);
    useEffect(() => {
        // the title is decoration: a failed load leaves the plain link, which still opens the initiative
        loadEffortDetail(oref).catch(() => {});
    }, [oref]);
    return (
        <>
            {" · "}
            <button
                type="button"
                data-peek
                onClick={(e) =>
                    fireAndForget(() => openOrPeek(model, { kind: "effort", effortId: agent.effortId! }, e))
                }
                title={`Open ${effort?.title ?? "this initiative"} in Jarvis`}
                className="cursor-pointer text-accent-soft hover:underline"
            >
                {initiativeLinkText(agent.name, effort)}
            </button>
        </>
    );
}

export function AgentHeader({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const railVisible = useAtomValue(railVisibleAtom);
    const fullscreen = useAtomValue(terminalFullscreenAtom);
    const floating = useAtomValue(floatModeAtom);
    const floatTitle = floating
        ? `Leave float (${formatChordString("Shift:f")})`
        : `Float: shrink the window to this terminal, to keep on top of other apps (${formatChordString("Shift:f")})`;
    const canvas = useAtomValue(canvasStateAtom(agent.id));
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
    const landed = lineage?.kind === "worker" && lineage.task?.merged;
    const liveText = agent.state === "asking" ? askingLabel(agent) : STATE_LABEL[agent.state];
    const stateText = ended ? (landed ? "landed" : "done") : liveText;
    const stateColor = ended ? "var(--color-success)" : STATE_COLOR[agent.state];
    // m4: one-shot settle on the state pill when the focused agent reaches idle
    const settling = useSettle(!ended && agent.state === "idle");
    const review = parseDocReview(agent.ask);
    const dialogOpen = useAtomValue(docReviewAtom) != null;
    const docReview = useAtomValue(docReviewStateAtom(agent.id));
    const sent = useAtomValue(model.sentIdsAtom).has(askSentKey(agent) ?? "");
    // a Doc review switches in the segmented control below; the amber button opens a Spec or Plan review's dialog
    const showDialogButton = review != null && review.kind !== "doc" && !dialogOpen;
    const view: AgentView = docReview?.mode === "review" ? "review" : canvas?.mode === "canvas" ? "canvas" : "terminal";

    // The grid's cells, to tell the Split button whether a split is showing. Only agents with a terminal can be cells
    // (gridstore.eligibleIds); a plain terminal has no Split button.
    const gridState = useAtomValue(agentGridAtom);
    const rosterSeeded = useAtomValue(rosterSeededAtom);
    const rosterAgents = useAtomValue(model.agentsAtom);
    const cellCount = gridState.ids.filter((id) => eligibleIds(rosterAgents).has(id)).length;
    const splitShown = cellCount > 1;
    const canSplit = blockId != null && agent.kind !== "terminal" && !ended;

    // The visible way to a second cell: every other live agent, and what to do with none (dragging a sidebar row onto
    // the terminal works too, but nothing on screen says so). Built when opened, from the grid as it is then.
    const openSplitMenu = (e: React.MouseEvent) => {
        const grid = currentGrid(model);
        const s = splitMenuState(
            globalStore.get(model.agentsAtom).map((a) => ({
                id: a.id,
                name: a.name,
                blockId: a.blockId,
                project: projectOf(a),
            })),
            grid.ids
        );
        const items: ContextMenuItem[] = [{ label: "Show beside this agent", type: "header" }];
        if (s.full) {
            items.push({ label: `The grid is full (${s.cells} of 4)`, enabled: false });
        } else if (s.targets.length === 0) {
            items.push({ label: "No other agent is running", enabled: false });
        } else {
            for (const t of s.targets) {
                items.push({
                    label: t.name,
                    sublabel: t.project || undefined,
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
                label: "Show only this agent",
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
    // its last turn committed and you have read it: the header offers Close with the session's token total, the
    // figure its sidebar row shows (donesuggest.ts)
    const done = doneSuggestion(agent, useAtomValue(unreadAgentsAtom).get(agent.id) ?? 0);
    const sessionTokens = useAtomValue(liveTokensAtom).get(agent.id);
    const closeLabel = agent.kind === "terminal" ? "Close terminal" : "Close agent";
    // garbled text in the pane: repaint it and have the TUI draw itself again, without restarting the session
    const redraw = () => {
        if (blockId != null) {
            redrawTerminal(blockId);
        }
    };

    // Right-click the header for the same controls as the button row (plus the details toggle).
    const onContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const items: ContextMenuItem[] = [];
        if (blockId != null) {
            items.push({ label: "Interrupt turn", icon: <CircleStop size={15} />, click: interrupt });
            items.push({
                label: fullscreen ? "Exit fullscreen" : "Fullscreen terminal",
                icon: fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />,
                click: () => globalStore.set(terminalFullscreenAtom, !fullscreen),
            });
            items.push({
                label: floating ? "Leave float" : "Float window",
                icon: <PictureInPicture2 size={15} />,
                click: () => fireAndForget(() => toggleFloat(model)),
            });
            items.push({ label: "Redraw terminal", icon: <RotateCw size={15} />, click: redraw });
        }
        items.push({
            label: railVisible ? "Hide details" : "Show details",
            icon: <PanelRight size={15} />,
            click: () => globalStore.set(railVisibleAtom, !railVisible),
        });
        if (blockId != null) {
            items.push({ type: "separator" });
            items.push({ label: closeLabel, icon: <X size={15} />, danger: true, click: closeTerminal });
        }
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    return (
        <div
            data-agent-header
            onContextMenu={onContextMenu}
            className="flex shrink-0 items-center gap-[10px] border-b border-border bg-background px-[18px] py-[8px]"
        >
            {ended ? (
                <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: stateColor }} />
            ) : (
                <StatusDot state={agent.state} pulse={agent.state !== "idle"} className="!h-[8px] !w-[8px]" />
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
                <span title={rt.label} className={cn("flex-none self-center", rt.text)}>
                    <RuntimeMark runtime={agent.agent} className="text-[12px] leading-none" />
                </span>
                <span
                    className={cn(
                        "flex-none text-[11px] font-medium transition-colors duration-[140ms]",
                        settling && "animate-[settle_0.5s_ease-out] motion-reduce:animate-none"
                    )}
                    style={{ color: stateColor }}
                >
                    {stateText}
                </span>
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
                    {agent.effortId != null ? <InitiativeLink model={model} agent={agent} /> : null}
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
                </span>
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
                {canvas != null || docReview != null ? (
                    // one control for whatever can stand in the terminal's place: a canvas, a Doc review, or both
                    <Segmented<AgentView>
                        role="group"
                        ariaLabel={
                            docReview == null
                                ? "Show terminal or canvas"
                                : canvas == null
                                  ? "Show terminal or review"
                                  : "Show terminal, canvas or review"
                        }
                        value={view}
                        options={[
                            {
                                key: "terminal",
                                label: "Terminal",
                                title: `Terminal (${formatChordString(docReview != null ? "r" : "c")})`,
                            },
                            ...(canvas != null
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
                                          title: `Canvas (${formatChordString("c")})`,
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
                                          title: `Review (${formatChordString("r")})`,
                                      },
                                  ]
                                : []),
                        ]}
                        onChange={(v) => setAgentView(agent.id, v, Date.now())}
                    />
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
                                title={DONE_TITLE}
                                className="flex cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-success/45 px-[9px] py-[5px] text-[12px] font-semibold text-success hover:border-success"
                            >
                                <Check size={14} strokeWidth={2.2} aria-hidden />
                                Done
                                {sessionTokens ? (
                                    <span className="font-normal tabular-nums text-muted">
                                        · {formatTokens(sessionTokens)} tok
                                    </span>
                                ) : null}
                                <span aria-hidden className="font-normal text-muted">
                                    —
                                </span>
                                Close
                            </button>
                        ) : null}
                        <button
                            type="button"
                            data-agent-redraw
                            onClick={redraw}
                            title="Redraw terminal: repaint garbled text; the session keeps running"
                            aria-label="Redraw terminal"
                            className={ICON_BTN}
                        >
                            <RotateCw size={15} strokeWidth={1.8} />
                        </button>
                        <button
                            type="button"
                            data-agent-float
                            onClick={() => fireAndForget(() => toggleFloat(model))}
                            title={floatTitle}
                            aria-label={floating ? "Leave float" : "Float window"}
                            aria-pressed={floating}
                            className={cn(ICON_BTN, floating && ICON_BTN_ON)}
                        >
                            <PictureInPicture2 size={15} strokeWidth={1.8} />
                        </button>
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
                                    ? "Close terminal — ends its shell"
                                    : `Close agent — ends its session (${formatChordString("Ctrl:c")} twice)`
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
