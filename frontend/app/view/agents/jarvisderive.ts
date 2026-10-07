// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure derivations for Jarvis (the observe-only manager). buildFleetSnapshot resolves the workers a
// channel dispatched into their current roster state. No React, no Wave runtime imports.

import type { AgentVM } from "./agentsviewmodel";
import { answeredAskIds } from "./jarviscards";

export interface WorkerState {
    oref: string; // "tab:<id>"
    name: string; // live roster name (an AI paraphrase), else the dispatch runtime
    state: "working" | "asking" | "idle" | "gone";
    task?: string; // live task (async-filled, may be empty), else the dispatch text
    dispatchTask?: string; // the literal task typed into this channel's dispatch message (ground truth)
    askText?: string; // first pending question, when asking
    askId?: string; // the worker's current ask id (when asking), used to drop Jarvis-answered asks
    activity?: string; // live activity line (AgentVM.activity); undefined when gone
    costUsd?: number; // session cost so far (AgentVM.usage?.costusd); undefined when gone/unreported
    contextPct?: number; // context-window fill % (AgentVM.usage?.contextpct); undefined when gone
    outcome?: { status: string; summary: string }; // finished-worker outcome (from an "outcome" message)
}

export const OREF_PREFIX = "tab:";

// Resolve every worker one channel's messages dispatched/steered to its current state. A dispatched oref
// with no live roster row is "gone" (its terminal exited) and falls back to the dispatch message's runtime
// + task. Dedup by oref (a channel steers the same worker repeatedly).
export function buildFleetSnapshot(messages: ChannelMessage[], agents: AgentVM[]): WorkerState[] {
    const orefs: string[] = [];
    const dispatchInfo = new Map<string, { name: string; task?: string }>();
    const activeTs = new Map<string, number>(); // latest dispatch/directive ts per oref
    const dismissTs = new Map<string, number>(); // latest dismiss ts per oref
    const outcomeByOref = new Map<string, { ts: number; outcome: { status: string; summary: string } }>();
    for (const m of messages) {
        if (!m.reforef?.startsWith(OREF_PREFIX)) {
            continue;
        }
        if (m.kind === "dispatch" && !dispatchInfo.has(m.reforef)) {
            dispatchInfo.set(m.reforef, { name: m.author, task: m.text || undefined });
        }
        if (m.kind === "dispatch" || m.kind === "directive") {
            if (!orefs.includes(m.reforef)) {
                orefs.push(m.reforef);
            }
            activeTs.set(m.reforef, Math.max(activeTs.get(m.reforef) ?? 0, m.ts ?? 0));
        }
        if (m.kind === "dismiss") {
            dismissTs.set(m.reforef, Math.max(dismissTs.get(m.reforef) ?? 0, m.ts ?? 0));
        }
        if (m.kind === "outcome") {
            const prev = outcomeByOref.get(m.reforef);
            if (!prev || (m.ts ?? 0) > prev.ts) {
                let parsed: { status?: string; summary?: string } = {};
                try {
                    parsed = m.data ? JSON.parse(m.data) : {};
                } catch {
                    parsed = {};
                }
                outcomeByOref.set(m.reforef, {
                    ts: m.ts ?? 0,
                    outcome: { status: parsed.status ?? "done", summary: parsed.summary ?? m.text ?? "" },
                });
            }
        }
    }
    return orefs
        .map((oref): WorkerState => {
            const id = oref.slice(OREF_PREFIX.length);
            const dispatchTask = dispatchInfo.get(oref)?.task;
            const oc = outcomeByOref.get(oref);
            const outcome = oc && oc.ts > (activeTs.get(oref) ?? 0) ? oc.outcome : undefined;
            const live = agents.find((a) => a.id === id);
            if (live) {
                return {
                    oref,
                    name: live.name,
                    state: live.state,
                    task: live.task || undefined,
                    dispatchTask,
                    askText: live.state === "asking" ? live.ask?.questions?.[0]?.question : undefined,
                    askId: live.state === "asking" ? live.ask?.askId : undefined,
                    activity: live.activity || undefined,
                    costUsd: live.usage?.costusd,
                    contextPct: live.usage?.contextpct,
                    outcome,
                };
            }
            const info = dispatchInfo.get(oref);
            return { oref, name: info?.name ?? "worker", state: "gone" as const, task: info?.task, dispatchTask, outcome };
        })
        // a gone worker dismissed after its last dispatch/directive drops out; a later re-dispatch
        // (newer activeTs) brings it back. live workers are never hidden.
        .filter((w) => w.state !== "gone" || (dismissTs.get(w.oref) ?? 0) <= (activeTs.get(w.oref) ?? 0));
}

// Live-fleet spend: sum of each live worker's session cost. A gone worker carries no usage (its AgentVM
// left the roster), so the total reflects currently-running workers, not lifetime channel spend.
export function fleetCostUsd(snapshot: WorkerState[]): number {
    return snapshot.reduce((sum, w) => sum + (w.costUsd ?? 0), 0);
}

// the set of ask ids Jarvis has auto-answered across all channels (drives every "needs you" surface).
// takes one message list per channel.
export function answeredAskIdsAcross(messageLists: ChannelMessage[][]): Set<string> {
    const answered = new Set<string>();
    for (const messages of messageLists) {
        for (const o of answeredAskIds(messages)) {
            answered.add(o);
        }
    }
    return answered;
}

// whether a worker is genuinely blocked on the human: asking, and not already answered by Jarvis.
export function needsHuman(a: AgentVM, answered: Set<string>): boolean {
    return a.state === "asking" && !(a.ask?.askId && answered.has(a.ask.askId));
}
