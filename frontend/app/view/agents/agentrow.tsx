// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Meter } from "@/app/element/meter";
import { cardVariants, composerReveal } from "@/app/element/motiontokens";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue, type Atom } from "jotai";
import { ArrowUpRight, Check, Copy, GitCompare, Minimize2, PanelRight, Plus, SquareTerminal, X } from "lucide-react";
import { motion } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import { confirmCloseSession, driveAgent, NUDGE_INPUT } from "./agentactions";
import { AgentComposer, type AgentComposerHandle } from "./agentcomposer";
import {
    agentRowMenuItems,
    clampQuestionIndex,
    entriesToShow,
    isFinishTransition,
    muteMode,
    subagentsLabel,
    tasksLabel,
    type AgentRowMenuItem,
} from "./agentrowmodel";
import type { AgentsViewModel } from "./agents";
import {
    displayAgeMs,
    formatAge,
    formatAgo,
    hasAnswerableAsk,
    taskProgress,
    type AgentVM,
    type CardTask,
} from "./agentsviewmodel";
import { AnswerBar, DocReviewSummary } from "./answerbar";
import { AttentionBanner, BannerChip } from "./attentioncard";
import { diffStatsByIdAtom } from "./cardgitstore";
import type { CardShare } from "./cardgridlayout";
import { parseDocReview } from "./docreview";
import { entriesAtomFor, tasksAtomFor } from "./livetranscriptatoms";
import { NarrationTimeline } from "./narrationtimeline";
import { AgentPathLinks } from "./pathlinkcontext";
import { SubLabel } from "./sectionlabel";
import type { SubagentState, SubagentVM } from "./session-models/sessionviewmodel";
import { ActivityLine, StatusLine } from "./statusline";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { subagentsByIdAtom } from "./subagentsstore";

// uniform 25x23 control box (handoff header buttons)
const CTL_BOX =
    "flex h-[23px] w-[25px] shrink-0 cursor-pointer items-center justify-center rounded-sm border border-edge-mid text-secondary hover:border-edge-strong hover:bg-white/[0.04]";

// the header's count chips (subagents, tasks, diff); each adds its own hover
const CHIP =
    "flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-[5px] border border-edge-mid px-[7px] text-[10.5px] font-semibold tabular-nums text-ink-mid";

const SUB_COLOR: Record<SubagentState, string> = {
    working: "var(--color-accent)",
    success: "var(--color-success)",
    failure: "var(--color-error)",
    done: "var(--color-muted)",
};

// reads the 1s clock itself so the card does not re-render every second
function FinishedAge({ agent, nowAtom }: { agent: AgentVM; nowAtom: Atom<number> }) {
    const now = useAtomValue(nowAtom);
    return <>{formatAgo(displayAgeMs(agent, now))}</>;
}

function TaskChip({ done, total, onClick }: { done: number; total: number; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            title="Show task list"
            className={cn(CHIP, "hover:border-edge-strong")}
        >
            {tasksLabel(done, total)}
        </button>
    );
}

function TaskPopover({
    tasks,
    done,
    total,
    pct,
    onClose,
}: {
    tasks: CardTask[];
    done: number;
    total: number;
    pct: number;
    onClose: () => void;
}) {
    return (
        <div onClick={(e) => e.stopPropagation()}>
            <div className="mb-2.5 flex items-center gap-2">
                <SubLabel>Task list</SubLabel>
                <span className="rounded-[5px] border border-edge-mid bg-surface px-1.5 py-px text-[10.5px] tabular-nums text-secondary">
                    {done}/{total}
                </span>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={onClose}
                    title="Close"
                    className="flex cursor-pointer text-muted hover:text-secondary"
                >
                    <X size={13} aria-hidden />
                </button>
            </div>
            <Meter pct={pct} fill="bg-success" height={5} radius={3} track="bg-edge-faint" className="mb-3" />
            <div className="flex flex-col gap-px">
                {tasks.map((t, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1">
                        <span
                            className={cn(
                                "mt-px flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border",
                                t.done
                                    ? "border-success/40 bg-success/15 text-success"
                                    : "border-edge-mid bg-surface text-muted"
                            )}
                        >
                            {t.done ? <Check size={10} aria-hidden /> : null}
                        </span>
                        <span
                            className={cn(
                                "text-[11.5px] leading-[1.5]",
                                t.done ? "text-muted line-through" : "text-secondary"
                            )}
                        >
                            {t.text}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// A "N subagents" fan-out chip for the cockpit card, with a hover peek listing
// each child's type + state dot. Read-only; clicking opens the focused view (where the tree/interior live).
function FanoutBadge({ subs, onOpen }: { subs: SubagentVM[]; onOpen: () => void }) {
    const [peek, setPeek] = useState(false);
    return (
        <div className="relative shrink-0" onMouseEnter={() => setPeek(true)} onMouseLeave={() => setPeek(false)}>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                }}
                className={cn(CHIP, "hover:border-accent hover:text-accent-soft")}
            >
                {subagentsLabel(subs.length)}
            </button>
            <PopoverReveal
                open={peek}
                origin="top right"
                className="absolute right-0 top-[24px] z-30 w-[212px] rounded-[9px] border border-edge-strong bg-surface-raised p-2 shadow-popover-lg"
            >
                <div className="flex flex-col gap-1">
                    {subs.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                            <span
                                className="h-[7px] w-[7px] shrink-0 rounded-full"
                                style={{ background: SUB_COLOR[s.state] }}
                            />
                            <span className="min-w-0 flex-1 truncate text-[10.5px] text-secondary">
                                {s.type || "subagent"}
                            </span>
                            <span className="text-[10.5px] font-semibold" style={{ color: SUB_COLOR[s.state] }}>
                                {s.state === "failure" ? "failed" : s.state}
                            </span>
                        </div>
                    ))}
                </div>
            </PopoverReveal>
        </div>
    );
}

// Header liveness dot and the identity/status/activity rows are shared units extracted for the
// orchestrator overview (statusline.tsx); AgentRow composes them with its own controls.

export const AgentRow = memo(function AgentRow({
    model,
    agent,
    nowAtom,
    isCursor,
    selections,
    texts,
    sent,
    activeQuestion,
    composerOpen,
    onCursor,
    onOpen,
    onOpenTerminal,
    onOpenDiff,
    onOpenComposer,
    onToggleAnswer,
    onAnswerText,
    onSubmitAnswer,
    onSelectQuestion,
    onComposerEscape,
    onBackground,
    onDismiss,
    pulse,
    share,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    nowAtom: Atom<number>;
    isCursor: boolean;
    selections: Record<number, Set<number>>;
    texts: Record<number, string>;
    sent: boolean;
    activeQuestion?: number;
    composerOpen: boolean;
    onCursor: () => void;
    onOpen: () => void;
    onOpenTerminal: () => void;
    onOpenDiff: () => void;
    onOpenComposer: () => void;
    onToggleAnswer: (qi: number, oi: number) => void;
    onAnswerText: (qi: number, value: string) => void;
    onSubmitAnswer: () => void;
    onSelectQuestion?: (qi: number) => void;
    onComposerEscape?: () => void;
    onBackground?: () => void;
    onDismiss?: () => void;
    pulse?: boolean;
    share: CardShare; // flex share of its column and its floor (cardgridlayout.ts)
}) {
    const composerRef = useRef<AgentComposerHandle>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [tasksOpen, setTasksOpen] = useState(false);

    const liveEntries = useAtomValue(entriesAtomFor(agent.id));
    const entries = entriesToShow(liveEntries, agent.previousInfo);
    const { scrollRef, onScroll, atBottom, jumpToBottom } = useStickToBottom(entries);
    const asking = agent.state === "asking";
    const working = agent.state === "working";
    const idle = agent.state === "idle";
    const hasQuestions = hasAnswerableAsk(agent);
    const qs = agent.ask?.questions ?? [];
    const qIdx = clampQuestionIndex(activeQuestion, qs.length);
    const question = qs[qIdx]?.question;
    const review = parseDocReview(agent.ask);
    const diff = useAtomValue(diffStatsByIdAtom)[agent.id];
    const subs = useAtomValue(subagentsByIdAtom)[agent.id] ?? [];
    const tasks = useAtomValue(tasksAtomFor(agent.id));
    const prog = tasks && tasks.length > 0 ? taskProgress(tasks) : undefined;
    const showComposer = composerOpen;
    const muteAction = muteMode(agent.state) === "dismiss" ? onDismiss : onBackground;
    const onContextMenu = (e: React.MouseEvent) => {
        const icons: Record<string, React.ReactNode> = {
            open: <PanelRight size={15} />,
            terminal: <SquareTerminal size={15} />,
            diff: <GitCompare size={15} />,
            mute: <Minimize2 size={15} />,
            copy: <Copy size={15} />,
            close: <X size={15} />,
        };
        const clicks: Record<string, () => void> = {
            open: onOpen,
            terminal: onOpenTerminal,
            diff: onOpenDiff,
            mute: () => muteAction?.(),
            copy: () => void navigator.clipboard.writeText(agent.name),
            close: () => confirmCloseSession(agent),
        };
        const items: ContextMenuItem[] = agentRowMenuItems({ hasDiff: !!diff, hasMute: !!muteAction }).map(
            (it: AgentRowMenuItem) =>
                "separator" in it
                    ? { type: "separator" }
                    : { label: it.label, icon: icons[it.key], click: clicks[it.key], danger: it.danger }
        );
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    // one-shot "settle" when this agent finishes (working -> idle); cleared after it plays
    const prevStateRef = useRef(agent.state);
    const [justFinished, setJustFinished] = useState(false);
    useEffect(() => {
        if (isFinishTransition(prevStateRef.current, agent.state)) {
            setJustFinished(true);
            const t = setTimeout(() => setJustFinished(false), 520); // matches @keyframes settle .5s
            prevStateRef.current = agent.state;
            return () => clearTimeout(t);
        }
        prevStateRef.current = agent.state;
    }, [agent.state]);

    return (
        <motion.div
            // a flex item in its column: `share` sets its part of the column's height and its floor.
            // variants animate opacity+scale for genuine mount/unmount only
            variants={cardVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            ref={cardRef}
            style={{ flex: `${share.grow} 0 0px`, minHeight: share.minPx }}
            data-agent-id={agent.id}
            onClick={onCursor}
            onContextMenu={onContextMenu}
            className={cn(
                // card fills its flex share; overflow clipped
                "group relative flex cursor-pointer flex-col overflow-hidden rounded-[13px] border",
                asking
                    ? "border-warning/40 bg-lane animate-[breatheGlow_2.4s_ease-in-out_infinite] motion-reduce:animate-none"
                    : "border-edge-mid bg-lane",
                isCursor &&
                    (asking ? "shadow-[0_0_0_1.5px_var(--color-warning)]" : "shadow-[0_0_0_1.5px_var(--color-accent)]"),
                pulse && "ring-2 ring-warning ring-inset",
                justFinished && "animate-[settle_0.5s_ease-out] motion-reduce:animate-none"
            )}
        >
            {/* header bar */}
            <div className="flex shrink-0 items-center gap-2 border-b border-edge-mid bg-surface px-3 py-1.5">
                <StatusLine agent={agent} nowAtom={nowAtom} className="min-w-0 flex-1" />
                {subs.length > 0 ? <FanoutBadge subs={subs} onOpen={onOpen} /> : null}
                {diff ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenDiff();
                        }}
                        title="Review changes in Diff"
                        className={cn(CHIP, "hover:border-accent hover:bg-accent/10")}
                    >
                        <span className="text-diff-added">+{diff.adds}</span>
                        <span className="text-diff-removed">−{diff.dels}</span>
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenTerminal();
                    }}
                    title="Open terminal (T)"
                    className={CTL_BOX}
                >
                    <SquareTerminal size={13} aria-hidden />
                </button>
                {muteAction ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            muteAction();
                        }}
                        title={idle ? "Move to background" : "Move to background (B)"}
                        className={CTL_BOX}
                    >
                        {/* down-chevron into a tray line: collapse this card into the background lane */}
                        <svg
                            viewBox="0 0 16 16"
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.6}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M4 5 L8 9 L12 5" />
                            <path d="M4 11.5 H12" />
                        </svg>
                    </button>
                ) : null}
            </div>

            {/* streaming flow bar — a subtle accent sweep under the header while the agent works */}
            {working ? (
                <div className="h-[2px] shrink-0 overflow-hidden bg-lane">
                    <div className="h-full w-[26%] bg-gradient-to-r from-transparent via-accent to-transparent animate-[flowBar_1.9s_linear_infinite] motion-reduce:animate-none" />
                </div>
            ) : null}

            {/* asking banner (4b) — amber strip carries the "your turn" signal; question reads neutral */}
            {asking ? (
                <>
                    <AttentionBanner
                        glyph="dot"
                        pulse
                        label="Waiting on you"
                        meta={formatAge(displayAgeMs(agent))}
                        right={
                            prog ? (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setTasksOpen((v) => !v);
                                    }}
                                    title="Show task list"
                                    className="cursor-pointer"
                                >
                                    <BannerChip>{tasksLabel(prog.done, prog.total)}</BannerChip>
                                </button>
                            ) : null
                        }
                    />
                    {agent.ask?.note ? (
                        <div className="shrink-0 border-b border-edge-mid px-3.5 pt-2 text-[11px] text-warning">
                            {agent.ask.note}
                        </div>
                    ) : null}
                    {review ? (
                        <div className="shrink-0 border-b border-edge-mid px-3.5 py-2.5">
                            <DocReviewSummary model={model} agentId={agent.id} review={review} />
                        </div>
                    ) : question ? (
                        <p className="shrink-0 whitespace-pre-line border-b border-edge-mid px-3.5 py-2.5 text-[14px] font-semibold leading-[1.5] text-primary">
                            {question}
                        </p>
                    ) : null}
                </>
            ) : null}

            {/* finished: the card keeps its place and says so, with the two things you do next */}
            {idle ? (
                <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex shrink-0 items-center gap-2 border-b border-edge-mid bg-accent/[0.06] py-[5px] pl-3.5 pr-2"
                >
                    <Check size={12} aria-hidden className="shrink-0 text-accent-soft" />
                    <span className={cn(REGION_LABEL, "text-accent-soft")}>Finished</span>
                    <span className="min-w-0 flex-1 text-[10.5px] tabular-nums text-muted">
                        <FinishedAge agent={agent} nowAtom={nowAtom} />
                    </span>
                    {diff ? (
                        <button
                            type="button"
                            onClick={onOpenDiff}
                            className="flex h-[23px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border border-accent/45 bg-transparent px-[9px] text-[11.5px] font-semibold text-accent-soft hover:bg-accent/10"
                        >
                            Review changes
                            <span className="text-[10.5px] tabular-nums">
                                <span className="text-diff-added">+{diff.adds}</span>{" "}
                                <span className="text-diff-removed">−{diff.dels}</span>
                            </span>
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onOpen}
                        className="flex h-[23px] shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border border-edge-mid bg-transparent px-[9px] text-[11.5px] text-secondary hover:border-edge-strong"
                    >
                        Open
                        <ArrowUpRight size={11} aria-hidden />
                    </button>
                </div>
            ) : null}

            {/* task popover */}
            <PopoverReveal
                open={tasksOpen && !!tasks && !!prog}
                origin="top right"
                className="absolute right-2.5 top-[46px] z-30 max-h-[calc(100%-116px)] w-[min(282px,calc(100%-20px))] overflow-y-auto rounded-[11px] border border-edge-strong bg-surface-raised p-3 shadow-popover-xl"
            >
                {tasks && prog ? (
                    <TaskPopover
                        tasks={tasks}
                        done={prog.done}
                        total={prog.total}
                        pct={prog.pct}
                        onClose={() => setTasksOpen(false)}
                    />
                ) : null}
            </PopoverReveal>

            {/* scrollable body: feed + answer + composer scroll together as one region, so nothing
                clips at small card heights and the whole card reads as vertically scrollable. The feed
                grows to keep the composer pinned to the bottom when content is short; the region scrolls
                when it overflows. Header + asking band stay pinned above. The relative wrapper anchors
                the jump-to-latest pill to the viewport bottom (it must not scroll with the feed). */}
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                    ref={scrollRef}
                    onScroll={onScroll}
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
                >
                    {/* feed */}
                    <div className="shrink-0 grow px-3 py-1.5">
                        {working ? (
                            <ActivityLine
                                agent={agent}
                                nowAtom={nowAtom}
                                className="mb-1.5 border-b border-edge-mid pb-1.5"
                                onNudge={() => driveAgent(agent.blockId, NUDGE_INPUT)}
                                right={
                                    prog ? (
                                        <TaskChip
                                            done={prog.done}
                                            total={prog.total}
                                            onClick={() => setTasksOpen((v) => !v)}
                                        />
                                    ) : null
                                }
                            />
                        ) : null}
                        {entries.length > 0 ? (
                            <AgentPathLinks agent={agent}>
                                <NarrationTimeline entries={entries} accentLatest active={!idle} />
                            </AgentPathLinks>
                        ) : null}
                    </div>

                    {/* structured answer band */}
                    {asking && hasQuestions ? (
                        <AnswerBar
                            agent={agent}
                            selections={selections}
                            texts={texts}
                            sent={sent}
                            numbered
                            hideQuestion
                            activeQuestion={activeQuestion}
                            onToggle={onToggleAnswer}
                            onText={onAnswerText}
                            onSubmit={onSubmitAnswer}
                            onSelectQuestion={onSelectQuestion}
                            onDismiss={
                                agent.ask?.oref
                                    ? () =>
                                          fireAndForget(() =>
                                              RpcApi.AgentAskClearCommand(TabRpcClient, agent.ask!.oref!)
                                          )
                                    : undefined
                            }
                            className="shrink-0 border-t border-edge-mid px-3 py-2"
                        />
                    ) : null}

                    {/* footer: the composer collapses to a slim "+ message… R" row by default and expands
                    on R / click. The structured AnswerBar above is the single suggestion affordance —
                    the free-form reply chips were removed so an ask never shows two suggestion rows. */}
                    <div className="shrink-0 border-t border-edge-mid">
                        {showComposer ? (
                            <motion.div
                                variants={composerReveal}
                                initial="initial"
                                animate="animate"
                                className="flex flex-col gap-1.5 overflow-hidden px-3 py-2"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <AgentComposer
                                    ref={composerRef}
                                    blockId={agent.blockId}
                                    placeholder={`message ${agent.name}…`}
                                    onEscape={onComposerEscape}
                                    className="border-t-0 px-0 py-0"
                                />
                            </motion.div>
                        ) : (
                            <div
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenComposer();
                                }}
                                className="flex cursor-text items-center gap-2 px-3 py-1.5 hover:bg-surface-hover"
                            >
                                <Plus size={13} aria-hidden className="shrink-0 text-muted" />
                                <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">{`message ${agent.name}…`}</span>
                                <span className="shrink-0 rounded-[5px] border border-edge-mid px-1.5 py-px font-mono text-[10.5px] text-muted">
                                    R
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                {!atBottom ? <JumpToLatestPill onClick={jumpToBottom} /> : null}
            </div>
        </motion.div>
    );
});
