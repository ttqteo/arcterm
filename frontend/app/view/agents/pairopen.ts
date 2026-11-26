// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Going into a pair's conversation and back out, from the two places that do it: the agent header's Pair button (both
// the working agent's and a judge's) and the tree's pair row. A module of its own because it reaches both the centre
// (agentcenter.ts) and the rail (agentrailstore.ts), which agentcenter.ts cannot import without a cycle.

import { globalStore } from "@/app/store/jotaiStore";
import { centerModeAtom, pairSelAtom, showPair, showTerminal } from "./agentcenter";
import { openRailDecided } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { pairDraftAtom } from "./pairstore";

/** The words Judge again leaves in the composer: the person writes what the judge should look at after them. */
export const JUDGE_AGAIN_DRAFT = "@judge ";

/** Pure: whether the centre shows this pair's conversation. */
export function pairOnScreen(center: string, selected: string | null, pairId: string): boolean {
    return center === "pair" && selected === pairId;
}

/** Open the pair's conversation in the place of `agentId`'s view: the agent is chosen, its header stays over the
 *  conversation, and its rail turns to Decided. */
export function openPairOf(model: Pick<AgentsViewModel, "focusIdAtom">, agentId: string, pairId: string): void {
    globalStore.set(model.focusIdAtom, agentId);
    showPair(pairId);
    openRailDecided(agentId);
}

/** Judge again, from a place outside the conversation (the tree's pair row, the Library page): the pair's conversation opens
 *  as openPairOf does, and its composer is left with `@judge ` to take, so the person writes what the judge should look at
 *  and sends it. The existing `@judge` path then calls the judge at once and resumes the pair; no RPC is needed. */
export function judgeAgainOf(model: Pick<AgentsViewModel, "focusIdAtom">, agentId: string, pairId: string): void {
    openPairOf(model, agentId, pairId);
    globalStore.set(pairDraftAtom(pairId), JUDGE_AGAIN_DRAFT);
}

/** The Pair button: into the conversation, or, when it already shows, back to the view the agent was on. */
export function togglePairOf(model: Pick<AgentsViewModel, "focusIdAtom">, agentId: string, pairId: string): void {
    if (pairOnScreen(globalStore.get(centerModeAtom), globalStore.get(pairSelAtom), pairId)) {
        showTerminal();
    } else {
        openPairOf(model, agentId, pairId);
    }
}
