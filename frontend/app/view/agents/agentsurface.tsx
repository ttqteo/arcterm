// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent (Focus) surface: AgentTree | center [| AgentDetailsRail]. The rail is toggleable
// (railVisibleAtom, default on, `d` key): the surface is normally 3 panes, 2 plus the 44px strip with the rail
// closed; a plain terminal has none (the tree's Terminals section is the way to the others). A terminal chosen while
// there is an agent does not take the centre: it docks in a third grid row under the agent (terminaldock.ts).
// The center is the focused agent's live Claude Code terminal (CockpitFocusPane) — the real TUI,
// not a narrated transcript; an AgentHeader bar sits above it for identity + the rail toggle. The terminal
// stack is up to four of them in a 2x2 CSS grid (agentgrid.ts, gridstore.ts): focusIdAtom stays the single
// selection, and the surface reconciles the saved grid against it, so every route that selects an agent
// obeys one rule. With no explicit focus it defaults (resolveShownAgent, cockpitsurfacemodel.ts; handoff
// dc.html:1790 `focusAgent = …find(fid) || list[0]`) — never the cockpit's card grid; only a zero-agent roster
// shows an empty state. The center is not always the terminal: centerModeAtom (agentcenter.ts) swaps it for one
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
import { useEffect, useMemo, useRef, useState } from "react";
import { centerModeAtom, type CenterMode } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { AgentDetailsRail } from "./agentdetailsrail";
import { gridEquals, placementStyle, reconcileGrid, visibleCells } from "./agentgrid";
import { AgentHeader } from "./agentheader";
import { AgentLaunchHero } from "./agentlaunchhero";
import { AgentTree } from "./agenttree";
import { ConversationHistory } from "./conversationhistory";
import { projectOf } from "./agentsviewmodel";
import { CanvasPane } from "./canvaspane";
import { useCanvasPoller } from "./canvaspoller";
import { canvasStateAtom } from "./canvasstore";
import { resolveShownAgent, rosterLoadPhase } from "./cockpitsurfacemodel";
import { autoOpenedAskIdsAtom, shouldAutoOpen } from "./docreview";
import { DocReviewPane } from "./docreviewpane";
import { docReviewStateAtom, openReview } from "./docreviewstore";
import { EndedTranscript } from "./endedtranscript";
import { DivergenceBanner } from "./divergencebanner";
import { subjectDecision } from "./focussubject";
import { GridCellBar } from "./gridcellbar";
import { GridDropOverlay } from "./griddropoverlay";
import { agentGridAtom, currentGrid, eligibleIds, removeFromGrid } from "./gridstore";
import { rosterSeededAtom } from "./liveagents";
import { RunPane } from "./runpane";
import { SessionPane } from "./sessionpane";
import {
    dockedTerminalAtom,
    terminalDockDragAtom,
    terminalDockHeightAtom,
    terminalDockMaxAtom,
    terminalFullscreenAtom,
} from "./railstore";
import { projectFocusTarget } from "./railterminals";
import { isEndedWorkerId } from "./runlineage";
import { SubagentInterior } from "./subagentinterior";
import { focusSubagentAtom } from "./subagentsstore";
import { clampDockHeight, splitDock } from "./terminaldock";
import { TerminalDockBar } from "./terminaldockbar";
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
    const gridState = useAtomValue(agentGridAtom);
    // what the centre column shows: the terminal, one session's transcript, or Conversation History (agentcenter.ts).
    // The terminal stack below stays mounted, hidden, in the other two.
    const centerMode = useAtomValue(centerModeAtom);
    const wrapRef = useRef<HTMLDivElement>(null);
    // Focusable set = agents + background terminals. handoff (dc.html:1790): focusAgent = …find(fid) ||
    // list[0] — the Focus surface always shows something. With nothing in focus resolveShownAgent picks it (the
    // order is documented there; a terminal only when there is no agent), and holds the skeleton while the roster
    // loads and none of a saved grid's agents has arrived. focusId is kept "always real" (initialized to a
    // default, never empty). A done task's worker has no terminal to mount, so it is focusable without being
    // mountable.
    const mountable = [...agents, ...terminals];
    // The grid's cells are live agents with a terminal. A plain terminal is shown alone (visibleCells); a done
    // worker's transcript replaces the grid (terminalShown). Both leave the saved grid as it was.
    const eligible = useMemo(() => eligibleIds(agents), [agents]);
    const chosen = focusId != null ? (mountable.find((a) => a.id === focusId) ?? ended?.agent) : undefined;
    // A terminal chosen while there is an agent docks under the agent that was showing instead of taking its place
    // (terminaldock.ts); the effects below write focusIdAtom back to that agent and the dock atom to the terminal.
    const dockedId = useAtomValue(dockedTerminalAtom);
    const hostRef = useRef<string | null>(null);
    const dock = splitDock({ focused: chosen, docked: dockedId, host: hostRef.current, agents, terminals });
    const focused = dock.focused;
    const { agent, hold: holdForGrid } = resolveShownAgent({
        focused,
        agents,
        terminals,
        firstInOrder: order[0],
        grid: gridState,
        eligible,
        seeded,
    });
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

    // the agent shown above is what the next chosen terminal docks under; the dock atom follows splitDock (a newly
    // chosen terminal, or empty once its terminal closed)
    useEffect(() => {
        if (agent != null && agent.kind !== "terminal") {
            hostRef.current = agent.id;
        }
    }, [agent?.id, agent?.kind]);
    useEffect(() => {
        if (globalStore.get(dockedTerminalAtom) !== dock.dockedId) {
            globalStore.set(dockedTerminalAtom, dock.dockedId);
        }
        if (dock.dockedId == null && globalStore.get(terminalDockMaxAtom)) {
            globalStore.set(terminalDockMaxAtom, false);
        }
    }, [dock.dockedId]);

    // The grid follows the roster and the focus (reconcileGrid): agents that left are pruned, and the focused
    // agent takes its cell or the focused cell. Memoized in render, not left to the effect, so the cells drawn below
    // are already right; written back only when it differs, which makes it a fixed point (reconcileGrid is
    // idempotent). The write is skipped when the stored grid moved on since this render (a drop or an x landing
    // before the effect flushed): the next render reconciles that one instead of this stale snapshot.
    const reconciled = useMemo(
        () => reconcileGrid(gridState, { focusId: agent?.id, eligible, seeded }),
        [gridState, agent?.id, eligible, seeded]
    );
    useEffect(() => {
        if (!gridEquals(globalStore.get(agentGridAtom), gridState)) {
            return;
        }
        if (!gridEquals(reconciled, gridState)) {
            globalStore.set(agentGridAtom, reconciled);
        }
    }, [reconciled, gridState]);

    // What the terminal stack shows: the grid's cells, or one cell alone (fullscreen; an agent that is not a cell,
    // such as a terminal). When the centre shows something else (a subagent's interior, a session or History, a canvas
    // or a review, a done worker's transcript) the grid hides, with every pane still mounted, and comes back as it was.
    // stackHidden is also what hides the whole column (header and all) in the subagent-interior and session/History
    // cases.
    const stackHidden = showSub || centerMode !== "terminal";
    const terminalShown = agent != null && !stackHidden && swapped == null && !isEndedWorkerId(agent.id);
    // Until the roster is seeded the saved cells are not pruned, so a cell whose agent has not arrived yet still holds
    // its slot (deliberate: showing the arrived ones full-size first would redraw their TUIs twice). It has no pane, so
    // it draws as an empty slot, and the count can then read 1 or more while the grid itself is hidden (gridShown).
    const cells = terminalShown ? visibleCells(reconciled, { focusId: agent?.id, collapsed: fullscreen }) : [];
    const cellOf = new Map(cells.map((cell, index) => [cell.id, { cell, index }] as const));
    const multi = cells.length > 1;
    // a visible cell with no pane (a launch with no terminal yet) leaves the grid hidden so the fallback below shows
    const gridShown = mountable.some((a) => a.blockId != null && cellOf.has(a.id));
    // The docked terminal is a third grid row under the cells, spanning both columns, so its pane stays under the same
    // parent as every other (no remount). Not under a terminal shown alone. Maximized (dockMax) it spans all three rows
    // and the agents' cells hide under it; fullscreen shows the focused cell alone, so it drops the dock unless the dock
    // is what is maximized, which then fills the whole surface.
    const dockable = gridShown && agent?.kind !== "terminal" ? dock.docked : undefined;
    const dockMax = useAtomValue(terminalDockMaxAtom) && dockable != null;
    const docked = !fullscreen || dockMax ? dockable : undefined;
    // the cells' tiled look (gaps, borders, bars) is off while the dock covers them
    const tiled = multi && !dockMax;
    const gridRef = useRef<HTMLDivElement>(null);
    const [gridHeight, setGridHeight] = useState(0);
    useEffect(() => {
        const el = gridRef.current;
        if (el == null) {
            return;
        }
        const ro = new ResizeObserver(() => setGridHeight(el.clientHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, [agent == null]);
    const storedDockHeight = useAtomValue(terminalDockHeightAtom);
    const dragDockHeight = useAtomValue(terminalDockDragAtom);
    const dockHeight = clampDockHeight(dragDockHeight ?? storedDockHeight, gridHeight);

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

    // Moves DOM focus into an agent's xterm when it is showing (not into a hidden pane, which cannot take it).
    const focusTerminalOf = (id: string) => {
        const term = wrapRef.current?.querySelector<HTMLElement>(
            `[data-agent-terminal="${id}"] .xterm-helper-textarea`
        );
        if (term?.checkVisibility()) {
            term.focus({ preventScroll: true });
        }
    };

    // A terminal just docked takes the keyboard, as choosing it did when it took the centre. Only on a change of
    // terminal, so the dock reappearing after a session read or fullscreen does not pull focus from the agent.
    const lastDocked = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (docked == null || docked.id === lastDocked.current) {
            return;
        }
        lastDocked.current = docked.id;
        focusTerminalOf(docked.id);
    }, [docked?.id]);
    const toggleDockMax = () => {
        const next = !globalStore.get(terminalDockMaxAtom);
        globalStore.set(terminalDockMaxAtom, next);
        // the button that held focus stays, but typing belongs in the terminal it just resized
        if (docked != null) {
            requestAnimationFrame(() => focusTerminalOf(docked.id));
        }
    };
    const closeDock = () => {
        globalStore.set(dockedTerminalAtom, null);
        globalStore.set(terminalDockMaxAtom, false);
        lastDocked.current = undefined;
        if (agent != null) {
            focusTerminalOf(agent.id);
        }
    };

    // Ctrl+Tab, a notification or an openref write changes focusIdAtom but leaves DOM focus where it was. When that is
    // inside a different cell's xterm, typing would still go to the old agent while the header names the new one, so
    // hand focus to the new agent's xterm; in a multi-cell grid an outside write does redirect typing to the newly
    // selected agent, which is accepted. Only from inside a terminal: from the tree, the wrapper or a note field there
    // is nothing to hand over, and focusing an xterm there would turn the next j/k/arrow into typing.
    // Gated to several cells showing: the old xterm is then still visible and keeps receiving keystrokes. With one cell
    // the old pane is hidden, so nothing is misrouted, and an outside write (wsh ui, a notification) must not move the
    // user's typing into a different agent mid-keystroke.
    // data-agent-terminal is on the cell wrappers only, so `from` is always a cell of this surface.
    // Palette picks are not handled here: a thing-action writes focusIdAtom in one commit and the palette closes in the
    // next, where ModalShell restores focus and this does not re-run. focusCell hands that restore over (below).
    useEffect(() => {
        if (!multi || agent == null) {
            return;
        }
        const from = document.activeElement?.closest<HTMLElement>("[data-agent-terminal]");
        if (from == null || from.dataset.agentTerminal === agent.id) {
            return;
        }
        focusTerminalOf(agent.id);
    }, [agent?.id]);

    // Ctrl+Tab pressed while typing in a terminal keeps typing in the agent it moved to, and a launch types into the
    // agent it started (typingFollowsAtom): its terminal when it shows, else the wrapper, so focus never drops to
    // <body>. A dialog that closes in the same commit (New agent) restores its focus in its effect cleanup, which
    // React runs before this effect, so the hand-off lands last.
    const typingFollows = useAtomValue(model.typingFollowsAtom);
    useEffect(() => {
        if (typingFollows == null || agent?.id !== typingFollows) {
            return;
        }
        globalStore.set(model.typingFollowsAtom, null);
        const wrap = wrapRef.current;
        const term = wrap?.querySelector<HTMLElement>(`[data-agent-terminal="${agent.id}"] .xterm-helper-textarea`);
        (term?.checkVisibility() ? term : wrap)?.focus({ preventScroll: true });
    }, [typingFollows, agent?.id]);

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

    // The x on a cell's bar unmounts the button that held focus and hides the removed pane, and showTerminal() is a no-op
    // when the centre is already the terminal, so the lastCenter effect never fires: focus would fall to <body>.
    // Counting removals lets this effect, which runs once the removal has rendered, hand focus to the focused cell's
    // terminal (or the wrapper when that xterm is not showing), as the arrival effect above does.
    const [removals, setRemovals] = useState(0);
    useEffect(() => {
        if (removals === 0) {
            return;
        }
        const wrap = wrapRef.current;
        const term = wrap?.querySelector<HTMLElement>(
            `[data-agent-terminal="${globalStore.get(model.focusIdAtom)}"] .xterm-helper-textarea`
        );
        (term?.checkVisibility() ? term : wrap)?.focus({ preventScroll: true });
    }, [removals]);
    const onRemoveCell = (id: string) => {
        if (!currentGrid(model).ids.includes(id)) {
            return;
        }
        removeFromGrid(model, id);
        setRemovals((n) => n + 1);
    };

    // Agent-surface keys live in the registry (bindings.ts). Stable array — run() reads live atoms.
    const agentBindings = useMemo(() => buildAgentBindings(model), [model]);
    useKeybindings(agentBindings);

    // Agent declares "subject" project posture. It has no scope atom of its own — its target is
    // whichever agent you selected — so it is only ever aligned or diverged, never seeded: focus must
    // not silently switch which terminal you are looking at. Rejoining is a click, which may.
    const filter = useAtomValue(model.projectFilterAtom);
    const decision = subjectDecision(agent ? projectOf(agent) : null, filter === "all" ? null : filter);
    const rejoin = () => {
        const target = projectFocusTarget(agents, terminals, filter);
        if (target != null) {
            globalStore.set(model.focusIdAtom, target.id);
        }
    };
    // A click or a focus inside a cell makes it the focused one; the header, the rail and the tree follow focusIdAtom.
    // The x on the bar is left out: it removes its own cell, so focusing that cell first would, on one that is not
    // focused, hand focus to a neighbour instead of keeping it where it was.
    // A focus that a closing modal hands back is not a pick either: ModalShell restores focus to what had it when it
    // opened, which for a palette opened from a terminal is that cell's xterm, and counting it would undo the pick
    // the palette just made (Open in split, an agent already in the grid). relatedTarget cannot spot the restore (null
    // when the old focus was removed), but a modal's dialog is still in the document through its exit animation, which
    // is when the restore runs. The restore lands in the old cell while the selected agent is another one, so hand
    // focus on to that agent's xterm here rather than leave typing going to the old one (the effect above cannot: a
    // palette thing-action changes the selection a commit before the palette closes). Clicks come in through
    // onMouseDownCapture, which this does not gate.
    const focusCell = (id: string, e: { target: EventTarget }, viaFocus = false) => {
        if (e.target instanceof Element && e.target.closest("[data-agent-cell-remove]") != null) {
            return;
        }
        if (viaFocus && document.querySelector('[role="dialog"][aria-modal="true"]') != null) {
            const picked = globalStore.get(model.focusIdAtom);
            if (multi && picked != null && picked !== id) {
                focusTerminalOf(picked);
            }
            return;
        }
        if (globalStore.get(model.focusIdAtom) !== id) {
            globalStore.set(model.focusIdAtom, id);
        }
    };

    if (!agent) {
        if (holdForGrid || rosterLoadPhase(seeded, agents.length) === "loading") {
            return <AgentSurfaceSkeleton />;
        }
        // with no agent the centre is the launch hero, or History or a session read; the tree stays beside it, since it is
        // where conversations and terminals are opened from
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
                        {centerMode === "terminal" ? (
                            <AgentLaunchHero model={model} />
                        ) : (
                            <AgentCenterPane model={model} mode={centerMode} />
                        )}
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
                    <div className={cn("flex min-h-0 flex-1 flex-col", stackHidden && "hidden")}>
                        {/* a maximized dock is the terminal's own view, its bar the only header: the agent's header
                            would name an agent that is not on screen */}
                        {dockMax ? null : (
                            <>
                                <AgentHeader model={model} agent={agent} />
                                <DivergenceBanner decision={decision} onRejoin={rejoin} />
                            </>
                        )}
                        {/* The grid parent is always rendered: hidden, never unmounted, so no xterm remounts. Tracks
                            are minmax(0, 1fr) and cells min-w-0 min-h-0 so a cell can shrink below its xterm's pixel
                            width, which is what makes the terminal's ResizeObserver fire and refit. Nothing here
                            animates size: one layout commit is one PTY resize. data-agent-grid-count is the visible
                            cells: before the roster is seeded it includes saved cells with no pane yet, and it can read
                            1 or more while the grid is hidden (gridShown false). */}
                        <div
                            ref={gridRef}
                            data-agent-grid
                            data-agent-grid-count={cells.length}
                            data-terminal-docked={docked?.id}
                            style={
                                docked != null
                                    ? { gridTemplateRows: `minmax(0, 1fr) minmax(0, 1fr) ${dockHeight}px` }
                                    : undefined
                            }
                            className={cn(
                                "min-h-0 min-w-0 flex-1",
                                gridShown ? "grid grid-cols-2 grid-rows-2" : "hidden",
                                gridShown && tiled && "gap-[6px] p-[6px]"
                            )}
                        >
                            {mountable
                                .filter((a) => a.blockId != null)
                                .map((a) => {
                                    const slot = cellOf.get(a.id);
                                    const cell = slot?.cell;
                                    // the docked terminal is the grid's third row (one wrapper either way, so its pane is
                                    // never re-parented); clicking it does not select it, the agent above stays selected
                                    const isDock = a.id === docked?.id;
                                    return (
                                        <div
                                            key={a.id}
                                            role="group"
                                            aria-label={a.name}
                                            aria-current={cell?.focused && multi ? "true" : undefined}
                                            data-agent-terminal={a.id}
                                            data-agent-cell={slot?.index}
                                            data-agent-focused={cell?.focused && multi ? "true" : undefined}
                                            data-terminal-dock={isDock ? "true" : undefined}
                                            style={
                                                isDock
                                                    ? {
                                                          gridRow: dockMax ? "1 / span 3" : "3 / span 1",
                                                          gridColumn: "1 / span 2",
                                                      }
                                                    : cell != null
                                                      ? placementStyle(cell.placement)
                                                      : undefined
                                            }
                                            onMouseDownCapture={isDock ? undefined : (e) => focusCell(a.id, e)}
                                            onFocus={isDock ? undefined : (e) => focusCell(a.id, e, true)}
                                            className={cn(
                                                "relative isolate min-h-0 min-w-0",
                                                (cell != null && !dockMax) || isDock ? "flex flex-col" : "hidden",
                                                (cell != null || isDock) &&
                                                    tiled &&
                                                    "overflow-hidden rounded-[8px] border",
                                                cell != null &&
                                                    multi &&
                                                    (cell.focused ? "border-accent" : "border-edge-mid"),
                                                isDock &&
                                                    !dockMax &&
                                                    (multi ? "border-edge-mid" : "border-t border-border")
                                            )}
                                        >
                                            {isDock ? (
                                                <TerminalDockBar
                                                    terminal={a}
                                                    height={dockHeight}
                                                    available={gridHeight}
                                                    maximized={dockMax}
                                                    onToggleMax={toggleDockMax}
                                                    onClose={closeDock}
                                                />
                                            ) : cell != null && multi ? (
                                                <GridCellBar
                                                    agent={a}
                                                    focused={cell.focused}
                                                    onRemove={() => onRemoveCell(a.id)}
                                                />
                                            ) : null}
                                            <CockpitFocusPane blockId={a.blockId!} tabId={tabId} />
                                            {/* Drop zones, only while an agent is dragged. Not before the roster is seeded
                                                (a drop prunes against the roster as it is), and not on a cell the saved
                                                grid does not hold (a terminal shown alone): a drop is an index into the grid. */}
                                            {cell != null && seeded && reconciled.ids.includes(a.id) ? (
                                                <GridDropOverlay model={model} id={a.id} ids={reconciled.ids} />
                                            ) : null}
                                        </div>
                                    );
                                })}
                        </div>
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
                {/* a plain terminal has no details of its own: no rail, the tree's Terminals section reaches the others.
                    Nor does a maximized dock, which is a terminal on screen alone. A canvas or a review in the
                    terminal's place keeps it, so swapping never moves the header's controls. */}
                {!fullscreen && centerMode === "terminal" && agent.kind !== "terminal" && !dockMax ? (
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
            {mode === "history" ? (
                <ConversationHistory model={model} />
            ) : mode === "run" ? (
                <RunPane model={model} />
            ) : (
                <SessionPane model={model} />
            )}
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
