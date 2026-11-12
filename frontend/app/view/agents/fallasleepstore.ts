// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The agents a person's Sleep is putting to sleep right now, the mirror of wakingstore's wakes. A Sleep takes a while
// before the agent reads as asleep: the server waits up to 5 s for its process to end, and when the conversation is
// worth compacting it compacts first and the sleep loop sleeps the agent once the summary lands (up to a minute after,
// agentsleep.CompactGiveUp gives the compaction 10). Until the roster says it sleeps, what would undo or cut across the
// Sleep (a message, Stop, Interrupt, a second Sleep) is off, and the box says what is happening. Its own module, so
// agentactions and the tree can read it without pulling in agentsleep's imports.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";
import { useEffect, useState } from "react";

/** sleeping: the Sleep call is in flight. compacting: the server compacts first and sleeps the agent after. */
export type FallAsleepPhase = "sleeping" | "compacting";

export interface FallingAsleep {
    phase: FallAsleepPhase;
    /** when the phase began (ms) */
    at: number;
}

// the server gives a compaction 10 minutes to land and its loop sleeps the agent within a minute after: past that
// nothing will sleep it, so the mark lapses rather than hold the box shut
export const FALL_ASLEEP_GIVE_UP_MS = 11 * 60_000;

// tab id -> the Sleep under way for it
export const fallingAsleepAtom = atom<ReadonlyMap<string, FallingAsleep>>(new Map());

/** Pure: the map with id's mark set to phase from now (phase given), or dropped (null). */
export function withFallingAsleep(
    m: ReadonlyMap<string, FallingAsleep>,
    id: string,
    phase: FallAsleepPhase | null,
    now: number
): ReadonlyMap<string, FallingAsleep> {
    if (phase == null && !m.has(id)) {
        return m;
    }
    const next = new Map(m);
    if (phase == null) {
        next.delete(id);
    } else {
        next.set(id, { phase, at: now });
    }
    return next;
}

/** Pure: the phase an agent is in on its way to sleep, or undefined: none marked, already asleep, or a mark that lapsed. */
export function fallAsleepPhase(
    mark: FallingAsleep | undefined,
    asleep: boolean,
    now: number
): FallAsleepPhase | undefined {
    if (mark == null || asleep || now - mark.at > FALL_ASLEEP_GIVE_UP_MS) {
        return undefined;
    }
    return mark.phase;
}

/** Pure: the ids whose mark is done with: the agent sleeps now, is gone from the roster, or the mark lapsed. */
export function settledFallAsleep(
    m: ReadonlyMap<string, FallingAsleep>,
    agents: { id: string; sleeping?: unknown }[],
    now: number
): string[] {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const out: string[] = [];
    for (const [id, mark] of m) {
        const a = byId.get(id);
        if (a == null || a.sleeping != null || now - mark.at > FALL_ASLEEP_GIVE_UP_MS) {
            out.push(id);
        }
    }
    return out;
}

/** Pure: the word for a phase, shown in the box and on the menu item. */
export function fallAsleepLabel(phase: FallAsleepPhase): string {
    return phase === "compacting" ? "Compacting, then sleeping…" : "Going to sleep…";
}

export function setFallingAsleep(id: string, phase: FallAsleepPhase | null): void {
    globalStore.set(fallingAsleepAtom, withFallingAsleep(globalStore.get(fallingAsleepAtom), id, phase, Date.now()));
}

export function fallingAsleepOf(id: string | undefined, asleep: boolean): FallAsleepPhase | undefined {
    return id == null ? undefined : fallAsleepPhase(globalStore.get(fallingAsleepAtom).get(id), asleep, Date.now());
}

/** The phase of the agent's Sleep under way, re-read when its mark would lapse. */
export function useFallingAsleep(id: string | undefined, asleep: boolean): FallAsleepPhase | undefined {
    const m = useAtomValue(fallingAsleepAtom);
    const mark = id != null ? m.get(id) : undefined;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (mark == null) {
            return;
        }
        const left = mark.at + FALL_ASLEEP_GIVE_UP_MS - Date.now();
        const t = setTimeout(() => setNow(Date.now()), Math.max(0, left) + 50);
        return () => clearTimeout(t);
    }, [mark]);
    return fallAsleepPhase(mark, asleep, Math.max(now, mark?.at ?? 0));
}

/** Drops each mark once its agent sleeps (or is gone, or the mark lapsed), so a later wake does not find it. In the
 *  always-mounted shell: the agent may fall asleep on any surface. */
export function useFallAsleepSync(agents: { id: string; sleeping?: unknown }[]): void {
    const m = useAtomValue(fallingAsleepAtom);
    useEffect(() => {
        if (m.size === 0) {
            return;
        }
        for (const id of settledFallAsleep(m, agents, Date.now())) {
            setFallingAsleep(id, null);
        }
    }, [m, agents]);
}
