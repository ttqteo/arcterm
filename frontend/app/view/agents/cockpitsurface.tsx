// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, useSetAtom, type PrimitiveAtom } from "jotai";
import { AnimatePresence, MotionConfig } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildCockpitBindings } from "@/app/store/keybindings/bindings";
import { focusClaimed } from "@/app/store/keybindings/dispatcher";
import { openTarget } from "@/app/view/jarvis/openref";
import { useKeybindings } from "@/app/store/keybindings/store";
import { dismissAgent, toggleAgentBackground } from "./agentactions";
import { showTerminal } from "./agentcenter";
import { AgentRow } from "./agentrow";
import type { AgentsViewModel, ChipFilter } from "./agents";
import {
    askSentKey,
    filterAgents,
    groupAgents,
    applyAgentOrder,
    streamableTranscriptAgents,
    matchesProjectFilter,
    partitionBackgrounded,
    syncCardOrder,
    type AgentVM,
} from "./agentsviewmodel";
import {
    buildGridCards,
    cardMatchesChip,
    cardShare,
    columnNavIds,
    isBackgroundedRun,
    resolveCursor,
    gridColumnCount,
    splitGridColumns,
    toggleChip,
    withActiveRunLeads,
    type CardShare,
    type GridCard,
    type RowTarget,
} from "./cardgridlayout";
import { hiddenAgentIds, rosterLoadPhase, splitRecentlyIdle } from "./cockpitsurfacemodel";
import { BackgroundAgentsStrip } from "./backgroundagentsstrip";
import { BackgroundedSection } from "./backgroundedsection";
import { channelMessagesAtom } from "./channelsstore";
import { answeredAskIdsAcross, needsHuman } from "./jarvisderive";
import { IdleSection } from "./idlesection";
import { LeadCard } from "./leadcard";
import { rowAction } from "./leadcardactions";
import { buildLeadCard, isLeadDown, rowKeyActions, stopSelector, type LeadCardVM } from "./leadcardmodel";
import { ensurePreviousInfo, rosterSeededAtom } from "./liveagents";
import { idsWithEntriesAtom } from "./livetranscriptatoms";
import { CockpitEmptyState } from "./cockpitemptystate";
import { CockpitRail } from "./cockpitrail";
import { useRailTracking } from "./cockpiteventsrail";
import { HintsBar } from "./cockpithelp";
import { RollingCount } from "./rollingcount";
import { ensureRunEvents, runEventsAtom } from "./runeventstore";
import { loadRunUsage, runUsageAtom } from "./runtokenstore";
import { summarizeUsage } from "./runusage";
import { useRunDigests } from "./runlineagestore";
import { ARROW_DIR, useCockpitKeyboard, type OfficeKeys } from "./usecockpitkeyboard";
import { CockpitOffice, type OfficeHandle } from "./cockpitoffice";
import { officeInputs } from "./officeinputs";
import { cockpitView, cockpitViewAtom } from "./officestore";
import { useCardStreams } from "./usecardstreams";
import { NeedsYouStrip } from "./needsyoustrip";
import { ProjectSwitcher } from "./projectswitcher";
import { useSubagentTracking } from "./subagenttracking";
import { SURFACE_TITLE_CLASS } from "./surfacescaffold";
import { openLauncher } from "./launcherstore";
import { landOn } from "@/app/view/jarvis/returnsurface";

// Status tabs (mockup A3): a tab's count takes its status color while it has any, the selected tab underlines
const TAB_TONE: Record<ChipFilter, { text: string; line: string }> = {
    asking: { text: "text-warning", line: "border-warning" },
    working: { text: "text-working", line: "border-working" },
    idle: { text: "text-muted", line: "border-muted" },
    all: { text: "text-primary", line: "border-primary" },
};

// the Office popup's card fills the popup's box: no floor, so a card that asks never outgrows it
const POPUP_SHARE: CardShare = { grow: 1, minPx: 0 };

// Bridges a model PrimitiveAtom to a useState-shaped [value, setter] pair so the lifted orchestration
// state reads/writes through the model while the existing call sites (incl. functional updaters) work.
function useModelAtom<T>(a: PrimitiveAtom<T>): [T, (v: T | ((p: T) => T)) => void] {
    const value = useAtomValue(a);
    const set = (v: T | ((p: T) => T)) =>
        globalStore.set(a, typeof v === "function" ? (v as (p: T) => T)(globalStore.get(a)) : v);
    return [value, set];
}

export function CockpitSurface({ model }: { model: AgentsViewModel }) {
    const agents = useAtomValue(model.agentsAtom);
    const seeded = useAtomValue(rosterSeededAtom);
    useSubagentTracking(agents);
    const { asking, working, idle } = groupAgents(agents);

    // channel-aware "needs you": excludes asks Jarvis already auto-answered, so it matches the Channels
    // rail dot and nav badge (raw asking historically over-counted). it feeds the need-you tab (liveAsking)
    // and each card's needs-you below.
    const channelMessages = useAtomValue(channelMessagesAtom);
    const answeredAsks = answeredAskIdsAcross(Object.values(channelMessages));

    // `structuralNow` feeds structural computations below (usage-window rollover, the idle-grace window,
    // and which transcripts stay streamed). Subscribe to the coarse (~15s) structural clock REACTIVELY —
    // coarse enough to avoid the per-second grid reconcile, but reactive so these decisions still roll
    // over on their own in a quiescent fleet (no chunk/status churn to piggyback on). The live "age/quiet"
    // cues that need per-second precision live in self-subscribing leaves (QuietDot, CockpitEventsRail,
    // CockpitRail), which read the 1s `nowAtom` directly.
    const structuralNow = useAtomValue(model.structuralNowAtom);
    // Both clocks are driven by the single always-mounted NowTicker (cockpit root); the leaf
    // indicators (QuietDot, CockpitEventsRail, CockpitRail) self-subscribe to `nowAtom` directly.

    // A just-finished agent keeps its full row (so you can reply) for the grace window, then collapses
    // into the Idle list. Dismissals are keyed by idle episode (id:idleSince).
    const [dismissed] = useModelAtom(model.dismissedAtom);
    const [backgroundedIds, setBackgroundedIds] = useModelAtom(model.backgroundedIdsAtom);
    const { recently: recentlyIdle, parked: parkedIdle } = splitRecentlyIdle(idle, structuralNow, dismissed);
    // one unified list: asks stay in place alongside active working + just-finished (grace) rows,
    // minus anything backgrounded. Asking agents are never backgrounded (the effect below un-mutes any
    // that start asking), so they always land in `active` and hold whatever slot they already had.
    const { active: activeAgents, backgrounded } = partitionBackgrounded(
        [...asking, ...working, ...recentlyIdle],
        backgroundedIds
    );

    // one-shot previous-info for asking agents (seeds first paint; the live stream supersedes it)
    useEffect(() => {
        for (const a of asking) {
            if (a.transcriptPath) {
                void ensurePreviousInfo(a.id, a.transcriptPath, a.agent);
            }
        }
    }, [asking]);

    // open a live transcript stream + git tracking per rendered active agent; keep recently-idle
    // streams during the grace window so final transcript writes cannot race the stop event.
    useCardStreams(
        streamableTranscriptAgents([...asking, ...working, ...recentlyIdle], structuralNow)
            .filter((a) => a.transcriptPath)
            .map((a) => ({ id: a.id, path: a.transcriptPath!, agent: a.agent, blockId: a.blockId })),
        { trackGit: true },
    );

    // anchored order (kept ids hold their slot; new ids append) + manual drag reorder. This is what
    // stops a working->asking transition from jumping: the id already holds a slot, so it stays put.
    // Synced over the whole roster, not the cards shown: the sidebar's Active section reads it too.
    const [order, setOrder] = useModelAtom(model.orderAtom);
    useEffect(() => {
        setOrder((prev) => syncCardOrder(prev, agents));
    }, [agents.map((a) => a.id).join(",")]);
    const orderedAgents = applyAgentOrder(order, activeAgents);

    // cursor + answer selection (lifted onto the model); help/pulse stay ephemeral surface-local
    const [cursorId, setCursorId] = useModelAtom(model.cursorIdAtom);
    const [answerSel] = useModelAtom(model.answerSelAtom);
    const answerText = useAtomValue(model.answerTextAtom);
    const [answerTab, setAnswerTab] = useModelAtom(model.answerTabAtom);
    const openComposerId = useAtomValue(model.openComposerIdAtom);
    const setOpenComposerId = useSetAtom(model.openComposerIdAtom);
    const sentIds = useAtomValue(model.sentIdsAtom);
    const chip = useAtomValue(model.chipFilterAtom);
    const setChip = (c: ChipFilter) => globalStore.set(model.chipFilterAtom, c);
    // the Cockpit is the card grid or the office (cockpit office spec); the office draws the same cards
    const view = cockpitView(useAtomValue(cockpitViewAtom));
    const officeRef = useRef<OfficeHandle | null>(null);

    const [pulseId, setPulseId] = useState<string>();
    const lastJumpRef = useRef<string>(undefined);
    const containerRef = useRef<HTMLDivElement>(null);
    // the keys are this container's own onKeyDown, so arriving without focus inside it (palette pick,
    // nav click, Escape home) left them dead until a click
    useEffect(() => {
        const el = containerRef.current;
        if (el && !el.contains(document.activeElement) && !focusClaimed()) {
            el.focus({ preventScroll: true });
        }
    }, []);
    // DEV-only seams for the cockpit-office scenarios; never in a production build
    useEffect(() => {
        if (import.meta.env.DEV) {
            void import("./cockpitofficedevhooks").then((m) => m.installCockpitOfficeDevHooks(model));
        }
    }, []);
    const gridScrollRef = useRef<HTMLDivElement>(null);
    const [gridViewportPx, setGridViewportPx] = useState(0);
    const [gridWidthPx, setGridWidthPx] = useState(0);
    useEffect(() => {
        const el = gridScrollRef.current;
        if (!el) {
            return;
        }
        // fill against the content box (clientHeight includes padding — sizing to the full client
        // box overflows by exactly that padding and shows a spurious scrollbar)
        const measure = () => {
            const cs = getComputedStyle(el);
            setGridViewportPx(el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
            setGridWidthPx(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
        };
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, [view]);

    // status chips narrow what the grid renders; cursor/order still operate over the full set
    const projectFilter = useAtomValue(model.projectFilterAtom);
    const liveOnly = useAtomValue(model.liveOnlyAtom);
    const visibleOrdered = filterAgents(orderedAgents, projectFilter, liveOnly);
    // run events feed lead-down, review findings and the Events rail; digests feed lanes and question owners
    const lineage = useAtomValue(model.lineageAtom);
    const runsInView = Object.values(lineage.runs);
    useRunDigests(runsInView);
    const runKey = runsInView.map((r) => `${r.runId}:${r.channelId}`).join(",");
    useEffect(() => {
        runsInView.filter((r) => r.channelId).forEach((r) => ensureRunEvents(r.runId, r.channelId));
    }, [runKey]);
    const runEventsAtomForView = useMemo(
        () => atom((get) => Object.fromEntries(runsInView.map((r) => [r.runId, get(runEventsAtom(r.runId))]))),
        [runKey]
    );
    const runEvents = useAtomValue(runEventsAtomForView) as Record<string, RunEvent[]>;
    useRailTracking(agents, lineage);
    const runUsage = useAtomValue(runUsageAtom);
    useEffect(() => {
        runsInView.forEach((r) => fireAndForget(() => loadRunUsage(r.channelId, r.runId, Date.now())));
    }, [runKey, structuralNow]);

    // one card per plain agent or run; a run's workers are rows of its card. A running run keeps its card while
    // its lead idles between wakes, so its lead is looked up in scope before parking and Live only.
    const runScope = filterAgents(agents, projectFilter, false);
    // agents with nothing to show stay off the grid and out of its counts until their first transcript entry
    const idsWithEntries = useAtomValue(idsWithEntriesAtom);
    const hidden = hiddenAgentIds(agents, idsWithEntries, lineage);
    const liveVisible = visibleOrdered.filter((a) => !hidden.has(a.id));
    const allCards = buildGridCards(withActiveRunLeads(visibleOrdered, runScope, lineage), lineage, agents);
    const leadVMs = new Map<string, LeadCardVM & { down: boolean }>();
    for (const c of allCards) {
        if (c.kind === "run") {
            const down = isLeadDown(runEvents[c.run.runId] ?? []);
            leadVMs.set(c.id, {
                ...buildLeadCard({
                    cardId: c.id,
                    run: c.run,
                    lead: c.lead,
                    roster: agents,
                    lineage,
                    leadDown: down,
                    now: structuralNow,
                    tokens: summarizeUsage(runUsage[c.run.runId]?.rows)?.total,
                }),
                down,
            });
        }
    }
    const cardNeedsYou = (c: GridCard) =>
        c.kind === "agent" ? needsHuman(c.agent, answeredAsks) : leadVMs.get(c.id)!.needsYou;
    const shownCards = allCards.filter(
        (c) =>
            !isBackgroundedRun(c, backgroundedIds, cardNeedsYou(c)) &&
            (c.kind !== "agent" || !hidden.has(c.agent.id))
    );
    const cards = shownCards.filter((c) => cardMatchesChip(c, chip, cardNeedsYou(c)));
    // counted by card, as the tab filters: a run's idle workers and a lead between wakes are not up for review
    const readyCount = shownCards.filter((c) => cardMatchesChip(c, "idle", cardNeedsYou(c))).length;
    const columns = splitGridColumns(cards, (c) => c.kind === "run", gridColumnCount(gridWidthPx));
    // cursor stops: cards, and each lead card's shown task rows; a worker's id aliases to its row
    const rowsOf = (c: GridCard) => {
        const vm = c.kind === "run" ? leadVMs.get(c.id) : undefined;
        return vm ? [...vm.rows, ...vm.waiting, ...vm.done] : [];
    };
    const navCols = columnNavIds(columns, (c) => rowsOf(c).map((r) => r.key));
    const navigableIds = navCols.flat();
    const rowTargets: Record<string, RowTarget> = {};
    const cursorAlias: Record<string, string> = {};
    const askTargets: string[] = [];
    for (const c of columns.flat()) {
        if (c.kind === "agent" ? c.agent.state === "asking" : c.lead?.state === "asking") {
            askTargets.push(c.id);
        }
        for (const r of rowsOf(c)) {
            const run = c.kind === "run" ? c.run : undefined;
            rowTargets[r.key] = {
                openId: r.openId,
                askAgentId: r.inline === "ask" ? r.worker?.id : undefined,
                actions: rowKeyActions(r).map((a) => () => run && fireAndForget(() => rowAction(run, r, a))),
            };
            if (r.worker) {
                cursorAlias[r.worker.id] = r.key;
            }
            if (r.needsYou) {
                askTargets.push(r.key);
            }
        }
    }
    const liveCount = liveVisible.length;
    const liveAsking = liveVisible.filter((a) => needsHuman(a, answeredAsks)).length;
    const liveWorking = liveVisible.filter((a) => a.state === "working").length;
    // idle/backgrounded sections share the project scope; live-only hides the parked-idle section
    const shownParkedIdle = liveOnly ? [] : parkedIdle.filter((a) => matchesProjectFilter(a, projectFilter));
    const shownBackgrounded = backgrounded.filter((a) => matchesProjectFilter(a, projectFilter));
    // the office draws the cards and the Idle section's agents (cockpit office spec, "Where it lives"). This
    // surface builds its cards anew on every render, so the office's input is kept by its content: a render that
    // changes nothing the office draws hands it the same arrays, and its plan and memoized desks stay put
    const officeFresh = view === "office" ? officeInputs(cards, shownParkedIdle, leadVMs, agents, lineage) : null;
    const officeKey = officeFresh ? JSON.stringify(officeFresh) : "";
    const officeIn = useMemo(() => officeFresh, [officeKey]);
    // an Events row names where a plain agent now sits when it is off the grid
    const railTags: Record<string, string> = {
        ...Object.fromEntries(parkedIdle.map((a) => [a.id, "idle"])),
        ...Object.fromEntries(backgrounded.map((a) => [a.id, "background"])),
    };

    // keep the cursor on a visible stop as the set changes; a worker's id follows its row, else the first stop
    useEffect(() => {
        // the office's stops include the Idle section's agents and seats with no card row
        const stops = view === "office" ? [...navigableIds, ...(officeRef.current?.order() ?? [])] : navigableIds;
        const next = resolveCursor(cursorId, stops, cursorAlias);
        if (next !== cursorId) {
            setCursorId(next);
        }
    }, [navigableIds.join(","), cursorId, view]);

    // asking overrides backgrounded: a muted agent that starts asking re-surfaces (it's in `asking`,
    // not `working`), so drop it from the set to avoid re-muting when it returns to working.
    useEffect(() => {
        const askingSet = new Set(asking.map((a) => a.id));
        setBackgroundedIds((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const id of prev) {
                if (askingSet.has(id)) {
                    next.delete(id);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [asking.map((a) => a.id).join(",")]);

    // a moved cursor scrolls its stop into view, a task row inside its card too; a jump (n, the rail) centers
    // its own target, so the follow-up here leaves that one alone
    const jumpedRef = useRef<string>(undefined);
    useEffect(() => {
        if (jumpedRef.current === cursorId) {
            jumpedRef.current = undefined;
            return;
        }
        if (cursorId == null) {
            return;
        }
        document.querySelector(stopSelector(cursorId))?.scrollIntoView({ block: "nearest" });
    }, [cursorId]);

    const scrollToPulse = (id: string) => {
        jumpedRef.current = id;
        document.querySelector(stopSelector(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
        setPulseId(id);
        setTimeout(() => setPulseId((p) => (p === id ? undefined : p)), 1200);
    };

    // An escalation's Open in the Needs-you strip: the asking agent's card, where its ask is answered. An agent
    // with no card on screen (a status tab or backgrounding hides it) opens in the Agent surface instead, through
    // the one router.
    const focusAgentCard = (agentId: string) => {
        const stop = cursorAlias[agentId] ?? agentId;
        if (navigableIds.includes(stop)) {
            setCursorId(stop);
            scrollToPulse(stop);
            return;
        }
        fireAndForget(() => openTarget(model, { kind: "agent", tabId: agentId }));
    };

    const focusRowComposer = (id: string) => {
        (document.querySelector(`[data-agent-id="${id}"] textarea`) as HTMLTextAreaElement)?.focus();
    };

    const toggleAnswer = (id: string, qi: number, oi: number) => model.toggleAnswer(id, qi, oi);

    const submitAnswer = (id: string) => model.submitAnswer(id);

    const selectQuestion = (id: string, qi: number) => setAnswerTab((prev) => ({ ...prev, [id]: qi }));

    const toggleBackground = (id: string) => {
        toggleAgentBackground(model, id);
    };

    // open the agent in the Agent surface: set focus, switch surface
    const openFocus = (id: string, reply: boolean) => {
        globalStore.set(model.focusIdAtom, id);
        globalStore.set(model.focusReplyAtom, reply);
        landOn(model.surfaceAtom, "agent");
        showTerminal();
    };

    // open this agent's changed files in the Diff surface (which scopes to focusIdAtom)
    const openDiff = (id: string) => {
        globalStore.set(model.focusIdAtom, id);
        landOn(model.surfaceAtom, "files");
    };

    const officeKeys = useMemo<OfficeKeys>(
        () => ({
            walk: (d) => officeRef.current?.walk(d),
            goTo: (k) => officeRef.current?.goTo(k),
            showPath: (k) => officeRef.current?.showPath(k),
            dismiss: () => officeRef.current?.dismiss(),
            openCard: () => officeRef.current?.openCard() ?? false,
            order: () => officeRef.current?.order() ?? [],
            asks: () => officeRef.current?.asks() ?? [],
        }),
        []
    );
    const toggleView = () => globalStore.set(cockpitViewAtom, view === "office" ? "cards" : "office");
    const onKeyDown = useCockpitKeyboard({
        model, navigableIds, cursorId, setCursorId, answerTab, answerSel,
        navCols, rowTargets, askTargets, roster: agents, lastJumpRef, setOpenComposerId,
        selectQuestion, toggleAnswer, submitAnswer, toggleBackground, openFocus, scrollToPulse, focusRowComposer,
        office: view === "office" ? officeKeys : undefined,
        toggleView,
    });

    // Cockpit triage keys are documented in the shared cheat sheet via these pass-through bindings (see
    // buildCockpitBindings); onKeyDown above still performs them. One help surface, one key registry.
    const cockpitBindings = useMemo(() => buildCockpitBindings(), []);
    useKeybindings(cockpitBindings);

    // one AgentRow with every callback wired
    const renderAgent = (a: AgentVM, share: CardShare) => (
        <AgentRow
            key={a.id}
            model={model}
            agent={a}
            nowAtom={model.nowAtom}
            share={share}
            isCursor={cursorId === a.id}
            pulse={pulseId === a.id}
            selections={answerSel[a.id] ?? {}}
            texts={answerText[a.id] ?? {}}
            sent={sentIds.has(askSentKey(a) ?? "")}
            activeQuestion={answerTab[a.id] ?? 0}
            composerOpen={openComposerId === a.id}
            onCursor={() => setCursorId(a.id)}
            onOpen={() => openFocus(a.id, false)}
            onOpenTerminal={() => model.openTerminal(a.id)}
            onOpenDiff={() => openDiff(a.id)}
            onOpenComposer={() => setOpenComposerId(a.id)}
            onToggleAnswer={(qi, oi) => toggleAnswer(a.id, qi, oi)}
            onAnswerText={(qi, value) => model.setAnswerText(a.id, qi, value)}
            onSubmitAnswer={() => submitAnswer(a.id)}
            onSelectQuestion={(qi) => selectQuestion(a.id, qi)}
            onComposerEscape={() => {
                setOpenComposerId(undefined);
                containerRef.current?.focus();
            }}
            onBackground={a.state === "working" || a.state === "asking" ? () => toggleBackground(a.id) : undefined}
            onDismiss={a.state === "idle" ? () => dismissAgent(model, a) : undefined}
        />
    );

    const renderCard = (c: GridCard, share = cardShare(c.kind === "run", cardNeedsYou(c))) => {
        if (c.kind === "agent") {
            return renderAgent(c.agent, share);
        }
        const vm = leadVMs.get(c.id)!;
        return (
            <LeadCard
                key={c.id}
                model={model}
                cardId={c.id}
                run={c.run}
                lead={c.lead}
                vm={vm}
                events={runEvents[c.run.runId] ?? []}
                leadDown={vm.down}
                share={share}
                isCursor={cursorId === c.id}
                cursorKey={cursorId}
                pulse={pulseId === c.id}
                composerOpen={c.lead != null && openComposerId === c.lead.id}
                onComposerEscape={() => {
                    setOpenComposerId(undefined);
                    containerRef.current?.focus();
                }}
                onCursor={(key) => setCursorId(key)}
                onOpen={(id) => openFocus(id, false)}
                onOpenDiff={openDiff}
                onBackground={c.lead && c.lead.state !== "asking" ? () => toggleBackground(c.lead!.id) : undefined}
            />
        );
    };

    // the card beside the desk the boss stands at: an agent's AgentRow, or for a seat or a meeting room its run's
    // LeadCard, the very ones the grid draws; an agent of the Idle section gets its row too. The popup's box sets
    // its height (officeplanmodel.ts popupBox), so it has no floor of its own.
    const renderOfficeCard = (key: string): ReactNode => {
        const c = cards.find((x) =>
            x.kind === "agent"
                ? x.id === key
                : x.id === key || key.startsWith(`${x.id}:`) || rowsOf(x).some((r) => r.key === key)
        );
        if (c) {
            return renderCard(c, POPUP_SHARE);
        }
        const parked = shownParkedIdle.find((a) => a.id === key);
        return parked ? renderAgent(parked, POPUP_SHARE) : null;
    };

    const phase = rosterLoadPhase(seeded, [...asking, ...working, ...idle].filter((a) => !hidden.has(a.id)).length);

    return (
        <MotionConfig reducedMotion="user">
        <div
            ref={containerRef}
            data-cockpit-surface
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => {
                const dir = ARROW_DIR[e.key];
                if (view === "office" && dir) {
                    officeRef.current?.release(dir);
                }
            }}
            className="relative flex h-full w-full text-secondary outline-none"
        >
            <div className="flex min-w-0 flex-1 flex-col bg-background">
                {/* one row: the tabs carry the counts a subtitle used to repeat */}
                <div className="sticky top-0 z-[5] shrink-0 bg-background">
                    <div className="flex flex-wrap items-end gap-x-5 gap-y-1 border-b border-border px-5 pt-2.5">
                        <h1 className={cn(SURFACE_TITLE_CLASS, "pb-2.5 leading-none")}>Cockpit</h1>
                        <div className="-mb-px flex flex-wrap gap-0.5">
                            {(
                                [
                                    ["asking", "need you", liveAsking],
                                    ["working", "working", liveWorking],
                                    ["idle", "ready for review", readyCount],
                                    ["all", "live", liveCount],
                                ] as [ChipFilter, string, number][]
                            ).map(([key, label, count]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setChip(toggleChip(chip, key))}
                                    className={cn(
                                        "flex cursor-pointer items-baseline gap-1.5 border-0 border-b-2 bg-transparent px-2.5 pb-2 pt-1.5 hover:bg-surface-hover",
                                        chip === key ? TAB_TONE[key].line : "border-transparent"
                                    )}
                                >
                                    <RollingCount
                                        value={count}
                                        className={cn(
                                            "text-[15px] font-semibold",
                                            count > 0 || chip === key ? TAB_TONE[key].text : "text-muted"
                                        )}
                                    />
                                    <span
                                        className={cn(
                                            "text-[12.5px] font-medium",
                                            chip === key ? "text-primary" : "text-ink-mid"
                                        )}
                                    >
                                        {label}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="mb-1.5 ml-auto flex flex-none items-center gap-2">
                            <div
                                role="group"
                                aria-label="Cockpit view"
                                data-cockpit-view-toggle
                                className="flex gap-0.5 rounded border border-edge-mid bg-surface p-0.5"
                            >
                                {(["cards", "office"] as const).map((v) => (
                                    <button
                                        key={v}
                                        type="button"
                                        aria-pressed={view === v}
                                        title={`${v === "cards" ? "Cards" : "Office"} (o)`}
                                        onClick={() => globalStore.set(cockpitViewAtom, v)}
                                        className={cn(
                                            "cursor-pointer rounded-[4px] border-0 px-2.5 py-[3px] text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                            view === v ? "bg-surface-selected text-primary" : "bg-transparent text-muted hover:text-ink-hi"
                                        )}
                                    >
                                        {v === "cards" ? "Cards" : "Office"}
                                    </button>
                                ))}
                            </div>
                            <ProjectSwitcher model={model} variant="header" />
                            <button
                                type="button"
                                onClick={() => globalStore.set(model.liveOnlyAtom, !liveOnly)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-[7px] rounded border px-2.5 py-1.5 text-[12px] font-medium",
                                    liveOnly
                                        ? "border-success/60 bg-success/10 text-success"
                                        : "border-edge-mid bg-surface-raised text-muted-foreground hover:border-edge-strong"
                                )}
                            >
                                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                                Live only
                            </button>
                        </div>
                    </div>
                </div>

                <NeedsYouStrip model={model} onFocusAgent={focusAgentCard} />

                <div className="relative flex min-h-0 flex-1 flex-col">
                    <AnimatePresence initial={false}>
                        {phase === "empty" ? (
                            <CockpitEmptyState
                                key="empty"
                                onNewAgent={() => openLauncher(model, "agent")}
                            />
                        ) : phase === "loading" ? (
                            <CockpitGridSkeleton key="loading" />
                        ) : null}
                    </AnimatePresence>

                    {view === "office" ? (
                        officeIn && (
                            <CockpitOffice
                                agents={officeIn.agents}
                                runs={officeIn.runs}
                                now={structuralNow}
                                model={model}
                                cursorId={cursorId}
                                onCursor={(key) => setCursorId(key)}
                                renderCard={renderOfficeCard}
                                handleRef={officeRef}
                            />
                        )
                    ) : (
                        <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-2.5">
                            <div className="flex items-start gap-2.5">
                                {columns.map((col, ci) => (
                                    <div
                                        key={ci}
                                        className="flex min-w-0 flex-1 flex-col gap-2.5"
                                        style={{ minHeight: gridViewportPx }}
                                    >
                                        <AnimatePresence initial={false}>
                                            {col.map((c) => renderCard(c))}
                                        </AnimatePresence>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="shrink-0 px-5">
                        <BackgroundedSection agents={shownBackgrounded} onRestore={(id) => toggleBackground(id)} />
                        {view === "office" ? null : <IdleSection agents={shownParkedIdle} onOpen={(id) => model.openTerminal(id)} />}
                        <BackgroundAgentsStrip model={model} />
                    </div>
                </div>

                <HintsBar model={model} hints={phase === "ready"} />
            </div>

            <CockpitRail
                model={model}
                lineage={lineage}
                runEvents={runEvents}
                tags={railTags}
                onSelectAgent={(id) => {
                    setCursorId(id);
                    scrollToPulse(id);
                }}
            />
        </div>
        </MotionConfig>
    );
}

// Card-shaped placeholders in the grid's own gutters, so the first cards land where the skeleton was.
// Columns that fill the viewport, as the real cards do (cardgridlayout.ts).
function CockpitGridSkeleton() {
    return (
        <div aria-hidden="true" className="absolute inset-0 z-[1] flex gap-2.5 px-5 pb-5 pt-2.5">
            {[2, 2, 1].map((cards, col) => (
                <div key={col} className="flex min-w-0 flex-1 flex-col gap-2.5">
                    {Array.from({ length: cards }, (_, i) => (
                        <Skeleton key={i} className="min-h-0 flex-1 rounded-[13px]" />
                    ))}
                </div>
            ))}
        </div>
    );
}
