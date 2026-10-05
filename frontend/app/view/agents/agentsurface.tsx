// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent (Focus) surface: AgentTree | center [| AgentDetailsRail]. The rail is toggleable
// (railVisibleAtom, default off, `d` key) so the surface is normally 2 panes, 3 with the rail open.
// The center is the focused agent's live Claude Code terminal (CockpitFocusPane) — the real TUI,
// not a narrated transcript; an AgentHeader bar sits above it for identity + the rail toggle. With no
// explicit focus it defaults to the first agent in order (handoff dc.html:1790
// `focusAgent = …find(fid) || list[0]`) — never the cockpit grid; only a zero-agent roster shows an
// empty state. The center is not always the terminal: centerModeAtom (agentcenter.ts) swaps it for one
// ended session's transcript or Conversation History, the terminal stack staying mounted but hidden, and
// with no agent those two still get the tree beside them (the empty state is only for the terminal mode).
// Routing is shell-side (this file is imported only by cockpitshell.tsx) so agents.tsx
// never imports CockpitFocusPane, keeping the agents -> focus-pane -> blockregistry -> agents eval
// cycle broken.

import { CockpitFocusPane } from "@/app/cockpit/focus-pane";
import { Skeleton, SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { buildAgentBindings } from "@/app/store/keybindings/bindings";
import { focusClaimed, isEditableTarget } from "@/app/store/keybindings/dispatcher";
import { useKeybindings } from "@/app/store/keybindings/store";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { MotionConfig } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { centerModeAtom, type CenterMode } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { AgentDetailsRail } from "./agentdetailsrail";
import { AgentHeader } from "./agentheader";
import { AgentLaunchHero } from "./agentlaunchhero";
import { AgentTree } from "./agenttree";
import { ConversationHistory } from "./conversationhistory";
import { projectOf } from "./agentsviewmodel";
import { CanvasPane } from "./canvaspane";
import { useCanvasPoller } from "./canvaspoller";
import { canvasStateAtom } from "./canvasstore";
import { rosterLoadPhase } from "./cockpitsurfacemodel";
import { autoOpenedAskIdsAtom, shouldAutoOpen } from "./docreview";
import { DocReviewPane } from "./docreviewpane";
import { docReviewStateAtom, openReview } from "./docreviewstore";
import { EndedTranscript } from "./endedtranscript";
import { DivergenceBanner } from "./focusbanner";
import { subjectDecision } from "./focussubject";
import { rosterSeededAtom } from "./liveagents";
import { SessionPane } from "./sessionpane";
import { terminalFullscreenAtom } from "./railstore";
import { isEndedWorkerId } from "./runlineage";
import { SubagentInterior } from "./subagentinterior";
import { focusSubagentAtom } from "./subagentsstore";
import { useSessionsScan } from "./usesessionsscan";

export function AgentSurface({ model, tabId }: { model: AgentsViewModel; tabId: string }) {
    const focusId = useAtomValue(model.focusIdAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const order = useAtomValue(model.orderAtom);
    const fullscreen = useAtomValue(terminalFullscreenAtom);
    const focusSub = useAtomValue(focusSubagentAtom);
    const ended = useAtomValue(model.endedWorkerAtom);
    const seeded = useAtomValue(rosterSeededAtom);
    // what the centre column shows: the terminal, one session's transcript, or Conversation History (agentcenter.ts).
    // The terminal stack below stays mounted, hidden, in the other two.
    const centerMode = useAtomValue(centerModeAtom);
    const wrapRef = useRef<HTMLDivElement>(null);
    // Focusable set = agents + background terminals. handoff (dc.html:1790): focusAgent = …find(fid) ||
    // list[0] — the Focus surface always shows something, defaulting to the first agent in order (never
    // a terminal, so background terminals stay backgrounded); it falls back to the first terminal only
    // when there are no agents. focusId is kept "always real" (initialized to a default, never empty).
    // A done task's worker has no terminal to mount, so it is focusable without being mountable.
    const mountable = [...agents, ...terminals];
    const focused = focusId != null ? (mountable.find((a) => a.id === focusId) ?? ended?.agent) : undefined;
    const agent = focused ?? agents.find((a) => a.id === order[0]) ?? agents[0] ?? terminals[0];
    const showSub = focusSub != null && focusSub.parentId === agent?.id;
    const canvasMode = useAtomValue(canvasStateAtom(agent?.id ?? ""))?.mode === "canvas";
    const reviewMode = useAtomValue(docReviewStateAtom(agent?.id ?? ""))?.mode === "review";
    // what shows in the terminal's place; the two are exclusive (agentview.ts)
    const swapped = reviewMode ? "review" : canvasMode ? "canvas" : null;
    useCanvasPoller(model, agent);

    // sync focusId to the defaulted agent so the tree highlights it and ←/→ start from the right place
    useEffect(() => {
        if (agent != null && focusId !== agent.id) {
            globalStore.set(model.focusIdAtom, agent.id);
        }
    }, [agent?.id, focusId, model]);

    // a stale interior (its parent is no longer focused) closes so the terminal returns
    useEffect(() => {
        if (focusSub != null && focusSub.parentId !== agent?.id) {
            globalStore.set(focusSubagentAtom, null);
        }
    }, [agent?.id, focusSub]);

    // a review opens by itself once per ask, only while you are on that agent and not typing: a lead's Spec/Plan
    // review as its dialog, a Doc review in the terminal's place (openReview makes its state first, so this
    // effect, which runs before the shell's roster sync, still lands in review mode)
    const surface = useAtomValue(model.surfaceAtom);
    // the sidebar's ended sessions: scanned after first paint on arriving here and when an agent exits, never at boot
    useSessionsScan(surface === "agent", agents);
    const askId = agent?.ask?.askId;
    useEffect(() => {
        const opened = globalStore.get(autoOpenedAskIdsAtom);
        const editable = isEditableTarget(document.activeElement);
        if (!shouldAutoOpen({ surface, focusedId: focusId, agent, opened, editable })) {
            return;
        }
        openReview(model, agent.id);
        globalStore.set(autoOpenedAskIdsAtom, new Set(opened).add(askId));
    }, [surface, focusId, agent?.id, askId]);

    // only pull focus to the wrapper for the no-terminal fallback (so esc/←→/d work without a click).
    // when the live terminal is shown it must own focus for immediate typing — stealing it back to the
    // wrapper would force a click before every keystroke, defeating the real-TUI default. the
    // surface keys still fire whenever focus isn't inside the terminal (e.g. after a tree-row click).
    useEffect(() => {
        if (agent != null && agent.blockId == null) {
            wrapRef.current?.focus();
        }
    }, [agent?.id]);

    // canvas and review mode hide the terminal, and a hidden xterm can still hold focus and eat c/[/]/m, so
    // entering one pulls focus away: into the review (its keys and selection live there), or to the wrapper for a
    // canvas. Returning to the same agent's terminal hands focus back to its xterm, or the wrapper with none.
    const lastSwap = useRef<{ id: string; on: typeof swapped } | null>(null);
    useEffect(() => {
        const prev = lastSwap.current;
        lastSwap.current = agent != null ? { id: agent.id, on: swapped } : null;
        const wrap = wrapRef.current;
        if (agent == null || prev == null || wrap == null) {
            return;
        }
        if (swapped != null && (prev.on !== swapped || prev.id !== agent.id)) {
            const pane = swapped === "review" ? wrap.querySelector<HTMLElement>("[data-doc-review-pane]") : null;
            (pane ?? wrap).focus();
        } else if (swapped == null && prev.on != null && prev.id === agent.id) {
            const term = wrap.querySelector<HTMLElement>(`[data-agent-terminal="${agent.id}"] .xterm-helper-textarea`);
            (term ?? wrap).focus();
        }
    }, [agent?.id, swapped]);

    // History and a session's transcript cover the terminal as canvas mode does, and a hidden xterm can still hold focus
    // and eat the surface's keys (Esc, j/k): leaving the terminal pulls focus to the wrapper, and returning to it hands
    // focus back to the focused agent's xterm, or to the wrapper when that xterm is not showing (canvas, subagent
    // interior, ended worker, no block), so it never drops to <body>
    const lastCenter = useRef<CenterMode>(centerMode);
    useEffect(() => {
        const prev = lastCenter.current;
        lastCenter.current = centerMode;
        if (centerMode !== "terminal" && prev === "terminal") {
            wrapRef.current?.focus();
        } else if (centerMode === "terminal" && prev !== "terminal" && agent != null) {
            const wrap = wrapRef.current;
            const term = wrap?.querySelector<HTMLElement>(`[data-agent-terminal="${agent.id}"] .xterm-helper-textarea`);
            (term?.checkVisibility() ? term : wrap)?.focus({ preventScroll: true });
        }
    }, [centerMode]);

    // the surface stays mounted, so the effects above never run on a switch back to it, and arriving left
    // focus on <body>: typing reached the agent only after a click. Arriving hands focus to the review when it
    // shows, else the live terminal, or the wrapper when none is showing (canvas, subagent interior, no terminal).
    useEffect(() => {
        const wrap = wrapRef.current;
        if (
            surface !== "agent" ||
            agent == null ||
            wrap == null ||
            wrap.contains(document.activeElement) ||
            focusClaimed()
        ) {
            return;
        }
        const pane = wrap.querySelector<HTMLElement>("[data-doc-review-pane]");
        const term = wrap.querySelector<HTMLElement>(`[data-agent-terminal="${agent.id}"] .xterm-helper-textarea`);
        (pane ?? (term?.checkVisibility() ? term : wrap)).focus({ preventScroll: true });
    }, [surface]);

    // Agent-surface keys live in the registry (bindings.ts). Stable array — run() reads live atoms.
    const agentBindings = useMemo(() => buildAgentBindings(model), [model]);
    useKeybindings(agentBindings);

    // Agent declares "subject" project posture. It has no scope atom of its own — its target is
    // whichever agent you selected — so it is only ever aligned or diverged, never seeded: focus must
    // not silently switch which terminal you are looking at. Rejoining is a click, which may.
    const filter = useAtomValue(model.projectFilterAtom);
    const decision = subjectDecision(agent ? projectOf(agent) : null, filter === "all" ? null : filter);
    const rejoin = () => {
        const target = agents.find((a) => projectOf(a) === filter);
        if (target != null) {
            globalStore.set(model.focusIdAtom, target.id);
        }
    };

    if (!agent) {
        if (rosterLoadPhase(seeded, agents.length) === "loading") {
            return <AgentSurfaceSkeleton />;
        }
        if (centerMode === "terminal") {
            return <AgentLaunchHero model={model} />;
        }
        // History and a session read without an agent: the tree is where they are opened from
        return (
            <MotionConfig reducedMotion="user">
                <div
                    ref={wrapRef}
                    tabIndex={0}
                    data-cockpit-surface-wrap
                    className="flex h-full w-full bg-background outline-none"
                >
                    <AgentTree model={model} />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <AgentCenterPane model={model} mode={centerMode} />
                    </div>
                </div>
            </MotionConfig>
        );
    }

    return (
        <MotionConfig reducedMotion="user">
            <div ref={wrapRef} tabIndex={0} data-cockpit-surface-wrap className="flex h-full w-full bg-background outline-none">
                {/* the tree stays in canvas and review mode: hiding it made reaching another agent a round trip through the terminal */}
                {!fullscreen || centerMode !== "terminal" ? <AgentTree model={model} /> : null}
                <div className="flex min-w-0 flex-1 flex-col">
                    {/* terminal stack stays mounted (hidden) while a subagent interior, a session or History is shown, so
                        returning to the parent never remounts/replays the live TUI (frame-stacking) */}
                    <div
                        className={cn(
                            "flex min-h-0 flex-1 flex-col",
                            (showSub || centerMode !== "terminal") && "hidden"
                        )}
                    >
                        <AgentHeader model={model} agent={agent} />
                        <DivergenceBanner scope="project" decision={decision} onRejoin={rejoin} />
                        {mountable
                            .filter((a) => a.blockId != null)
                            .map((a) => (
                                <div
                                    key={a.id}
                                    data-agent-terminal={a.id}
                                    className={cn(
                                        "min-h-0 flex-1",
                                        a.id === agent.id && swapped == null ? "flex flex-col" : "hidden"
                                    )}
                                >
                                    <CockpitFocusPane blockId={a.blockId!} tabId={tabId} />
                                </div>
                            ))}
                        {isEndedWorkerId(agent.id) ? (
                            <EndedTranscript model={model} agent={agent} />
                        ) : reviewMode ? (
                            <DocReviewPane model={model} agent={agent} />
                        ) : canvasMode ? (
                            <CanvasPane model={model} agent={agent} />
                        ) : agent.blockId == null ? (
                            <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
                                No live terminal for this agent.
                            </div>
                        ) : null}
                    </div>
                    {showSub && centerMode === "terminal" ? (
                        <SubagentInterior sub={focusSub!} parentName={agent.name} />
                    ) : null}
                    {centerMode !== "terminal" ? <AgentCenterPane model={model} mode={centerMode} /> : null}
                </div>
                {!fullscreen && centerMode === "terminal" && swapped == null && agent.kind !== "terminal" ? (
                    <AgentDetailsRail model={model} agent={agent} />
                ) : null}
            </div>
        </MotionConfig>
    );
}

// History and a session's transcript take the centre column; the terminal stack stays mounted beside them
function AgentCenterPane({ model, mode }: { model: AgentsViewModel; mode: Exclude<CenterMode, "terminal"> }) {
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {mode === "history" ? <ConversationHistory model={model} /> : <SessionPane model={model} />}
        </div>
    );
}

// the tree column and the terminal pane, so the first agent lands where the skeleton was
function AgentSurfaceSkeleton() {
    return (
        <div aria-hidden="true" className="flex h-full w-full bg-background">
            <div className="flex w-[248px] shrink-0 flex-col gap-3 border-r border-border bg-surface px-4 pt-4">
                <SkeletonLine className="h-[12px] w-[90px]" />
                {[0, 1, 2, 3].map((i) => (
                    <SkeletonLine key={i} className="h-[30px] w-full rounded-[8px]" />
                ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
                <SkeletonLine className="h-[18px] w-[220px]" />
                <Skeleton className="min-h-0 flex-1 rounded-[10px]" />
            </div>
        </div>
    );
}
