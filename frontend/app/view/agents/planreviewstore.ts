// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the rail's Plan to review and the header's "N TO REVIEW" chip read: the agent's initiative from the effort
// cache, and the decisions just made on its chunks, which the section keeps for Undo (planreviewmodel.ts).

import { globalStore } from "@/app/store/jotaiStore";
import { effortDetailAtom, loadEffortDetail } from "@/app/view/jarvis/effortstore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useMemo } from "react";
import {
    addDecisions,
    planRows,
    proposedCount,
    removeDecision,
    type PlanDecision,
    type PlanRow,
} from "./planreviewmodel";

// by initiative oref
const planDecisionsAtom = atom<Record<string, PlanDecision[]>>({}) as PrimitiveAtom<Record<string, PlanDecision[]>>;

export function holdDecisions(oref: string, add: PlanDecision[]): void {
    globalStore.set(planDecisionsAtom, (prev) => ({ ...prev, [oref]: addDecisions(prev[oref] ?? [], add) }));
}

export function releaseDecision(oref: string, label: string): void {
    globalStore.set(planDecisionsAtom, (prev) => ({ ...prev, [oref]: removeDecision(prev[oref] ?? [], label) }));
}

function clearDecisions(oref: string): void {
    if ((globalStore.get(planDecisionsAtom)[oref] ?? []).length > 0) {
        globalStore.set(planDecisionsAtom, (prev) => ({ ...prev, [oref]: [] }));
    }
}

export type PlanReviewView = {
    oref: string; // "" when the agent has no initiative
    effort: Effort | undefined;
    rows: PlanRow[]; // proposed chunks, then decided ones still held for Undo
    decisions: PlanDecision[]; // what Undo needs for the decided rows
    proposed: number; // the rows still waiting for a decision
};

const NO_DECISIONS: PlanDecision[] = [];

export function usePlanReview(effortId: string | undefined): PlanReviewView {
    const oref = effortId != null ? "effort:" + effortId : "";
    const effort = useAtomValue(effortDetailAtom).get(oref);
    const decisions = useAtomValue(planDecisionsAtom)[oref] ?? NO_DECISIONS;
    return useMemo(() => {
        const rows = planRows(effort?.chunks ?? [], decisions);
        return { oref, effort, rows, decisions, proposed: proposedCount(rows) };
    }, [oref, effort, decisions]);
}

// a fetch no cached entry can be fresh against (as the peek does)
const ALWAYS_REFETCH = Number.MAX_SAFE_INTEGER;
const rereads = new Map<string, Promise<void>>();

// one read in flight per initiative, so the rail and the header asking at the same moment fetch it once
function rereadInitiative(oref: string): Promise<void> {
    let p = rereads.get(oref);
    if (p == null) {
        p = loadEffortDetail(oref, ALWAYS_REFETCH).finally(() => rereads.delete(oref));
        rereads.set(oref, p);
    }
    return p;
}

// Re-read the agent's initiative when this mounts and whenever the agent changes state: nothing pushes a change to an
// initiative, and a plan lands in it while the agent works and then stops for review. endDecisions: the read also ends
// the decided rows the section holds for Undo ("until the rail re-reads").
export function useInitiativeReread(effortId: string | undefined, state: string, endDecisions: boolean): void {
    useEffect(() => {
        if (effortId == null) {
            return;
        }
        const oref = "effort:" + effortId;
        if (endDecisions) {
            clearDecisions(oref);
        }
        rereadInitiative(oref).catch(() => {}); // the cached copy stands; the next state change reads again
    }, [effortId, state, endDecisions]);
}
