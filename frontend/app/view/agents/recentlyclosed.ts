// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reopen a closed agent, as a browser reopens a closed tab (Mod+Shift+T, reopenClosedAgent in cockpit-actions.ts).
// Closing an agent pushes its conversation here; the chord takes the newest back, asleep when its harness can sleep.
// Only a few are kept: the stack is for an agent closed by mistake a moment ago, Conversation History holds the rest.
// It lives in memory, so a restart of arcterm empties it.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";

export const RECENTLY_CLOSED_MAX = 5;

/** A closed agent, as much as reopening it needs: its conversation (the sessions archive gives the resume command). */
export interface ClosedAgent {
    transcriptPath: string;
    name: string;
    closedAt: number;
}

// newest first
export const recentlyClosedAtom = atom<ClosedAgent[]>([]) as PrimitiveAtom<ClosedAgent[]>;

function norm(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase();
}

/** Pure: what the stack keeps of a closed tab, or null for one with no conversation to come back to: a terminal (its
 *  shell is gone with it), or an agent closed before it reported a transcript. */
export function closedEntry(
    vm: Pick<AgentVM, "name"> & Partial<Pick<AgentVM, "kind" | "transcriptPath">>,
    now: number
): ClosedAgent | null {
    if (vm.kind === "terminal" || !vm.transcriptPath) {
        return null;
    }
    return { transcriptPath: vm.transcriptPath, name: vm.name, closedAt: now };
}

/** Pure: the stack with these closes on top, the first given newest; a conversation already on it moves to the top
 *  rather than taking two places, and the oldest past RECENTLY_CLOSED_MAX fall off. */
export function pushClosed(stack: ClosedAgent[], closed: ClosedAgent[]): ClosedAgent[] {
    const added = new Set(closed.map((c) => norm(c.transcriptPath)));
    const kept = stack.filter((c) => !added.has(norm(c.transcriptPath)));
    const fresh = closed.filter(
        (c, i) => closed.findIndex((d) => norm(d.transcriptPath) === norm(c.transcriptPath)) === i
    );
    return [...fresh, ...kept].slice(0, RECENTLY_CLOSED_MAX);
}

/** Pure: the closed agent to reopen and the stack left after it. One a tab holds again (reopened some other way, from
 *  Conversation History or New) is dropped on the way, so the chord never only jumps to a tab already open. */
export function nextToReopen(
    stack: ClosedAgent[],
    roster: Pick<AgentVM, "transcriptPath">[]
): { entry?: ClosedAgent; rest: ClosedAgent[] } {
    const held = new Set(roster.flatMap((a) => (a.transcriptPath ? [norm(a.transcriptPath)] : [])));
    const i = stack.findIndex((c) => !held.has(norm(c.transcriptPath)));
    return i < 0 ? { rest: [] } : { entry: stack[i], rest: stack.slice(i + 1) };
}

/** Remember tabs being closed, the first given newest. Called when the close is confirmed, not when it is asked. */
export function noteClosed(vms: (Pick<AgentVM, "name"> & Partial<Pick<AgentVM, "kind" | "transcriptPath">>)[]): void {
    const now = Date.now();
    const closed = vms.flatMap((vm) => closedEntry(vm, now) ?? []);
    if (closed.length > 0) {
        globalStore.set(recentlyClosedAtom, pushClosed(globalStore.get(recentlyClosedAtom), closed));
    }
}

/** Pure: the scanned session holding this conversation, which carries its resume command, or undefined. */
export function archivedSession(
    sessions: SessionActivity[] | null,
    transcriptPath: string
): SessionActivity | undefined {
    const want = norm(transcriptPath);
    return sessions?.find((s) => s.transcriptpath && norm(s.transcriptpath) === want);
}
