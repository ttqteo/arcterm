// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How many turns each agent finished while you were not looking (unreadagents.ts), kept in a module-level atom so the
// nav rail's Agent badge and the sidebar's rows read one map. useUnreadTracking runs in the always-mounted shell, since a
// turn can end while any surface is showing. Not persisted: a reload starts with nothing unread. A turn that ends while
// the window is not focused stays unread, even on the agent in view.

import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useRef } from "react";
import { centerModeAtom } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { AgentState } from "./agentsviewmodel";
import { agentGridAtom } from "./gridstore";
import { nestedIds, nextUnread, sameCounts, viewingIds } from "./unreadagents";

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
    const prevStates = useRef<ReadonlyMap<string, AgentState>>(new Map());
    useEffect(() => {
        const prev = globalStore.get(unreadAgentsAtom);
        const next = nextUnread(
            prev,
            prevStates.current,
            agents,
            viewingIds(focused, surface === "agent", center, focusId, grid),
            nestedIds(lineage.roles)
        );
        prevStates.current = new Map(agents.map((a) => [a.id, a.state]));
        if (!sameCounts(prev, next)) {
            globalStore.set(unreadAgentsAtom, next);
        }
    }, [agents, focusId, surface, center, grid, lineage, focused]);
}
