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
}

export type AttentionAct = {
    label: "Approve" | "Retry" | "Acknowledge" | "Land again" | "Open";
    kind: "approve-dag" | "retry-dag" | "ack-run" | "land-run" | "open";
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
        return { label: "Acknowledge", kind: "ack-run" };
    }
    // a held land: the retry `wsh runs land` makes, once the human has cleared the reason the row names
    if (x.wireKind === "run-land-held" && x.channelId !== "" && x.runId != null) {
        return { label: "Land again", kind: "land-run" };
    }
    return { label: "Open", kind: "open" };
}
