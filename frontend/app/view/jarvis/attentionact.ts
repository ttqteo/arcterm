// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one button a waiting item gets in place, decided once for every place that lists waiting items: the
// Brief's queue (briefingmodel.ts queueAction) and the creature's peek (petacts.ts). Two copies had drifted:
// the peek offered Approve and Retry nowhere, so a gate or a failed task there could only be opened. Pure.

export interface AttentionActInput {
    wireKind: string; // pkg/jarvis/attention.go Kind
    channelId: string;
    runId: string | null;
    taskId: string;
    retry: boolean; // the blocked dag's task failed and a retry can rerun it (attention.go blockedTask)
    queueId?: string; // the queue entry a run-queue-blocked item is about (AttentionItem.queueid)
    agentOpen?: boolean; // an agent is open on a due chunk's initiative (initiativework.ts openAgentFor)
}

export type AttentionAct = {
    label: "Approve" | "Retry" | "Accept" | "Land again" | "Work on" | "Go to agent" | "Start now" | "Remove" | "Open";
    kind: "approve-dag" | "retry-dag" | "ack-run" | "land-run" | "work-on" | "start-queued" | "remove-queued" | "open";
};

// Approve and Retry need the exact task the server named; without it, and for anything that needs a
// judgment rather than a button (a failed final stage, a review or merge failure, a question), the item
// opens its run instead of guessing.
export function attentionAct(x: AttentionActInput): AttentionAct {
    if (x.wireKind === "dag-gate" && x.taskId !== "" && x.runId != null) {
        return { label: "Approve", kind: "approve-dag" };
    }
    if (x.wireKind === "dag-blocked" && x.retry && x.taskId !== "" && x.runId != null) {
        return { label: "Retry", kind: "retry-dag" };
    }
    if (x.wireKind === "run-unverified" && x.channelId !== "" && x.runId != null) {
        return { label: "Accept", kind: "ack-run" };
    }
    // a held land: the retry `wsh runs land` makes, once the human has cleared the reason the row names
    if (x.wireKind === "run-land-held" && x.channelId !== "" && x.runId != null) {
        return { label: "Land again", kind: "land-run" };
    }
    // a chunk that came due: the row itself opens the initiative, so the button starts the work the chunk's
    // notes describe (initiativeworkaction.ts workOnDueChunk); it needs the cockpit, so callers run it. Once an
    // agent is open on the initiative the same act goes to it, so the label says so
    if (x.wireKind === "chunk-due") {
        return { label: x.agentOpen ? "Go to agent" : "Work on", kind: "work-on" };
    }
    // a plan to review (plan-review) is decided on the agent's rail or the initiative's card, not by a wire act:
    // it opens, where planreviewtarget.ts says
    // a queued start the engine could not make: it names no run to open, so Start now (the entry's own id) is the
    // act, and only the Needs you strip offers the Remove beside it (attentionSecondAct)
    if (x.wireKind === "run-queue-blocked" && (x.queueId ?? "") !== "") {
        return { label: "Start now", kind: "start-queued" };
    }
    return { label: "Open", kind: "open" };
}

// The second button an item gets where there is room for one (the Needs you strip): the way out that is not the
// first act. Only a blocked queue entry has one, so the Brief and the creature's peek, which draw one button, show
// attentionAct alone.
export function attentionSecondAct(x: AttentionActInput): AttentionAct | null {
    if (x.wireKind === "run-queue-blocked" && (x.queueId ?? "") !== "") {
        return { label: "Remove", kind: "remove-queued" };
    }
    return null;
}
