// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The 2-hour timeline Sidecar draws under the orbit (spec 2026-11-17-sidecar-orbit-dashboard-design.md, "The
// timeline's data"). Nothing keeps a plain agent's past states, so the bridge, always mounted in the shell, records each
// agent's state changes here. Pure: the bridge holds the Timeline and passes each build's sightings in.

import type { RailEvent } from "@/app/view/agents/cockpitevents";
import type { SidecarSpan, SidecarSpanState, SidecarTileState } from "./sidecartypes";

export const TIMELINE_WINDOW_MS = 2 * 60 * 60 * 1000;
export const MAX_SPANS = 64;

export type Timeline = Readonly<Record<string, readonly SidecarSpan[]>>;
export interface Sighting {
    id: string;
    state: SidecarTileState;
    since?: number;
    failed?: boolean;
    /** When the state changed, if the caller knows it earlier than this sighting (UnixMilli); default: now. */
    at?: number;
}

export function spanStateOf(s: Pick<Sighting, "state" | "failed">): SidecarSpanState | null {
    if (s.failed) return "failed";
    switch (s.state) {
        case "working":
        case "asking":
            return s.state;
        case "review":
        case "idle":
            return "finished";
        default:
            return null; // asleep: no lane
    }
}

function prune(spans: SidecarSpan[], now: number): SidecarSpan[] {
    const edge = now - TIMELINE_WINDOW_MS;
    return spans.filter((s) => s.to == null || s.to >= edge).slice(-MAX_SPANS);
}

/** The time a transition happens: `at`, else now; never after now, never before the span it follows began or ended. */
function transitionAt(at: number | undefined, now: number, floor: number): number {
    return Math.max(floor, Math.min(at ?? now, now));
}

export function recordTimeline(t: Timeline, seen: readonly Sighting[], now: number): Timeline {
    let changed = false;
    const next: Record<string, readonly SidecarSpan[]> = {};
    for (const s of seen) {
        const state = spanStateOf(s);
        const had = t[s.id];
        if (had == null) {
            changed = true;
            next[s.id] = state == null ? [] : [{ state, from: s.since ?? now }];
            continue;
        }
        const last = had.length > 0 ? had[had.length - 1] : null;
        const open = last != null && last.to == null ? last : null;
        if (open?.state === state || (open == null && state == null)) {
            const kept = prune([...had], now);
            if (kept.length !== had.length) changed = true;
            next[s.id] = kept.length !== had.length ? kept : had;
            continue;
        }
        changed = true;
        const edge = transitionAt(s.at, now, open?.from ?? last?.to ?? -Infinity);
        const spans = had.map((x) => (x === open ? { ...x, to: edge } : x));
        if (state != null) spans.push({ state, from: edge });
        next[s.id] = prune(spans, now);
    }
    // an agent missing from `seen` is dropped: that alone is a change
    if (Object.keys(next).length !== Object.keys(t).length) changed = true;
    return changed ? next : t;
}

/** When a run's engine events first say it failed, or null. */
export function failedFrom(events: readonly RailEvent[]): number | null {
    const f = events.filter((e) => e.kind === "failed").map((e) => e.ts);
    return f.length > 0 ? Math.min(...f) : null;
}
