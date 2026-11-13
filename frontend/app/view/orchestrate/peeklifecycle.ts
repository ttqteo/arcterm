// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Lifecycle rows a DAG node's popup shows, one flat row per event, newest first. Title, tone, detail and
// attention are the lifecycle rail's own projection, so a popup and the rail never describe one event differently,
// and the rail's filter counts (timelinegroups.eventCount) equal a task's rows here.

import { detailOf, eventTitle, eventTone, tsLabel } from "../agents/runtimeline";
import { ATTENTION_KINDS, FINAL_FAILED_BLOCK, taskIdOf } from "./timelinefilter";
import { eventDetail, snippetOf } from "./timelinegroups";

export type LifecycleRow = {
    id: string;
    time: string;
    title: string;
    // the event in words: the rail's detail text, or its one-line snippet where the detail is raw output
    detail: string;
    // a text-* tone class, as the rail's
    tone: string;
    attention: boolean;
};

// the run-level kinds the engine records for the final stage alone (pkg/orchestrate final.go, land.go)
const FINAL_STAGE_KINDS = new Set(["final-step", "final-ended", "final-rerun", "land-held", "landed"]);
const VERIFIER_ROLE = "verifier";

function rowOf(e: RunEvent): LifecycleRow {
    return {
        id: e.id,
        time: tsLabel(e.ts),
        title: eventTitle(e),
        detail: eventDetail(e).text || snippetOf(e),
        tone: eventTone(e),
        attention: ATTENTION_KINDS.has(e.kind),
    };
}

// the run's log arrives newest first; the sort is stable, so events of one millisecond keep that order
function lifecycleRows(events: RunEvent[], keep: (e: RunEvent) => boolean): LifecycleRow[] {
    return events
        .filter(keep)
        .sort((a, b) => b.ts - a.ts)
        .map(rowOf);
}

export function taskLifecycle(events: RunEvent[], taskId: string): LifecycleRow[] {
    return lifecycleRows(events, (e) => taskIdOf(e) === taskId);
}

// isFinalStageEvent: the stage's steps, its verifier's session, the dag blocking on its failure, and the land that
// follows it. The plan reviewer is a stage session too, but of the plan, not this stage.
export function isFinalStageEvent(e: RunEvent): boolean {
    if (taskIdOf(e) !== "") {
        return false;
    }
    if (FINAL_STAGE_KINDS.has(e.kind)) {
        return true;
    }
    if (e.kind === "stage-session-started") {
        return detailOf<{ role?: string }>(e)?.role === VERIFIER_ROLE;
    }
    return e.kind === "dag-blocked" && detailOf<{ kind?: string }>(e)?.kind === FINAL_FAILED_BLOCK;
}

export function finalLifecycle(events: RunEvent[]): LifecycleRow[] {
    return lifecycleRows(events, isFinalStageEvent);
}

export function eventsCountText(n: number): string {
    return n === 1 ? "1 event" : `${n} events`;
}
