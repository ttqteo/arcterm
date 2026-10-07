// frontend/app/view/agents/liveagents.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The live Agents roster: derived from sessionSidebarViewModelAtom (single source of truth for
// running sessions) + per-block agent status. previous-info + task are fetched on demand for
// asking agents only (spec §10.3). ask routing via getAgentAskAtom + withAsk (Plan 3c).

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import {
    getAgentStatusAtom,
    getAgentUsageAtom,
    seededOrefsAtom,
} from "@/app/view/agents/session-models/agentstatusstore";
import { sessionSidebarViewModelAtom } from "@/app/view/agents/session-models/sessionsidebarmodel";
import { flattenVisualOrder } from "@/app/view/agents/session-models/sessionviewmodel";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { agentVMFromInput, askingCount, deriveTerminalVMs, isAskStale, withAsk, type AgentEntry, type AgentVM } from "./agentsviewmodel";
import { getAgentAskAtom } from "./agentaskstore";
import { fetchPreviousInfo } from "./previousinfo";
import { registeredProjectFor } from "./projectlabel";
import { projectsAtom } from "./projectsstore";
import { isLayoutLoaded, isRosterSeeded, latchWhenTrue } from "./rosterseed";

interface PreviousInfoEntry {
    entries: AgentEntry[];
    title?: string;
}

// id (tabId) -> fetched previous-info + title; filled by ensurePreviousInfo for asking agents.
export const previousInfoByIdAtom = atom<Record<string, PreviousInfoEntry>>({}) as PrimitiveAtom<Record<string, PreviousInfoEntry>>;

// in-flight guard so the view effect doesn't double-fetch the same agent
const previousInfoLoading = new Set<string>();

// The roster without previous-info: every running session that has emitted an agent status,
// mapped to an AgentVM. Sessions with no agent status (plain shells, the Agents tab itself) are
// excluded. Recomputes on any sidebar/status change; age is computed at recompute time.
export const liveAgentBaseAtom: Atom<AgentVM[]> = atom((get) => {
    const vm = get(sessionSidebarViewModelAtom);
    const projects = get(projectsAtom);
    const now = Date.now();
    const agents: AgentVM[] = [];
    for (const row of flattenVisualOrder(vm)) {
        if (!row.termBlockOref) {
            continue;
        }
        const status = get(getAgentStatusAtom(row.termBlockOref));
        if (!status?.state) {
            continue; // not an agent (no status emitted) — skip
        }
        const vm = agentVMFromInput(
            {
                id: row.tabId,
                name: row.label,
                status: row.status,
                detail: row.detail,
                agent: status.agent,
                model: row.model,
                ts: status.ts,
                transcriptPath: status.transcriptpath,
                blockId: row.termBlockOref?.split(":")[1],
                // the registry at the agent's cwd is authoritative; the launch-time tag and the lossy
                // transcript-path guess (projectOf) only cover agents outside every registered project
                project: registeredProjectFor(row.cwd ?? "", projects) || row.projectLabel,
                runORef: row.runORef,
                effortORef: row.effortORef,
                sessionId: status.sessionid,
                step: status.step,
            },
            now
        );
        vm.usage = get(getAgentUsageAtom(row.termBlockOref));
        const ask = get(getAgentAskAtom(row.termBlockOref));
        const effectiveAsk = ask && !isAskStale(ask.ts, status.ts, status.state) ? ask : null;
        agents.push(withAsk(vm, effectiveAsk, now));
    }
    return agents;
});

// The plain-terminal sessions (background terminals launched via New Agent): rows that own a term
// block but never emitted an agent status. Rendered by the Agent surface separately from the roster
// (the details rail's Terminals section + focus pane), so they never pollute agentsAtom / the cockpit grid counts.
export const liveTerminalsAtom: Atom<AgentVM[]> = atom((get) => {
    const vm = get(sessionSidebarViewModelAtom);
    const projects = get(projectsAtom);
    return deriveTerminalVMs(
        flattenVisualOrder(vm),
        (oref) => !!get(getAgentStatusAtom(oref))?.state,
        (cwd) => registeredProjectFor(cwd, projects)
    );
});

// The workspace, its tabs, and their blocks have loaded, and every terminal in the sidebar has either a status
// or a settled retained read.
const rosterSeedCheckAtom: Atom<boolean> = atom((get) => {
    const ws = get(atoms.workspace);
    const tabs =
        ws == null
            ? null
            : (ws.tabids ?? []).map((tabId) => {
                  const oref = WOS.makeORef("tab", tabId);
                  return {
                      loading: get(WOS.getWaveObjectLoadingAtom(oref)),
                      blockIds: get(WOS.getWaveObjectAtom<Tab>(oref))?.blockids ?? [],
                  };
              });
    if (!isLayoutLoaded(tabs, (blockId) => get(WOS.getWaveObjectLoadingAtom(WOS.makeORef("block", blockId))))) {
        return false;
    }
    const orefs = flattenVisualOrder(get(sessionSidebarViewModelAtom))
        .map((row) => row.termBlockOref)
        .filter((oref): oref is string => !!oref);
    const settled = get(seededOrefsAtom);
    return isRosterSeeded(orefs, (oref) => get(getAgentStatusAtom(oref)) != null, settled);
});

// First load only: a terminal opened later must not put the Cockpit back behind a skeleton.
export const rosterSeededAtom = atom(false) as PrimitiveAtom<boolean>;

// Installed from CockpitShell, not from boot: the status subscription starts before the workspace loads,
// when the sidebar has no terminals yet and the check would pass vacuously.
export function setupRosterSeededLatch(): () => void {
    return latchWhenTrue(globalStore, rosterSeedCheckAtom, rosterSeededAtom);
}

// The rendered roster: base agents with fetched previous-info + task merged onto asking agents.
export const liveAgentsAtom: Atom<AgentVM[]> = atom((get) => {
    const base = get(liveAgentBaseAtom);
    const info = get(previousInfoByIdAtom);
    return base.map((a) => {
        if (a.state !== "asking") {
            return a;
        }
        const pi = info[a.id];
        if (!pi) {
            return a;
        }
        return { ...a, previousInfo: pi.entries, task: pi.title ?? a.task };
    });
});

// The sidebar badge count — derived from the base roster (no need to wait on previous-info).
export const liveAskingCountAtom: Atom<number> = atom((get) => askingCount(get(liveAgentBaseAtom)));

/** Fetch + cache previous-info (and the ai-title task) for one asking agent. Idempotent: skips if
 *  already loaded or in flight. Fetched once when the agent enters asking — the question moment;
 *  it is not refreshed while the agent stays asking (a noted 3a limitation). */
export async function ensurePreviousInfo(id: string, transcriptPath: string, agent?: string): Promise<void> {
    if (!transcriptPath || previousInfoLoading.has(id)) {
        return;
    }
    if (globalStore.get(previousInfoByIdAtom)[id]) {
        return;
    }
    previousInfoLoading.add(id);
    try {
        const result = await fetchPreviousInfo(transcriptPath, agent);
        const current = globalStore.get(previousInfoByIdAtom);
        globalStore.set(previousInfoByIdAtom, { ...current, [id]: { entries: result.entries, title: result.title } });
    } finally {
        previousInfoLoading.delete(id);
    }
}
