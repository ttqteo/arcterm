// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How an act runs. The impure half of the pair whose pure half is petacts.ts: that module decides what is
// offered, this one is the only place an act touches the network or a surface.
//
// Every failure lands on the act that caused it (design §9). Never a toast: a silently-failed button is
// worse than no button, because it also spends the attention the panel exists to earn.

import { isPeekGesture } from "@/app/cockpit/ctrlheld";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { agentAnswer, markAskSent } from "@/app/view/agents/askanswer";
import { loadAttention } from "@/app/view/agents/attentionstore";
import { landAgain } from "./landrun";
import { openAddress, openOrPeekAddress, type OpenGesture } from "./openref";
import { closePeek } from "./peekstore";
import type { PetAct } from "./petacts";
import { petErrandAtom, setActState } from "./petstore";

// The same budget the Channels surface gives a consult (CONSULT_RPC_TIMEOUT_MS in channelactions.ts): the
// backend's consultTimeout is 120s and the rpc layer's 5s default would kill the stream long before a reply
// lands. Duplicated rather than imported so the errand does not pull the whole channel-actions module in.
const ERRAND_TIMEOUT_MS = 130_000;

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// An escort closes the peek only once the landing succeeds: an overlay anchored to the creature, left open over
// a surface it just navigated away from, is stranded — but a landing that cannot open leaves the user where
// they were, and its failure is set on the act, which only an open peek shows. A Ctrl+click peeks instead, into
// this same popup, so the popup stays and a failed load is the peek's own toast.
async function escort(
    model: AgentsViewModel,
    act: Extract<PetAct, { verb: "open" }>,
    gesture?: OpenGesture
): Promise<void> {
    const target = act.target;
    if (isPeekGesture(gesture)) {
        await openOrPeekAddress(model, target.ref, gesture, { anchor: target.anchor });
        return;
    }
    const result = await openAddress(model, target.ref, { anchor: target.anchor }, (r) => {
        if ("reason" in r) {
            setActState(act.id, { status: "error", text: r.message });
        }
    });
    if (result.ok) {
        closePeek();
    }
}

// An ack, an approve and a retry settle their row in place, so the peek stays open; the reload drops the row
// now instead of on the next 10s poll. The calls are the Brief queue's own (attentionrun.ts).
async function settle(act: PetAct, call: () => Promise<unknown>): Promise<void> {
    setActState(act.id, { status: "running" });
    try {
        await call();
        setActState(act.id, { status: "done" });
        await loadAttention();
    } catch (e) {
        setActState(act.id, { status: "error", text: errText(e) });
    }
}

function settleInPlace(act: PetAct): Promise<void> | null {
    switch (act.verb) {
        case "ack":
            // land: a held land's Dismiss, which drops the item and leaves the branch
            return settle(act, () =>
                RpcApi.AckRunCommand(TabRpcClient, { channelid: act.channelId, runid: act.runId, land: act.land })
            );
        case "approve-task":
        case "retry-task":
            return settle(act, () =>
                RpcApi.DagActionCommand(TabRpcClient, {
                    channelid: act.channelId,
                    runid: act.runId,
                    taskid: act.taskId,
                    action: act.verb === "approve-task" ? "approve" : "retry",
                })
            );
        default:
            return null;
    }
}

// A land retry settles its row in place too. A held answer is the act's error, carrying the reason, so the row
// says why it is still there instead of quietly staying.
async function land(act: Extract<PetAct, { verb: "land" }>): Promise<void> {
    setActState(act.id, { status: "running" });
    try {
        const outcome = await landAgain(act.channelId, act.runId);
        setActState(act.id, { status: outcome.failed ? "error" : "done", text: outcome.text });
    } catch (e) {
        setActState(act.id, { status: "error", text: errText(e) });
    }
}

// An option answers its question in place, through the Cockpit's own answer (askanswer.ts), but awaited: the
// Cockpit fires and forgets, and here a failed send must land on the button. The ask is marked sent only once the
// send succeeds, so a failure leaves every other answer bar free to answer it.
async function answer(model: AgentsViewModel, act: Extract<PetAct, { verb: "answer" }>): Promise<void> {
    const ans = agentAnswer(model, act.agentId, { 0: new Set([act.option]) }, {});
    if (ans == null) {
        setActState(act.id, { status: "error", text: "Already answered, or the question has changed" });
        return;
    }
    await settle(act, async () => {
        await RpcApi.AnswerAgentCommand(TabRpcClient, { oref: ans.oref, answers: ans.answers });
        markAskSent(model, ans.askKey);
    });
}

export async function runAct(model: AgentsViewModel, act: PetAct, gesture?: OpenGesture): Promise<void> {
    if (act.verb === "answer") {
        await answer(model, act);
        return;
    }
    const inPlace = settleInPlace(act);
    if (inPlace != null) {
        await inPlace;
        return;
    }
    if (act.verb === "land") {
        await land(act);
        return;
    }
    if (act.verb === "open") {
        await escort(model, act, gesture);
    }
}

// only an escort leaves the peek, and not when the peek key (ctrlheld.ts) turns it into a peek; the caller drops
// focus-return for it and nothing else
export function actNavigates(act: PetAct, gesture?: { ctrlKey: boolean; metaKey?: boolean }): boolean {
    return act.verb === "open" && !isPeekGesture(gesture);
}

// The errand reuses the Channels surface's consult path exactly (channelactions.ts): post the question as a
// channel message, then stream the runtime's reply. Two consequences that make it the right seam — the
// question and its answer persist as channel messages, so closing the panel loses nothing; and it is not
// tier-gated, because the identical gesture is ungated on that surface and a panel stricter than the
// surface it mirrors would be incoherent.
//
// It needs a channel because CommandConsultData does, and a creature in window chrome has none of its own —
// the same per-channel hole the pet design named. The caller supplies the active channel.
export async function sendErrand(channelId: string, runtime: string, prompt: string): Promise<void> {
    const consultId = crypto.randomUUID();
    globalStore.set(petErrandAtom, { prompt, runtime, text: "", status: "streaming" });
    let acc = "";
    try {
        await RpcApi.PostChannelMessageCommand(TabRpcClient, {
            channelid: channelId,
            kind: "consult",
            author: "you",
            text: prompt,
            reforef: `consult:${consultId}`,
        });
        const gen = RpcApi.ConsultCommand(
            TabRpcClient,
            { channelid: channelId, runtime, prompt, consultid: consultId },
            { timeout: ERRAND_TIMEOUT_MS }
        );
        for await (const chunk of gen) {
            acc += chunk?.text ?? "";
            globalStore.set(petErrandAtom, { prompt, runtime, text: acc, status: "streaming" });
        }
        globalStore.set(petErrandAtom, { prompt, runtime, text: acc, status: "done" });
    } catch (e) {
        // the backend still posts a consult-reply carrying the error, so the channel keeps the full record
        globalStore.set(petErrandAtom, { prompt, runtime, text: acc || errText(e), status: "error" });
    }
}
