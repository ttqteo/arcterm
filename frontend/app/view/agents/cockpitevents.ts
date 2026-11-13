// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's Events rail: what changed state, never what an agent said. A run's events are the engine's
// persisted ones; a plain agent has no history anywhere, so its transitions are observed here and are lost on
// reload (effort 9868f8d2, decided frontend-only). Pure.

import { FINAL_FAILED_BLOCK } from "../orchestrate/timelinefilter";
import type { AgentState, AgentVM } from "./agentsviewmodel";
import type { RunInfo } from "./runlineage";
import { detailOf, eventText, finalEndedWords } from "./runtimeline";

export type RailKind = "asked" | "answered" | "finished" | "quiet" | "failed" | "told" | "acted" | "landed";

export interface RailEvent {
    key: string;
    focusId?: string;
    who: string;
    kind: RailKind;
    text: string;
    ts: number;
    // the run an engine event belongs to; a run's events fold under its newest one
    group?: string;
}

export type RailRow = RailEvent & { more?: string };

export interface AgentSnap {
    state: AgentState;
}

export const RAIL_MAX = 50;

/** Pure: the rail events between the last snapshot and now, and the next snapshot. A first sighting records
 *  nothing, so a reload never floods the rail with every agent's current state. */
export function agentTransitions(
    prev: Record<string, AgentSnap>,
    agents: AgentVM[],
    now: number
): { events: RailEvent[]; next: Record<string, AgentSnap> } {
    const events: RailEvent[] = [];
    const next: Record<string, AgentSnap> = {};
    for (const a of agents) {
        next[a.id] = { state: a.state };
        const was = prev[a.id]?.state;
        if (was == null || was === a.state) {
            continue;
        }
        const push = (kind: RailKind, text: string, ts: number) =>
            events.push({ key: `${a.id}:${kind}:${ts}`, focusId: a.id, who: a.name, kind, text, ts });
        if (a.state === "asking") {
            push("asked", a.ask?.questions?.[0]?.question ?? "", now - (a.blockedMs ?? 0));
        } else if (was === "asking") {
            push("answered", "", now);
        } else if (a.state === "idle") {
            push("finished", a.activity || a.task, a.idleSince ?? now);
        }
    }
    return { events, next };
}

const RUN_KIND: Record<string, RailKind> = {
    "child-ask": "asked",
    "child-answered": "answered",
    // a finished task lands only at its merge, which a held merge can put off indefinitely
    "task-done": "finished",
    "task-merged": "landed",
    "task-failed": "failed",
    "task-verify-failed": "failed",
    "lead-wake-failed": "failed",
    "engine-stuck": "failed",
    "task-stalled": "quiet",
    "task-told": "told",
    "dag-done": "finished",
    "dag-cancelled": "finished",
};

const FINAL_FAILED = "failed";

/** Pure: the kinds whose rail row depends on their detail rather than on the kind alone, or undefined for any other
 *  kind (RUN_KIND decides it). A final stage's end says how the stage itself ended, whatever decided it (the
 *  steps, the verifier's verdict or a human), and an outcome it does not know stays off the rail. A failure
 *  forwarded to the human reads asked. The human's own retry, skip, escalate, take-over and final rerun read acted,
 *  while the lead's actions and the engine's retries stay off the rail, as does every dag-blocked but the final
 *  stage's (the others are a task's failure, already there as that task's own event). */
function detailRailKind(e: RunEvent): { kind: RailKind; text: string } | null | undefined {
    const d = detailOf<{ by?: string; kind?: string; outcome?: string }>(e);
    switch (e.kind) {
        case "final-ended": {
            const words = finalEndedWords(e);
            return words == null ? null : { kind: d?.outcome === FINAL_FAILED ? "failed" : "finished", text: words };
        }
        case "dag-blocked":
            return d?.kind === FINAL_FAILED_BLOCK ? { kind: "failed", text: "final stage failed" } : null;
        case "task-forwarded":
            return { kind: d?.by === "human" ? "acted" : "asked", text: eventText(e) };
        case "task-retried":
        case "task-skipped":
        case "task-escalated":
            return d?.by === "human" ? { kind: "acted", text: eventText(e) } : null;
        case "final-rerun":
            return { kind: "acted", text: eventText(e) };
        default:
            return undefined;
    }
}

/** Pure: a run's engine events as rail events. A failed review counts once, when its rounds are spent. */
export function runRailEvents(run: RunInfo, events: RunEvent[], leadId?: string): RailEvent[] {
    const out: RailEvent[] = [];
    for (const e of events) {
        const byDetail = detailRailKind(e);
        if (byDetail === null) {
            continue;
        }
        let kind = byDetail?.kind ?? RUN_KIND[e.kind];
        if (e.kind === "task-review-failed" && detailOf<{ final?: boolean }>(e)?.final) {
            kind = "failed";
        }
        if (kind == null) {
            continue;
        }
        out.push({
            key: `${run.runId}:${e.id}`,
            focusId: leadId,
            who: run.title,
            kind,
            text: byDetail?.text ?? eventText(e),
            ts: e.ts,
            group: run.runId,
        });
    }
    return out;
}

/** Pure: newest first, one per key, at most `max`. */
export function mergeRailEvents(lists: RailEvent[][], max = RAIL_MAX): RailEvent[] {
    const seen = new Set<string>();
    return lists
        .flat()
        .sort((x, y) => y.ts - x.ts)
        .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
        .slice(0, max);
}

/** Pure: events after the last "mark all read" are new. */
export function splitUnread(events: RailEvent[], seenTs: number): { fresh: RailEvent[]; old: RailEvent[] } {
    return { fresh: events.filter((e) => e.ts > seenTs), old: events.filter((e) => e.ts <= seenTs) };
}

/** Pure: the rows a list shows. A run with several events shows its newest, which counts the rest, until it is
 *  opened; plain agents' events always show. */
export function groupRailEvents(events: RailEvent[], open: Record<string, boolean>): RailRow[] {
    const count: Record<string, number> = {};
    for (const e of events) {
        if (e.group != null) {
            count[e.group] = (count[e.group] ?? 0) + 1;
        }
    }
    const seen = new Set<string>();
    const out: RailRow[] = [];
    for (const e of events) {
        const g = e.group;
        if (g == null || count[g] < 2) {
            out.push(e);
        } else if (!seen.has(g)) {
            seen.add(g);
            out.push({ ...e, more: open[g] ? `show less from ${e.who}` : `+${count[g] - 1} more from ${e.who}` });
        } else if (open[g]) {
            out.push(e);
        }
    }
    return out;
}

export interface FooterEvent {
    event: RailEvent;
    moreNew: number;
}

/** Pure: the Office footer's line: the newest event, and how many more came since the rail was last read. */
export function footerEvent(all: RailEvent[], fresh: RailEvent[]): FooterEvent | null {
    if (all.length === 0) {
        return null;
    }
    return { event: all[0], moreNew: Math.max(0, fresh.length - (fresh.includes(all[0]) ? 1 : 0)) };
}
