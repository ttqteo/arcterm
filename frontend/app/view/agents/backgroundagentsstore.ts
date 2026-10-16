// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Background-agents poll store. `claude agents --json` has no event stream, so this polls. On RPC
// failure the last-good list is kept (a transient websocket drop must not blank the section) and
// backgroundAgentsErrorAtom is set. loadSeq drops out-of-order responses (usagestore pattern).

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { agentFinishedFromDiff } from "@/app/view/jarvis/petjoin";
import { pushPetEvent } from "@/app/view/jarvis/petstore";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { backgroundAgentToVM, type AgentVM } from "./agentsviewmodel";
import { projectLabel } from "./projectlabel";

export const backgroundAgentsAtom = atom<BackgroundAgentData[]>([]) as PrimitiveAtom<BackgroundAgentData[]>;
export const backgroundAgentsErrorAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// the sessions the Background section shows in place of the polled list (the cockpit-office-background scenario's
// dev hook, cockpitofficedevhooks.ts); null is the polled list
export const backgroundAgentsFixtureAtom = atom<BackgroundAgentData[] | null>(null) as PrimitiveAtom<
    BackgroundAgentData[] | null
>;

let loadSeq = 0;

// ids the user dismissed via the strip's × button — a disappearance they caused must not read as a
// completion. Session-scoped: a reload forgets it, and the poll diff has nothing to prove to history.
const dismissedAgentIds = new Set<string>();

// Dismiss a background agent: delete its ~/.claude/jobs record at the source (the transcript is
// kept, so resume/attach still work). Optimistically drop it from the atom for instant feedback,
// then reconcile against a fresh listing. On failure the reload restores the true state.
export async function dismissBackgroundAgent(sessionId: string): Promise<void> {
    dismissedAgentIds.add(sessionId);
    globalStore.set(
        backgroundAgentsAtom,
        globalStore.get(backgroundAgentsAtom).filter((a) => a.sessionid !== sessionId)
    );
    try {
        await RpcApi.RemoveBackgroundAgentCommand(TabRpcClient, { sessionid: sessionId });
    } finally {
        await loadBackgroundAgents();
    }
}

export async function loadBackgroundAgents(): Promise<void> {
    const seq = ++loadSeq;
    try {
        const rtn = await RpcApi.GetBackgroundAgentsCommand(TabRpcClient, {});
        if (seq !== loadSeq) {
            return;
        }
        const prev = globalStore.get(backgroundAgentsAtom);
        globalStore.set(backgroundAgentsAtom, rtn.agents ?? []);
        globalStore.set(backgroundAgentsErrorAtom, false);
        // the one place prev and next meet; a failed load kept the last-good list and runs no diff
        for (const ev of agentFinishedFromDiff(prev, rtn.agents ?? [], dismissedAgentIds, Date.now())) {
            pushPetEvent(ev);
        }
    } catch {
        if (seq !== loadSeq) {
            return;
        }
        globalStore.set(backgroundAgentsErrorAtom, true);
    }
}

// Background entries -> AgentVMs. Only kind:"background" enters the lane (interactive sessions are
// Wave terminals or foreign shells, owned by the hook roster). Project name is resolved with the same
// projectLabel the rest of the cockpit uses, so the existing project switcher scopes these too.
export const backgroundAgentVMsAtom: Atom<AgentVM[]> = atom((get) => {
    const raw = (get(backgroundAgentsFixtureAtom) ?? get(backgroundAgentsAtom)).filter((a) => a.kind === "background");
    const config = get(atoms.fullConfigAtom);
    const now = Date.now();
    return raw.map((a) => backgroundAgentToVM(a, projectLabel(a.cwd, config?.projects ?? {}), now));
});
