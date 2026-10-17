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
    moveCursor,
    nextAskId,
    applyAgentOrder,
    streamableTranscriptAgents,
    matchesProjectFilter,
    dedupBackgroundAgents,
    partitionBackgrounded,
    syncCardOrder,
    type AgentVM,
} from "./agentsviewmodel";
import { diffStatsByIdAtom } from "./cardgitstore";
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
import { hiddenAgentIds, rosterLoadPhase, rosterOverlay, splitRecentlyIdle } from "./cockpitsurfacemodel";
import { BackgroundAgentsStrip } from "./backgroundagentsstrip";
import { backgroundAgentVMsAtom } from "./backgroundagentsstore";
import { BackgroundedSection } from "./backgroundedsection";
import { channelMessagesAtom } from "./channelsstore";
import { answeredAskIdsAcross, needsHuman } from "./jarvisderive";
import { IdleSection } from "./idlesection";
import { LeadCard } from "./leadcard";
import { rowAction } from "./leadcardactions";
import {
    buildLeadCard,
    isLeadDown,
    rowKeyActions,
    runAdjustable,
    stopSelector,
    type LeadCardVM,
} from "./leadcardmodel";
import { ensurePreviousInfo, rosterSeededAtom } from "./liveagents";
import { idsWithEntriesAtom } from "./livetranscriptatoms";
import { CockpitEmptyState } from "./cockpitemptystate";
import { CockpitRail } from "./cockpitrail";
import { useRailEvents, useRailTracking } from "./cockpiteventsrail";
import { footerEvent } from "./cockpitevents";
import { HintsBar } from "./cockpithelp";
import { RollingCount } from "./rollingcount";
import { ensureRunEvents, runEventsAtom } from "./runeventstore";
import { loadRunUsage, runUsageAtom } from "./runtokenstore";
import { summarizeUsage } from "./runusage";
import { useRunDigests } from "./runlineagestore";
import { ARROW_DIR, useCockpitKeyboard, type OfficeKeys } from "./usecockpitkeyboard";
import { CockpitOffice, type OfficeHandle } from "./cockpitoffice";
import { officeInputs } from "./officeinputs";
import {
    cockpitView,
    cockpitViewAtom,
    officeBoardPageAtom,
    officeBoardWhyAtom,
    officeBackgroundOpenAtom,
    officeEventsOpenAtom,
    officeLayoutAtom,
    toggleOfficeMute,
} from "./officestore";
import { EMPTY_LAYOUT } from "./officelayout";
import {
    chipDialog,
    dialogItems,
    liftDialog,
    questionTabs,
    type DeskKind,
    type DialogInput,
    type DialogItemId,
} from "./officedialogmodel";
import { boardCall, boardEmptyItems, boardItems, boardPage, boardTabs, boardWords } from "./officeboardmodel";
import { BOARD_KEY, LIFT_KEY } from "./officeplanmodel";
import { useNeedsYou } from "./needsyou";
import type { StripRow } from "./needsyoustripmodel";
import {
    AgentDialogBody,
    AgentPlate,
    BoardDialogBody,
    BoardEmptyBody,
    BoardPlate,
    ChipBody,
    ChipPlate,
    RunDialogBody,
    RunPlate,
    WorkerDialogBody,
    type OfficeDialogVM,
} from "./officedialog";
import type { OfficeMenuId } from "./officecontrols";
import { cheatsheetOpenAtom } from "@/app/cockpit/shortcuts-cheatsheet";
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

// the Office panel's card fills the panel: no floor, so a card that asks never outgrows it
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
    // Needs you: the Cards strip has its own rows (NeedsYouStrip); in Office these are the notice board's, one page each.
    // An escalation's Open goes through focusAgentCard, which is defined further down
    const focusAgentRef = useRef<(agentId: string) => void>(() => undefined);
    const ny = useNeedsYou(model, (agentId) => focusAgentRef.current(agentId));
    const boardCues = useMemo(() => ny.rows.map((r) => ({ key: r.key, kind: r.run.wireKind })), [ny.rows]);
    const boardPageAt = useAtomValue(officeBoardPageAtom);
    const boardWhyOpen = useAtomValue(officeBoardWhyAtom);
    // a page's Why is that page's: it shuts when another row comes into view, whether by a page turn or by the row in
    // view leaving (acted on, or gone on a reload), so it never opens on a row nobody asked about
    const boardRowKey = ny.rows[Math.max(boardPage(boardPageAt, ny.rows.length), 0)]?.key;
    useEffect(() => {
        globalStore.set(officeBoardWhyAtom, false);
    }, [boardRowKey]);

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
    // detached `claude --bg` sessions, counted as the background-agents strip shows them
    const shownBgSessions = dedupBackgroundAgents(useAtomValue(backgroundAgentVMsAtom), agents).filter((a) =>
        matchesProjectFilter(a, projectFilter)
    );
    // in Office the two sections stay hidden until the office menu's Background shows them (no room draws them)
    const backgroundOpen = useAtomValue(officeBackgroundOpenAtom);
    // an agent's box offers Diff while it shows the agent's changed files
    const diffStats = useAtomValue(diffStatsByIdAtom);
    const showBackground = view !== "office" || backgroundOpen;
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
        // the office's stops include the Idle section's agents and seats with no card row. The notice board and the lift are
        // stops the cursor may stay on at any row count (the boss stands at them even when nothing waits), but never the one
        // it falls back to: before the roster loads it would be the first stop, and the boss would open at the board
        const stops =
            view === "office"
                ? [...navigableIds, ...(officeRef.current?.order() ?? []).filter((k) => k !== BOARD_KEY)]
                : navigableIds;
        const next =
            view === "office" && (cursorId === BOARD_KEY || cursorId === LIFT_KEY)
                ? cursorId
                : resolveCursor(cursorId, stops, cursorAlias);
        if (next !== cursorId) {
            setCursorId(next);
        }
    }, [navigableIds.join(","), cursorId, view, ny.rows.length]);

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
    focusAgentRef.current = focusAgentCard;

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

    const cursorIdRef = useRef(cursorId);
    cursorIdRef.current = cursorId;
    // the Events rail is hidden in Office until the office menu (or the footer's event line) shows it
    const eventsOpen = useAtomValue(officeEventsOpenAtom);
    const railEvents = useRailEvents(lineage, runEvents);
    const setOfficeEvents = (open: boolean) => {
        if (open) {
            globalStore.set(model.railOpenAtom, true);
        }
        globalStore.set(officeEventsOpenAtom, open);
    };

    const officeKeys = useMemo<OfficeKeys>(
        () => ({
            layer: () => officeRef.current?.layer() ?? "walk",
            menuOpen: () => officeRef.current?.menuOpen() ?? false,
            walk: (d) => officeRef.current?.walk(d),
            talk: () => officeRef.current?.talk() ?? false,
            card: () => officeRef.current?.card() ?? false,
            move: (d) => officeRef.current?.move(d),
            activate: () => officeRef.current?.activate(),
            back: () => {
                // walking already: Esc hides the Events rail the menu showed
                if (!officeRef.current?.back() && globalStore.get(officeEventsOpenAtom)) {
                    globalStore.set(officeEventsOpenAtom, false);
                }
            },
            toggleMenu: () => officeRef.current?.toggleMenu(),
            desk: (d) => {
                const next = moveCursor(officeRef.current?.order() ?? [], cursorIdRef.current, d);
                if (next) {
                    setCursorId(next);
                    officeRef.current?.goTo(next);
                }
            },
            nextAsk: () => {
                const target = nextAskId(officeRef.current?.asks() ?? [], lastJumpRef.current);
                if (target) {
                    lastJumpRef.current = target;
                    setCursorId(target);
                    officeRef.current?.showPath(target);
                }
            },
            pageBoard: (d) => officeRef.current?.pageBoard(d),
            // PageUp / PageDown: the next floor that holds a room, up or down; at either end nothing. With a room
            // carried it rides with the room, and past the top the room's target is a new floor
            floor: (d) => {
                const o = officeRef.current;
                if (o?.layer() === "carry") {
                    o.carryFloor(d);
                    return;
                }
                const floors = o?.floors() ?? [];
                const to = floors[floors.findIndex((f) => f.floor === o?.floor()) + d];
                if (o && to) {
                    o.ride(to.floor);
                }
            },
            grab: () => {
                officeRef.current?.grab();
            },
            slot: (d) => officeRef.current?.slot(d),
            drop: () => officeRef.current?.drop(),
            cancel: () => officeRef.current?.cancel(),
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

    const onOfficeMenu = (id: OfficeMenuId) => {
        switch (id) {
            case "nextAsk":
                officeKeys.nextAsk();
                return;
            case "needsYou":
                officeRef.current?.openBoard();
                return;
            case "lift":
                officeRef.current?.openLift();
                return;
            case "move":
                // as g: the room the boss stands in (the item is disabled anywhere else)
                officeRef.current?.grab();
                return;
            case "arrange":
                // the next build of the floor arranges the rooms by name again, Home first, and saves it
                globalStore.set(officeLayoutAtom, EMPTY_LAYOUT);
                return;
            case "nextDesk":
                officeKeys.desk(1);
                return;
            case "prevDesk":
                officeKeys.desk(-1);
                return;
            case "events":
                setOfficeEvents(!globalStore.get(officeEventsOpenAtom));
                return;
            case "background":
                globalStore.set(officeBackgroundOpenAtom, !globalStore.get(officeBackgroundOpenAtom));
                return;
            case "sound":
                toggleOfficeMute();
                return;
            case "cards":
                toggleView();
                return;
            case "keys":
                globalStore.set(cheatsheetOpenAtom, true);
                return;
        }
    };

    // what a ▶ item does for an agent: the same calls the card's buttons and the Cockpit's keys make. openId is the tab
    // a worker's row opens, the agent's own id otherwise
    const runAgentItem = (a: AgentVM, id: DialogItemId, qi: number, openId = a.id) => {
        if (id.startsWith("opt:")) {
            toggleAnswer(a.id, qi, Number(id.slice(4)));
            return;
        }
        switch (id) {
            case "send":
                submitAnswer(a.id);
                return;
            case "open":
                officeRef.current?.card();
                return;
            case "terminal":
                openFocus(openId, false);
                return;
            case "reply":
                setOpenComposerId(a.id);
                officeRef.current?.card();
                requestAnimationFrame(() => focusRowComposer(a.id));
                return;
            case "diff":
                openDiff(a.id);
                return;
            case "background":
                toggleBackground(a.id);
                return;
        }
    };

    const agentInput = (a: AgentVM): Pick<DialogInput, "activeQuestion" | "selections" | "texts"> => ({
        activeQuestion: answerTab[a.id] ?? 0,
        selections: answerSel[a.id] ?? {},
        texts: answerText[a.id] ?? {},
    });

    const agentDialog = (a: AgentVM): OfficeDialogVM => {
        const input = { kind: "agent" as DeskKind, agent: a, hasDiff: diffStats[a.id] != null, ...agentInput(a) };
        return {
            kind: "agent",
            label: a.name,
            items: dialogItems(input),
            tabs: questionTabs(a, input.activeQuestion),
            plate: <AgentPlate agent={a} nowAtom={model.nowAtom} />,
            body: <AgentDialogBody agent={a} nowAtom={model.nowAtom} activeQuestion={input.activeQuestion} />,
            run: (id) => runAgentItem(a, id, input.activeQuestion),
        };
    };

    // what a ▶ item does on the notice board: boardCall says which of the strip's handlers (useNeedsYou) it runs; the
    // empty board has no row, and its OK goes back to walking
    const runBoardItem = (row: StripRow | undefined, id: DialogItemId) => {
        const call = boardCall(row, id);
        if (!call) {
            return;
        }
        if (call.kind === "close") {
            officeRef.current?.back();
            return;
        }
        if (!row) {
            return;
        }
        switch (call.kind) {
            case "act":
                ny.act(row, call.act);
                return;
            case "open":
                ny.open(row);
                return;
            case "learn":
                fireAndForget(() => ny.decideLearn(row, call.accept));
                return;
            case "why":
                globalStore.set(officeBoardWhyAtom, !globalStore.get(officeBoardWhyAtom));
                return;
        }
    };

    // the notice board's box: the page in view of the Needs you rows, or with none a page that says so
    const boardDialog = (): OfficeDialogVM => {
        const page = boardPage(boardPageAt, ny.rows.length);
        if (page < 0) {
            return {
                kind: "board",
                label: "Notice board",
                items: boardEmptyItems(),
                plate: <BoardPlate count={0} />,
                body: <BoardEmptyBody />,
                run: (id) => runBoardItem(undefined, id),
            };
        }
        const row = ny.rows[page];
        const words = boardWords(row, boardWhyOpen);
        return {
            kind: "board",
            label: "Notice board",
            items: boardItems(row, boardWhyOpen, ny.busy.has(row.key)),
            tabs: boardTabs(ny.rows, page),
            plate: <BoardPlate count={ny.rows.length} />,
            body: <BoardDialogBody words={words} row={row} now={ny.now} />,
            run: (id) => runBoardItem(row, id),
        };
    };

    // the lift's panel: a round button per floor, ↵ rides to the one the ▶ is on
    const liftPanel = (): OfficeDialogVM | null => {
        const o = officeRef.current;
        if (!o) {
            return null;
        }
        const d = liftDialog(o.floors(), o.floor());
        return {
            kind: d.kind,
            label: d.title,
            items: d.items,
            plate: null,
            body: null,
            run: (id) => {
                if (id.startsWith("floor:")) {
                    o.ride(Number(id.slice("floor:".length)));
                }
            },
        };
    };

    // a room's chip: the agents and runs that did not fit it, ↵ on one opens its card beside the chip
    const chipPanel = (key: string): OfficeDialogVM | null => {
        const o = officeRef.current;
        const chip = o?.chipOf(key);
        if (!o || !chip) {
            return null;
        }
        const d = chipDialog(chip.room, chip.agents, chip.runs);
        return {
            kind: d.kind,
            label: d.title,
            items: d.items,
            plate: <ChipPlate title={d.title} ask={chip.room.chip?.ask ?? false} />,
            body: <ChipBody text={chip.room.chip?.text ?? ""} />,
            run: (id) => {
                if (id.startsWith("hidden:")) {
                    o.openChipCard(id.slice("hidden:".length));
                }
            },
        };
    };

    // the dialog box of the desk at the boss (office controls canvas): the same card lookup as renderOfficeCard
    const dialogFor = (key: string): OfficeDialogVM | null => {
        if (key === BOARD_KEY) {
            return boardDialog();
        }
        if (key === LIFT_KEY) {
            return liftPanel();
        }
        if (key.startsWith("chip:")) {
            return chipPanel(key);
        }
        const c = cards.find((x) =>
            x.kind === "agent"
                ? x.id === key
                : x.id === key || key.startsWith(`${x.id}:`) || rowsOf(x).some((r) => r.key === key)
        );
        if (!c) {
            const parked = shownParkedIdle.find((a) => a.id === key);
            return parked ? agentDialog(parked) : null;
        }
        if (c.kind === "agent") {
            return agentDialog(c.agent);
        }
        const vm = leadVMs.get(c.id);
        if (!vm) {
            return null;
        }
        const adjustable = runAdjustable(c.run);
        const row = rowsOf(c).find((r) => r.key === key);
        if (row || key !== c.id) {
            // a worker's seat: its task row (a seat the card shows no row for has only Open, the full card)
            const worker = row?.worker;
            const actions = row ? rowKeyActions(row) : [];
            const input = worker ? agentInput(worker) : { activeQuestion: 0, selections: {}, texts: {} };
            return {
                kind: "worker",
                label: row?.label ?? c.run.title,
                items: dialogItems({
                    kind: "worker",
                    agent: worker,
                    rowActions: actions,
                    canOpen: !!row?.openId,
                    ...input,
                }),
                tabs: worker ? questionTabs(worker, input.activeQuestion) : undefined,
                plate: worker ? (
                    <AgentPlate agent={worker} nowAtom={model.nowAtom} />
                ) : (
                    <RunPlate run={c.run} lead={c.lead} />
                ),
                body: row ? (
                    <WorkerDialogBody
                        row={row}
                        worker={worker}
                        nowAtom={model.nowAtom}
                        activeQuestion={input.activeQuestion}
                    />
                ) : null,
                run: (id) => {
                    // a row action's index is its number key's (the box leaves Tell to the card's input)
                    if (id.startsWith("row:")) {
                        rowTargets[row!.key]?.actions[Number(id.slice(4))]?.();
                        return;
                    }
                    if (worker) {
                        runAgentItem(worker, id, input.activeQuestion, row?.openId ?? worker.id);
                    } else if (id === "open") {
                        officeRef.current?.card();
                    }
                },
            };
        }
        const lead = c.lead;
        const input = lead ? agentInput(lead) : { activeQuestion: 0, selections: {}, texts: {} };
        return {
            kind: lead ? "lead" : "leadless",
            label: c.run.title,
            items: dialogItems({ kind: lead ? "lead" : "leadless", agent: lead, adjustable, ...input }),
            tabs: lead ? questionTabs(lead, input.activeQuestion) : undefined,
            plate: <RunPlate run={c.run} lead={lead} />,
            body: <RunDialogBody vm={vm} lead={lead} activeQuestion={input.activeQuestion} />,
            run: (id) => {
                if (id === "adjust") {
                    officeRef.current?.card({ adjust: true });
                } else if (lead) {
                    runAgentItem(lead, id, input.activeQuestion);
                } else if (id === "open") {
                    officeRef.current?.card();
                }
            },
        };
    };

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

    const renderCard = (c: GridCard, share = cardShare(c.kind === "run", cardNeedsYou(c)), adjust?: boolean) => {
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
                initialPanel={adjust ? "adjust" : undefined}
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

    // the full card of the desk the boss stands at: an agent's AgentRow, or for a seat or a meeting room its run's
    // LeadCard, the very ones the grid draws; an agent of the Idle section gets its row too. The office's panel sets
    // its height (cockpitoffice.tsx OfficeCardPanel), so it has no floor of its own.
    const renderOfficeCard = (key: string, opts?: { adjust?: boolean }): ReactNode => {
        const c = cards.find((x) =>
            x.kind === "agent"
                ? x.id === key
                : x.id === key || key.startsWith(`${x.id}:`) || rowsOf(x).some((r) => r.key === key)
        );
        if (c) {
            return renderCard(c, POPUP_SHARE, opts?.adjust);
        }
        const parked = shownParkedIdle.find((a) => a.id === key);
        return parked ? renderAgent(parked, POPUP_SHARE) : null;
    };

    const chipDefs: [ChipFilter, string, number][] = [
        ["asking", "need you", liveAsking],
        ["working", "working", liveWorking],
        ["idle", "ready for review", readyCount],
        ["all", "live", liveCount],
    ];
    // the Cards | Office toggle, the project switcher and Live only: the Cards header's right end, and the HUD bar's
    const viewControls = (
        <>
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
        </>
    );

    // the HUD bar inside the office's view: the same filters and switches as the Cards header, as compact pills. Its
    // "need you" counts all that waits on you, the asking agents and the notice board's rows, though its filter still
    // shows the asking desks
    const officeChips = chipDefs.map(([key, label, count]): [ChipFilter, string, number] => [
        key,
        label,
        key === "asking" ? count + ny.rows.length : count,
    ]);
    const officeHud = (
        <>
            <span className="h-4 w-px shrink-0 bg-edge-mid" />
            <div role="group" aria-label="Show" className="flex min-w-0 items-center gap-0.5">
                {officeChips.map(([key, label, count]) => (
                    <button
                        key={key}
                        type="button"
                        data-office-chip={key}
                        aria-pressed={chip === key}
                        onClick={() => setChip(toggleChip(chip, key))}
                        className={cn(
                            "flex shrink-0 cursor-pointer items-baseline gap-1.5 rounded-[5px] border-0 px-2 py-[3px] hover:bg-surface-hover",
                            chip === key ? "bg-surface-selected" : "bg-transparent"
                        )}
                    >
                        <RollingCount
                            value={count}
                            className={cn(
                                "text-[13.5px] font-semibold",
                                count > 0 || chip === key ? TAB_TONE[key].text : "text-muted"
                            )}
                        />
                        <span className={cn("text-[12px] font-medium", chip === key ? "text-primary" : "text-ink-mid")}>
                            {label}
                        </span>
                    </button>
                ))}
            </div>
            <div className="ml-auto flex flex-none items-center gap-2">{viewControls}</div>
        </>
    );

    const phase = rosterLoadPhase(seeded, [...asking, ...working, ...idle].filter((a) => !hidden.has(a.id)).length);
    const overlay = rosterOverlay(view, phase);

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
                {/* one row: the tabs carry the counts a subtitle used to repeat; Office has them in its HUD bar */}
                {view !== "office" ? (
                    <div className="sticky top-0 z-[5] shrink-0 bg-background">
                        <div className="flex flex-wrap items-end gap-x-5 gap-y-1 border-b border-border px-5 pt-2.5">
                            <h1 className={cn(SURFACE_TITLE_CLASS, "pb-2.5 leading-none")}>Cockpit</h1>
                            <div className="-mb-px flex flex-wrap gap-0.5">
                                {chipDefs.map(([key, label, count]) => (
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
                            <div className="mb-1.5 ml-auto flex flex-none items-center gap-2">{viewControls}</div>
                        </div>
                    </div>
                ) : null}

                {/* Office has Needs you as the notice board in its hall (boardDialog above) */}
                {view !== "office" ? <NeedsYouStrip model={model} onFocusAgent={focusAgentCard} /> : null}

                <div className="relative flex min-h-0 flex-1 flex-col">
                    <AnimatePresence initial={false}>
                        {overlay === "empty" ? (
                            <CockpitEmptyState
                                key="empty"
                                onNewAgent={() => openLauncher(model, "agent")}
                            />
                        ) : overlay === "loading" ? (
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
                                dialogFor={dialogFor}
                                hud={officeHud}
                                newEvents={railEvents.fresh.length}
                                eventsOpen={eventsOpen}
                                background={shownBackgrounded.length + shownBgSessions.length}
                                backgroundOpen={backgroundOpen}
                                onMenu={onOfficeMenu}
                                boardRows={ny.rows.length}
                                boardCues={boardCues}
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
                        {showBackground ? (
                            <BackgroundedSection agents={shownBackgrounded} onRestore={(id) => toggleBackground(id)} />
                        ) : null}
                        {view === "office" ? null : <IdleSection agents={shownParkedIdle} onOpen={(id) => model.openTerminal(id)} />}
                        {showBackground ? <BackgroundAgentsStrip model={model} /> : null}
                    </div>
                </div>

                <HintsBar
                    model={model}
                    hints={phase === "ready"}
                    office={
                        view === "office"
                            ? {
                                  event: footerEvent(railEvents.all, railEvents.fresh),
                                  onMenu: () => officeRef.current?.toggleMenu(),
                                  onEvents: () => setOfficeEvents(true),
                              }
                            : undefined
                    }
                />
            </div>

            {view !== "office" || eventsOpen ? (
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
            ) : null}
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
