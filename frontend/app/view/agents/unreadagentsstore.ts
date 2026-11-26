// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How many turns each agent finished while you were not looking (unreadagents.ts), kept in a module-level atom so the
// nav rail's Agent badge and the sidebar's rows read one map. useUnreadTracking runs in the always-mounted shell, since a
// turn can end while any surface is showing. Not persisted: a reload starts with nothing unread. A turn that ends while
// the window is not focused stays unread, even on the agent in view. An agent in view showing its terminal is read at
// sight; one showing Chat is read turn by turn as its Chat sees them (chatunread.ts), which sets its count (readTurns).

import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useRef } from "react";
import { centerModeAtom } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { AgentState } from "./agentsviewmodel";
import { showsChat } from "./chatmode";
import { chatModesAtom } from "./chatmodestore";
import { agentGridAtom } from "./gridstore";
import { nestedIds, nextUnread, sameCounts, seenAtSight, viewingIds } from "./unreadagents";

export const unreadAgentsAtom = atom<ReadonlyMap<string, number>>(new Map<string, number>()) as PrimitiveAtom<
    ReadonlyMap<string, number>
>;

export function useUnreadTracking(model: AgentsViewModel): void {
    const agents = useAtomValue(model.agentsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const center = useAtomValue(centerModeAtom);
    const grid = useAtomValue(agentGridAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const focused = useAtomValue(atoms.documentHasFocus);
    const modes = useAtomValue(chatModesAtom);
    const prevStates = useRef<ReadonlyMap<string, AgentState>>(new Map());
    useEffect(() => {
        const prev = globalStore.get(unreadAgentsAtom);
        const chatShown = new Set(agents.filter((a) => showsChat(a, modes[a.id])).map((a) => a.id));
        const next = nextUnread(
            prev,
            prevStates.current,
            agents,
            seenAtSight(viewingIds(focused, surface === "agent", center, focusId, grid), chatShown),
            nestedIds(lineage, agents)
        );
        prevStates.current = new Map(agents.map((a) => [a.id, a.state]));
        if (!sameCounts(prev, next)) {
            globalStore.set(unreadAgentsAtom, next);
        }
    }, [agents, focusId, surface, center, grid, lineage, focused, modes]);
}

/** Sets an agent's count as its Chat read some of its turns (chatunread.ts); 0 drops it from the map. */
export function readTurns(agentId: string, count: number): void {
    const prev = globalStore.get(unreadAgentsAtom);
    if ((prev.get(agentId) ?? 0) === count) {
        return;
    }
    const next = new Map(prev);
    if (count > 0) {
        next.set(agentId, count);
    } else {
        next.delete(agentId);
    }
    globalStore.set(unreadAgentsAtom, next);
}

/** Whether the agent is on screen (viewingIds, whatever the window's focus), and whether what is on screen is read now
 *  (the window has the focus). Read at render, from the atoms useUnreadTracking reads, so a cell that mounts as its
 *  agent comes into view sees itself on screen in its first render. */
export function useAgentOnScreen(model: AgentsViewModel, agentId: string): { shown: boolean; focused: boolean } {
    const focusId = useAtomValue(model.focusIdAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const center = useAtomValue(centerModeAtom);
    const grid = useAtomValue(agentGridAtom);
    const focused = useAtomValue(atoms.documentHasFocus);
    return { shown: viewingIds(true, surface === "agent", center, focusId, grid).has(agentId), focused };
}
