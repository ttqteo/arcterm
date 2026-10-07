// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How a waiting item's in-place button runs (the button attentionact.ts chose): Approve and Retry act on the
// exact task the server named, Acknowledge and Land again on the run. The Brief's Waiting list and the Cockpit's
// Needs-you strip both call this, so the two cannot drift apart; each brings its own feedback, because the
// Brief answers in its undo bar and the Cockpit has none. The creature's peek has its own runner (petactrun.ts),
// which keeps its failures on the act that caused them.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { loadAttention } from "@/app/view/agents/attentionstore";
import type { AttentionAct, AttentionActInput } from "./attentionact";
import { landAgain } from "./landrun";

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
            return `Acknowledged · ${what}`;
        case "land-run":
            return `Landed · ${what}`;
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
        default:
            return;
    }
}

// Runs the item's button. true: it went through, and the attention list is reloaded so the item leaves now rather
// than on the next poll. false: it failed (the feedback says why) or the act only opens, which is the caller's to do.
export async function runAttentionAct(
    act: AttentionAct,
    row: AttentionRunRow,
    feedback: AttentionFeedback
): Promise<boolean> {
    if (act.kind === "open") {
        return false;
    }
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
