// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getAgentAskAtom } from "./agentaskstore";
import type { AgentsViewModel } from "./agents";
import { askSentKey, buildAskAnswers, canSubmitAsk } from "./agentsviewmodel";
import { loadAttention } from "./attentionstore";
import { heldFor, keepHeldAnswer, type HeldAnswer } from "./sleepheld";

type AskModel = Pick<AgentsViewModel, "agentsAtom" | "sentIdsAtom">;

export interface AgentAnswer {
    oref: string;
    answers: AgentAnswerItem[];
    // the ask's identity, which marks it sent (askSentKey)
    askKey: string;
    // set when the agent sleeps with its ask kept: wavesrv holds the answer for its wake instead of typing it
    held: HeldAnswer | null;
}

// The answer to send to the agent's live ask, validated against it, or null when there is nothing to send (no such
// agent, already sent, incomplete answer, no oref). `expectKey`, when given, is the ask the answer was chosen for
// (askSentKey): a live ask that is another one takes nothing, so an answer shown for one question never lands on the next.
export function agentAnswer(
    model: AskModel,
    agentId: string,
    selections: Record<number, Set<number>>,
    texts: Record<number, string>,
    expectKey?: string
): AgentAnswer | null {
    const agent = globalStore.get(model.agentsAtom).find((a) => a.id === agentId);
    const askKey = agent ? askSentKey(agent) : undefined;
    if (!agent || askKey == null || globalStore.get(model.sentIdsAtom).has(askKey)) {
        return null;
    }
    if (expectKey != null && askKey !== expectKey) {
        return null;
    }
    const qs = agent.ask?.questions ?? [];
    const oref = agent.ask?.oref;
    if (!canSubmitAsk(qs, selections, texts) || !oref) {
        return null;
    }
    const answers = buildAskAnswers(qs, selections, texts, agent.ask?.prose ?? false);
    return { oref, answers, askKey, held: heldFor(agent, answers) };
}

// What follows wavesrv accepting `answer`. An answer it held for a sleeping agent (answer.held) is kept for Chat to show
// as going in when the agent wakes, and the ask leaves the row: the sleeping agent will never clear it. Any other
// answer is typed into the agent's terminal, which clears the ask itself.
export function noteAnswerAccepted(answer: AgentAnswer): void {
    if (answer.held == null) {
        return;
    }
    keepHeldAnswer(answer.oref, answer.held);
    globalStore.set(getAgentAskAtom(answer.oref), null);
    // the nav-rail badges are a server-computed list on a poll (agentaskstore's clear does the same)
    void loadAttention();
}

// Locks every answer bar on the ask, so one answer is never sent twice.
export function markAskSent(model: AskModel, askKey: string): void {
    globalStore.set(model.sentIdsAtom, new Set(globalStore.get(model.sentIdsAtom)).add(askKey));
}

// The one answer send, shared by the Cockpit's answer bar and the palette's inline answers. Validates the
// answer against the agent's live ask, sends it once, and marks the ask sent so the answer bar locks. A send the
// agent never receives unlocks the ask again and says so. An answer for an agent asleep with its ask kept is held by
// wavesrv for its wake and no clear will ever come from the sleeping agent, so once wavesrv accepts it the ask is over
// here: it is kept for Chat to show as going in when the agent wakes (sleepheld.ts), and the ask leaves the row.
// Returns false when nothing was sent (no such agent, already sent, incomplete answer, no oref, or not the ask
// `expectKey` names). The creature's peek sends the same answer but awaits it, so a failure lands on its button
// (petactrun.ts).
export function answerAgentAsk(
    model: AskModel,
    agentId: string,
    selections: Record<number, Set<number>>,
    texts: Record<number, string>,
    expectKey?: string
): boolean {
    const answer = agentAnswer(model, agentId, selections, texts, expectKey);
    if (answer == null) {
        return false;
    }
    markAskSent(model, answer.askKey);
    // the lock is released only by the ask clearing or re-raising, which a lost answer never causes: without
    // this the card would read "Answered" with the agent still blocked and no way to send again
    RpcApi.AnswerAgentCommand(TabRpcClient, { oref: answer.oref, answers: answer.answers }).then(
        () => noteAnswerAccepted(answer),
        (err) => {
            const sent = new Set(globalStore.get(model.sentIdsAtom));
            sent.delete(answer.askKey);
            globalStore.set(model.sentIdsAtom, sent);
            pushToast({
                title: "The answer did not reach the agent",
                message: `${err instanceof Error ? err.message : String(err)}. Answer again to resend.`,
                level: "error",
            });
        }
    );
    return true;
}
