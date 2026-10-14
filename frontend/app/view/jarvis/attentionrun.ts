// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How a waiting item's in-place button runs (the button attentionact.ts chose): Approve and Retry act on the
// exact task the server named, Accept and Land again on the run, Start now and Remove on a blocked queue entry.
// The Brief's Waiting list and the Cockpit's Needs-you strip both call this, so the two cannot drift apart; each
// brings its own feedback, because the Brief answers in its undo bar and the Cockpit has none. The creature's peek
// has its own runner (petactrun.ts), which keeps its failures on the act that caused them.

import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { loadAttention } from "@/app/view/agents/attentionstore";
import { fireAndForget } from "@/util/util";
import type { AttentionAct, AttentionActInput } from "./attentionact";
import { landAgain } from "./landrun";

// Start now runs the whole start (worktree, Setup) before it answers: the budget the run launcher gives a create
export const START_NOW_TIMEOUT_MS = 180_000;

// what a run reads off an item: the ids the call needs, and the two words its confirmation names the item by
export interface AttentionRunRow extends AttentionActInput {
    source: string;
    title: string;
}

export interface AttentionFeedback {
    done(text: string): void;
    fail(text: string): void;
}

/** Pure: the confirmation an act reports once it has gone through. */
export function attentionDoneText(
    kind: AttentionAct["kind"],
    row: Pick<AttentionRunRow, "taskId" | "source" | "title">
): string {
    const what = row.source || row.title;
    switch (kind) {
        case "approve-dag":
            return `Approved ${row.taskId} · ${what}`;
        case "retry-dag":
            return `Retrying ${row.taskId}`;
        case "ack-run":
            return `Accepted · ${what}`;
        case "land-run":
            return `Landed · ${what}`;
        case "start-queued":
            return `Started · ${what}`;
        case "remove-queued":
            return `Removed · ${what}`;
        default:
            return "";
    }
}

async function call(act: AttentionAct, row: AttentionRunRow): Promise<void> {
    switch (act.kind) {
        case "approve-dag":
        case "retry-dag":
            await RpcApi.DagActionCommand(TabRpcClient, {
                channelid: row.channelId,
                runid: row.runId!,
                taskid: row.taskId,
                action: act.kind === "approve-dag" ? "approve" : "retry",
            });
            return;
        case "ack-run":
            await RpcApi.AckRunCommand(TabRpcClient, { channelid: row.channelId, runid: row.runId! });
            return;
        case "land-run": {
            // a held answer is not an rpc error, so it throws here and the feedback reads the reason rather than "Landed"
            const outcome = await landAgain(row.channelId, row.runId!);
            if (outcome.failed) {
                throw new Error(outcome.text);
            }
            return;
        }
        case "start-queued":
            // a refusal (another queued run is starting, or this start failed) is thrown to the feedback as the
            // server worded it; the server blocks the entry itself when its own start fails, never for a refusal
            await RpcApi.RunQueueStartNowCommand(TabRpcClient, { id: row.queueId! }, { timeout: START_NOW_TIMEOUT_MS });
            return;
        case "remove-queued":
            await RpcApi.RunQueueRemoveCommand(TabRpcClient, { id: row.queueId! });
            return;
        default:
            return;
    }
}

// Removing a queued start drops the plan the session handed over, so it asks first, as closing a run does.
function confirmRemoveQueued(what: string, onConfirm: () => void): void {
    modalsModel.pushModal("ConfirmModal", {
        title: "Remove from queue",
        message: `Remove "${what}" from the run queue? It will not start, and any entry waiting on it is blocked.`,
        confirmLabel: "Remove",
        destructive: true,
        onConfirm,
    });
}

// Runs the item's button. true: it went through, and the attention list is reloaded so the item leaves now rather
// than on the next poll. false: it failed (the feedback says why), or the act only opens or starts an agent, which
// needs the cockpit and is the caller's to do, or it waits on a confirm (Remove) and runs, with the same feedback,
// when the person confirms.
export async function runAttentionAct(
    act: AttentionAct,
    row: AttentionRunRow,
    feedback: AttentionFeedback
): Promise<boolean> {
    if (act.kind === "open" || act.kind === "work-on") {
        return false;
    }
    if (act.kind === "remove-queued") {
        confirmRemoveQueued(row.source || row.title, () => fireAndForget(() => settleAct(act, row, feedback)));
        return false;
    }
    return settleAct(act, row, feedback);
}

async function settleAct(act: AttentionAct, row: AttentionRunRow, feedback: AttentionFeedback): Promise<boolean> {
    try {
        await call(act, row);
    } catch (e) {
        feedback.fail(e instanceof Error ? e.message : String(e));
        return false;
    }
    // landAgain reloads it itself, a held answer included
    if (act.kind !== "land-run") {
        await loadAttention();
    }
    feedback.done(attentionDoneText(act.kind, row));
    return true;
}
