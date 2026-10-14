// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A request, from outside the details rail, to open an agent's rail on one of its sections: the header's "N TO REVIEW"
// chip, the initiative popover's "Review on the rail". The rail (agentdetailsrail.tsx) watches its own agent's entry,
// opens that section and scrolls to it, then clears the request.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentRailSectionId } from "./agentrailsections";

// by agent id
export const railSectionRequestAtom = atom<Record<string, AgentRailSectionId>>({}) as PrimitiveAtom<
    Record<string, AgentRailSectionId>
>;

export function openRailSection(agentId: string, id: AgentRailSectionId): void {
    globalStore.set(railSectionRequestAtom, (prev) => ({ ...prev, [agentId]: id }));
}

export function clearRailSectionRequest(agentId: string): void {
    globalStore.set(railSectionRequestAtom, (prev) => {
        if (!(agentId in prev)) {
            return prev;
        }
        const { [agentId]: _gone, ...rest } = prev;
        return rest;
    });
}
