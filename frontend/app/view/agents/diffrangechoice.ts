// frontend/app/view/agents/diffrangechoice.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which range a Claude agent's Diff opens on, per agent: its own edits or everything since its session start. Module
// scope, because every surface but Agent unmounts on a switch and component state would lose the choice; the next
// agentDiffScope reads it (agentdiffnav.ts), so coming back to the Diff opens on the range the person last picked.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { RangeChoice } from "./diffscope";

export const rangeChoiceAtom = atom<Record<string, RangeChoice>>({}) as PrimitiveAtom<Record<string, RangeChoice>>;

// undefined = never chosen, which defaultRangeFor reads as the edits range
export function rangeChoiceFor(agentId: string): RangeChoice | undefined {
    return globalStore.get(rangeChoiceAtom)[agentId];
}

export function setRangeChoice(agentId: string, choice: RangeChoice): void {
    globalStore.set(rangeChoiceAtom, { ...globalStore.get(rangeChoiceAtom), [agentId]: choice });
}
