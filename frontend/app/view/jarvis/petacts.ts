// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the creature offers to DO about each thing it reports. Pure — no atoms, no rpc, no pixels — for the
// same reason petcondition.ts is (design §3): this module decides WHAT is offered, and passing thunks in
// here would drag the rpc client into the one layer whose whole value is being assertable without one.
//
// The law it implements (design §2): nothing appears on the creature unless it carries the thing that
// resolves it. A row with genuinely nothing to do returns [] and stays a readout — the rate-limit countdown
// is that row, and it is honest rather than an omission.

// attentionact.ts is pure too, and petvoice.ts is type-only, so the purity above holds
import { attentionAct } from "./attentionact";
import type { PetEventSource } from "./petvoice";

// Where an escort lands; every landing is an address that goes through openAddress.
export type PetTarget = { kind: "oref"; ref: string; anchor?: string };

// approve-task and retry-task act on one task of a dag
export type PetAct =
    | { id: string; verb: "open"; label: string; target: PetTarget }
    // land: true dismisses the run's held land instead of acknowledging its unverified outcome
    | { id: string; verb: "ack"; label: string; channelId: string; runId: string; land?: boolean }
    | { id: string; verb: "land"; label: string; channelId: string; runId: string }
    | { id: string; verb: "approve-task"; label: string; channelId: string; runId: string; taskId: string }
    | { id: string; verb: "retry-task"; label: string; channelId: string; runId: string; taskId: string }
    // one option of a one-question ask, sent to the agent that asked (askanswer.ts, the Cockpit's own send)
    | { id: string; verb: "answer"; label: string; agentId: string; option: number };

// An act's transient outcome, keyed by act id in petstore.ts. Transient on purpose: the row's real value
// comes from its own poll, and letting an act's return value become the row's value would drift from the
// backend the moment a poll disagreed with a stale result.
export type PetActStatus = "running" | "done" | "error";

export interface PetActState {
    status: PetActStatus;
    text?: string;
}

// The button a click settles, the same one the Brief's queue offers (attentionact.ts), followed by the Open
// escort for reading the run first: Approve a dag gate, Retry a failed task, Acknowledge an unverified run.
// A held land gets Land again (a branch merged by hand lands at once) and Dismiss beside it, the way out
// for a branch that will never land. Everything else needs a written answer, a picked option or a judgment, so
// the escort covers it here; a question one key can answer also gets its options in the peek (petpeekmodel.ts).
export function actsForAttention(item: AttentionItem): PetAct[] {
    if (!item?.runid) {
        return []; // nothing addressable: an item with no run cannot be opened or resolved
    }
    const escort: PetAct = {
        id: `${item.key}:open`,
        verb: "open",
        label: "Open",
        target: { kind: "oref", ref: `run:${item.runid}` },
    };
    const channelId = item.channelid ?? "";
    const runId = item.runid;
    const taskId = item.taskid ?? "";
    const act = attentionAct({ wireKind: item.kind, channelId, runId, taskId, retry: item.retry === true });
    switch (act.kind) {
        case "approve-dag":
            return [
                { id: `${item.key}:approve`, verb: "approve-task", label: act.label, channelId, runId, taskId },
                escort,
            ];
        case "retry-dag":
            return [
                { id: `${item.key}:retry`, verb: "retry-task", label: act.label, channelId, runId, taskId },
                escort,
            ];
        case "ack-run":
            return [{ id: `${item.key}:ack`, verb: "ack", label: act.label, channelId, runId }, escort];
        case "land-run":
            return [
                { id: `${item.key}:land`, verb: "land", label: act.label, channelId, runId },
                { id: `${item.key}:dismiss`, verb: "ack", label: "Dismiss", land: true, channelId, runId },
                escort,
            ];
        default:
            return [escort];
    }
}

// One Open per source the event carries.
export function actsForEvent(event: { id: string; sources?: PetEventSource[] }): PetAct[] {
    const acts: PetAct[] = [];
    for (const s of event.sources ?? []) {
        acts.push({
            id: `${event.id}:${s.ref}:open`,
            verb: "open",
            label: `Open ${s.title}`,
            target: { kind: "oref", ref: s.ref, anchor: s.anchor },
        });
    }
    return acts;
}
