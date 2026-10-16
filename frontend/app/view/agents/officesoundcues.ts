// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the office's sound says (office sounds spec, "The cues", "Against noise"): cueSnapshot keeps what can sound of
// what the office draws, diffCues turns two snapshots into cues (none from the first, none for what only came into
// view), pickCue plays one of a burst and keeps the gap, soundGate says what may play. Pure.

import type { PlanAgent, PlanRun } from "./officeplanmodel";
import type { CueId } from "./officescores";

export interface BoardCue {
    key: string;
    // the attention kind (StripRow.run.wireKind)
    kind: string;
}

export interface CueSnapshot {
    agents: Set<string>;
    asking: Set<string>;
    runs: Set<string>;
    landed: Set<string>;
    leadAsking: Set<string>;
    // `${run}/${task}` to its state
    tasks: Map<string, string>;
    taskAsking: Set<string>;
    // null until the Needs you list's first load (attentionLoadedAtom): that load is a baseline, not news
    board: Map<string, string> | null;
}

const FAILED = new Set(["review-failed", "verify-failed", "failed"]);
const SETBACK_KINDS = new Set(["run-land-held", "run-unverified"]);
export const CUE_RANK: readonly CueId[] = ["needsYou", "setback", "landed", "taskDone"];
export const CUE_GAP_MS = 1500;
export const STEP_SOUND_PX = 24;

export function cueSnapshot(
    agents: readonly PlanAgent[],
    runs: readonly PlanRun[],
    board: readonly BoardCue[] | null
): CueSnapshot {
    const s: CueSnapshot = {
        agents: new Set(agents.map((a) => a.id)),
        asking: new Set(agents.filter((a) => a.state === "asking").map((a) => a.id)),
        runs: new Set(runs.map((r) => r.id)),
        landed: new Set(runs.filter((r) => r.landed).map((r) => r.id)),
        leadAsking: new Set(runs.filter((r) => r.leadAsking).map((r) => r.id)),
        tasks: new Map(),
        taskAsking: new Set(),
        board: board == null ? null : new Map(board.map((b) => [b.key, b.kind])),
    };
    for (const r of runs) {
        for (const t of r.tasks) {
            const k = `${r.id}/${t.id}`;
            s.tasks.set(k, t.state);
            if (t.asking) {
                s.taskAsking.add(k);
            }
        }
    }
    return s;
}

const fresh = (next: Set<string>, prev: Set<string>, known: (id: string) => boolean) =>
    [...next].some((id) => !prev.has(id) && known(id));

export function diffCues(prev: CueSnapshot | null, next: CueSnapshot): CueId[] {
    if (!prev) {
        return [];
    }
    const out = new Set<CueId>();
    const runOf = (k: string) => k.slice(0, k.lastIndexOf("/"));
    if (
        fresh(next.asking, prev.asking, (id) => prev.agents.has(id)) ||
        fresh(next.leadAsking, prev.leadAsking, (id) => prev.runs.has(id)) ||
        fresh(next.taskAsking, prev.taskAsking, (k) => prev.tasks.has(k) || prev.runs.has(runOf(k)))
    ) {
        out.add("needsYou");
    }
    // the list's first load (prev.board null) only sets the baseline
    for (const [key, kind] of prev.board && next.board ? next.board : []) {
        if (!prev.board!.has(key)) {
            out.add(SETBACK_KINDS.has(kind) ? "setback" : "needsYou");
        }
    }
    for (const [k, state] of next.tasks) {
        const before = prev.tasks.get(k);
        if (before === undefined || before === state) {
            continue;
        }
        if (state === "done") {
            out.add("taskDone");
        } else if (FAILED.has(state) && !FAILED.has(before)) {
            out.add("setback");
        }
    }
    if (fresh(next.landed, prev.landed, (id) => prev.runs.has(id))) {
        out.add("landed");
    }
    return CUE_RANK.filter((c) => out.has(c));
}

export function pickCue(cues: readonly CueId[], lastAt: number | null, now: number): CueId | null {
    if (cues.length === 0 || (lastAt != null && now - lastAt < CUE_GAP_MS)) {
        return null;
    }
    return CUE_RANK.find((c) => cues.includes(c)) ?? null;
}

export interface SoundSettings {
    events: boolean;
    ui: boolean;
    music: boolean;
    volume: number;
    muted: boolean;
}
export interface SoundGate {
    events: boolean;
    ui: boolean;
    music: boolean;
    volume: number;
}

export function soundGate(s: SoundSettings, focused: boolean): SoundGate {
    const on = focused && !s.muted && s.volume > 0;
    return { events: on && s.events, ui: on && s.ui, music: on && s.music, volume: s.volume };
}

// a step sound every STEP_SOUND_PX the arrows walk the boss
export function stepSound(acc: number, movedPx: number): { acc: number; play: boolean } {
    const total = acc + movedPx;
    return total >= STEP_SOUND_PX ? { acc: total % STEP_SOUND_PX, play: true } : { acc: total, play: false };
}
