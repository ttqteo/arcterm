// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { sentAskIdsAtom } from "./agentaskstore";
import { showTerminal } from "./agentcenter";
import {
    cycleId,
    groupAgents,
    mergePendingLaunches,
    nextAskId,
    toggleSelection,
    type AgentVM,
    type PendingLaunch,
} from "./agentsviewmodel";
import { answerAgentAsk } from "./askanswer";
import { CockpitSurface } from "./cockpitsurface";
import { devRosterAtom, loadDevMockRoster } from "./devmock";
import { diffScopeAtom } from "./diffscopeatom";
import type { SessionStatusFilter } from "./sessionsarchivestore";
import { liveAgentsAtom, liveTerminalsAtom } from "./liveagents";
import type { Lineage } from "./runlineage";
import { endedWorkerAtomFor, lineageAtomFor, type EndedWorker } from "./runlineagestore";
import { usageBucketsAtom } from "./usagestore";
import { aggregateBuckets, type HarnessFilter } from "./usagestats";

export type SurfaceKey = "cockpit" | "jarvis" | "agent" | "radar" | "files" | "usage" | "code" | "setup" | "settings";

// Ordered to match the NavRail (navrail.tsx: CORE_ITEMS, then TOOL_ITEMS) so Ctrl+1..7 line up with what the user
// sees: the surfaces used all day first, then the tools. All 7 entries are chorded. Conversation History is not a
// surface: it is a centre mode of "agent" (agentcenter.ts).
export const SURFACE_ORDER: SurfaceKey[] = ["cockpit", "jarvis", "agent", "usage", "code", "files", "radar"];

export type ChipFilter = "all" | "asking" | "working" | "idle";

export class AgentsViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon = atom<string>("robot");
    viewName = atom<string>("Agents");
    noPadding = atom(true);
    agentsAtom: Atom<AgentVM[]>; // base roster overlaid with pending launches
    lineageAtom: Atom<Lineage>; // which agents lead an orchestrator run and which work its tasks
    endedWorkerAtom: Atom<EndedWorker | undefined>; // the done task's worker in focus, read from its transcript
    baseRosterAtom: Atom<AgentVM[]>; // un-overlaid roster (dev mock or live) — read by the prune effect
    // Background terminals launched via New Agent: kept separate from the agent roster (listed in the details
    // rail's Terminals section, with their own focus pane). Always live (reads the workspace session sidebar),
    // independent of the dev mock roster.
    terminalsAtom: Atom<AgentVM[]> = liveTerminalsAtom;
    pendingLaunchesAtom = atom<PendingLaunch[]>([]) as PrimitiveAtom<PendingLaunch[]>;

    // orchestration state lifted off the surface's useStates (spec §4); surfaces read/write via globalStore
    surfaceAtom = atom<SurfaceKey>("cockpit");
    nowAtom = atom(Date.now());
    // coarse (~15s) structural clock: CockpitSurface subscribes to this REACTIVELY for idle-grace
    // partition / transcript-stream teardown / usage-window rollover, so those survive a quiescent
    // fleet without re-subscribing the surface to the 1s nowAtom (which would re-render the whole grid).
    structuralNowAtom = atom(Date.now());
    cursorIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;
    orderAtom = atom<string[]>([]) as PrimitiveAtom<string[]>;
    backgroundedIdsAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;
    dismissedAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;
    answerSelAtom = atom<Record<string, Record<number, Set<number>>>>({}) as PrimitiveAtom<
        Record<string, Record<number, Set<number>>>
    >;
    // free-text answers, keyed like answerSelAtom: agentId -> (questionIndex -> text). Mutually
    // exclusive with a selection for the same question (see setAnswerText).
    answerTextAtom = atom<Record<string, Record<number, string>>>({}) as PrimitiveAtom<
        Record<string, Record<number, string>>
    >;
    answerTabAtom = atom<Record<string, number>>({}) as PrimitiveAtom<Record<string, number>>;
    // The submit lock lives in agentaskstore with the ask events that release it (the agent's clear, or
    // the server putting an unanswered ask back); re-exported here so callers reach it through the model.
    get sentIdsAtom() {
        return sentAskIdsAtom;
    }
    focusIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;
    // The Diff surface's subject: which repository, and which range within it. One stored value
    // rather than three source variables and a ternary chain, so a control can actually set it. It
    // lives in its own module (the git stores read and write it and must not import this view model);
    // re-exported here so callers that reach it through the model keep working.
    get diffScopeAtom() {
        return diffScopeAtom;
    }
    focusReplyAtom = atom(false);
    railOpenAtom = atom(true);
    chipFilterAtom = atom<ChipFilter>("all");
    // Conversation History: status filter chip (All / Live / Needs you / Done). Default "all".
    sessionsStatusFilterAtom = atom<SessionStatusFilter>("all");
    // Conversation History: selected left-list entry. "all" = merged feed; "run:<id>" = an orchestrator run;
    // else "${runtime}:${id}".
    sessionsSelAtom = atom<string>("all");
    // Conversation History: the member of the selected run in view, "lead" or a task id.
    sessionsMemberAtom = atom<string>("lead");
    // Conversation History: a session reads as its transcript or its short list of lifecycle events.
    sessionsViewAtom = atom<"transcript" | "activity">("transcript");
    // Usage surface: harness filter chip (All / Claude Code / Codex / OpenCode). Lives here rather
    // than surface-local state so it survives the surface unmounting on nav-rail switch.
    usageHarnessFilterAtom = atom<HarnessFilter>("all");
    // Usage surface: the harness-filtered derivation over the store's raw buckets. Reads
    // Date.now() at compute time, so it stays fresh when any bucket/filter dependency changes.
    usageStatsAtom = atom((get) => aggregateBuckets(get(usageBucketsAtom), Date.now(), get(this.usageHarnessFilterAtom)));

    // New Project / New Agent / New run modal + command-palette visibility (gated overlays rendered from the cockpit root).
    newProjectOpenAtom = atom(false);
    newAgentOpenAtom = atom(false);
    newRunOpenAtom = atom(false);
    newInitiativeOpenAtom = atom(false);
    paletteOpenAtom = atom(false);

    // handoff-parity filters + per-card layout (spec §State). Project scope is a single source bound to
    // both the app-bar switcher and the header button.
    // "all" | <projectName>. Persisted, so a restart reopens on the project you left; getOnInit so the first
    // render already reads it (a late value would paint and load the "all" scope first). Removing the
    // project resets it to "all" (projectsstore.ts removeProject).
    projectFilterAtom = atomWithStorage<string>("agent.projectFilter", "all", undefined, {
        getOnInit: true,
    }) as PrimitiveAtom<string>;
    liveOnlyAtom = atom(false);
    // which card's composer is expanded (one at a time); asking cards are always expanded regardless
    openComposerIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;

    constructor({ blockId, nodeModel, tabModel }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "agents";
        // DEV-only: runtime mock roster from public/cockpit-fixtures/active.json (see
        // devmock.ts + scripts/gen-cockpit-fixtures.mjs). import.meta.env.DEV is build-time -> prod uses live.
        if (import.meta.env.DEV) {
            void loadDevMockRoster();
            this.baseRosterAtom = devRosterAtom;
        } else {
            this.baseRosterAtom = liveAgentsAtom;
        }
        const base = this.baseRosterAtom;
        const pendingAtom = this.pendingLaunchesAtom;
        // Booting launches overlay the roster until the reporter registers them (supersede by tabId).
        this.agentsAtom = atom((get) => mergePendingLaunches(get(base), get(pendingAtom), Date.now()));
        this.lineageAtom = lineageAtomFor(this.agentsAtom);
        this.endedWorkerAtom = endedWorkerAtomFor(this.focusIdAtom, this.lineageAtom);
    }

    // openTerminal routes to the Agent surface (spec §6): focus the agent and switch surface. The Agent surface
    // renders the focused agent's live terminal; the controller starts on render.
    openTerminal(agentId: string) {
        globalStore.set(this.focusIdAtom, agentId);
        globalStore.set(this.surfaceAtom, "agent");
        showTerminal();
    }

    // Cycle the focused agent (Ctrl+Tab). askingOnly restricts to asking agents (Ctrl+Shift+Tab).
    cycleFocus(askingOnly: boolean) {
        const agents = globalStore.get(this.agentsAtom);
        const byId = new Map(agents.map((a) => [a.id, a]));
        const ordered = globalStore.get(this.orderAtom).filter((id) => byId.has(id));
        let ids = ordered.length ? ordered : agents.map((a) => a.id);
        if (askingOnly) {
            ids = ids.filter((id) => byId.get(id)?.state === "asking");
        }
        const next = cycleId(ids, globalStore.get(this.focusIdAtom), 1);
        if (next != null) {
            globalStore.set(this.focusIdAtom, next);
            showTerminal();
        }
    }

    // Shared by the cockpit grid and the Agent surface: sends the answer held in the model's answer atoms.
    submitAnswer(agentId: string) {
        const sel = globalStore.get(this.answerSelAtom)[agentId] ?? {};
        const txt = globalStore.get(this.answerTextAtom)[agentId] ?? {};
        if (!answerAgentAsk(this, agentId, sel, txt)) {
            return;
        }
        // advance triage to the next asking agent so answering keeps moving without a separate `n` press
        // (T2). The just-answered agent is still in `asking` (state flips later), so nextAskId cycles past
        // it; a lone remaining ask wraps to itself and the cursor stays put.
        const askingIds = groupAgents(globalStore.get(this.agentsAtom)).asking.map((a) => a.id);
        const next = nextAskId(askingIds, agentId);
        if (next != null) {
            globalStore.set(this.cursorIdAtom, next);
        }
    }

    // Toggle an option for one question, honoring single/multi-select, and clear that question's free
    // text (mutually exclusive). Single source of truth for the cockpit grid, Channels ask rows, and the
    // keyboard number keys so all three write selection state identically.
    toggleAnswer(agentId: string, qi: number, oi: number) {
        const agent = globalStore.get(this.agentsAtom).find((a) => a.id === agentId);
        const multi = agent?.ask?.questions?.[qi]?.multiSelect ?? false;
        const prev = globalStore.get(this.answerSelAtom);
        globalStore.set(this.answerSelAtom, { ...prev, [agentId]: toggleSelection(prev[agentId] ?? {}, qi, oi, multi) });
        this.setAnswerText(agentId, qi, ""); // selecting an option clears this question's free text (exclusive)
    }

    // Set the free text for one question. Typing (non-empty) clears any selected option for that
    // question so the answer is never ambiguous; buildAskAnswers then emits { text }. Called with ""
    // by the option-toggle sites to clear text when a selection is made (the reverse exclusion).
    setAnswerText(agentId: string, qi: number, value: string) {
        const prev = globalStore.get(this.answerTextAtom);
        const forAgent = { ...(prev[agentId] ?? {}), [qi]: value };
        globalStore.set(this.answerTextAtom, { ...prev, [agentId]: forAgent });
        if (value.trim() !== "") {
            const sel = globalStore.get(this.answerSelAtom);
            const forSel = { ...(sel[agentId] ?? {}) };
            if (forSel[qi]?.size) {
                forSel[qi] = new Set<number>();
                globalStore.set(this.answerSelAtom, { ...sel, [agentId]: forSel });
            }
        }
    }

    get viewComponent(): ViewComponent {
        return CockpitSurface;
    }
}
