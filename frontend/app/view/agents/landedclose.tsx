// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The ✓ Close a landed run offers (donesuggest.ts landedCloseSuggestion): the same green mark a committed agent's row and
// header offer, closing the sessions the run still holds (its lead, workers, reviewers) through the Close run confirm.
// Chat draws it as a button on the ✓ row its run card folds into, the Agent tree as a chip on the run's row.

import { atom, useAtomValue } from "jotai";
import { Check } from "lucide-react";
import { useMemo } from "react";
import { confirmCloseRun } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import { LANDED_TITLE, landedCloseSuggestion } from "./donesuggest";
import { runAgentsOf, type RunInfo } from "./runlineage";

// the cockpit focus ring (chatbrainstormparts FOCUS_RING), spelled here so the tree does not pull Chat in
const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The ids of the tabs a run still holds in the roster, joined into one string in an atom, so a row redraws when that
 *  set changes, not on every roster update. Empty with no run. */
export function useRunTabIds(model: AgentsViewModel | undefined, runId: string | null | undefined): string[] {
    const keyAtom = useMemo(
        () =>
            atom((get) =>
                model == null || runId == null
                    ? ""
                    : runAgentsOf(get(model.lineageAtom), get(model.agentsAtom), runId)
                          .map((a) => a.id)
                          .join(",")
            ),
        [model, runId]
    );
    const key = useAtomValue(keyAtom);
    return useMemo(() => (key === "" ? [] : key.split(",")), [key]);
}

function sessionsWord(n: number): string {
    return n === 1 ? "1 open session" : `${n} open sessions`;
}

/** ✓ Close on a landed run that still holds sessions; nothing otherwise. `variant` "button" is Chat's (the header's
 *  ✓ Close look, with how many sessions it closes), "chip" the tree row's 16px ✓. Its press never reaches the row. */
export function LandedClose({
    model,
    run,
    variant,
}: {
    model: AgentsViewModel | undefined;
    run: Pick<RunInfo, "runId" | "title" | "land"> | null | undefined;
    variant: "button" | "chip";
}) {
    const tabIds = useRunTabIds(model, run?.runId);
    if (run == null || !landedCloseSuggestion(run, tabIds.length)) {
        return null;
    }
    const title = `${LANDED_TITLE} (${sessionsWord(tabIds.length)})`;
    const onClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        confirmCloseRun(run.title || `Run ${run.runId.slice(0, 8)}`, tabIds);
    };
    if (variant === "chip") {
        return (
            <button
                type="button"
                data-run-landed-close={run.runId}
                onClick={onClick}
                title={title}
                aria-label="Close run"
                className={`flex h-[16px] w-[16px] flex-none cursor-pointer items-center justify-center rounded-[4px] text-success hover:bg-surface-hover ${FOCUS_RING}`}
            >
                <Check size={12} strokeWidth={2.4} aria-hidden />
            </button>
        );
    }
    return (
        <button
            type="button"
            data-chat-run-landed-close={run.runId}
            onClick={onClick}
            title={title}
            className={`flex flex-none cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-success/45 px-[9px] py-[3px] text-[12px] font-semibold text-success hover:border-success ${FOCUS_RING}`}
        >
            <Check size={14} strokeWidth={2.2} aria-hidden />
            Close run
            <span className="font-normal tabular-nums text-muted">· {tabIds.length} open</span>
        </button>
    );
}
