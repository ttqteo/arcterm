// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import { askSentKey, buildAskAnswers, canSubmitAsk } from "./agentsviewmodel";

type AskModel = Pick<AgentsViewModel, "agentsAtom" | "sentIdsAtom">;

export interface AgentAnswer {
    oref: string;
    answers: AgentAnswerItem[];
    // the ask's identity, which marks it sent (askSentKey)
    askKey: string;
}

// The answer to send to the agent's live ask, validated against it, or null when there is nothing to send (no such
// agent, already sent, incomplete answer, no oref).
export function agentAnswer(
    model: AskModel,
    agentId: string,
    selections: Record<number, Set<number>>,
    texts: Record<number, string>
): AgentAnswer | null {
    const agent = globalStore.get(model.agentsAtom).find((a) => a.id === agentId);
    const askKey = agent ? askSentKey(agent) : undefined;
    if (!agent || askKey == null || globalStore.get(model.sentIdsAtom).has(askKey)) {
        return null;
    }
    const qs = agent.ask?.questions ?? [];
    const oref = agent.ask?.oref;
    if (!canSubmitAsk(qs, selections, texts) || !oref) {
        return null;
    }
    return { oref, answers: buildAskAnswers(qs, selections, texts, agent.ask?.prose ?? false), askKey };
}

// Locks every answer bar on the ask, so one answer is never sent twice.
export function markAskSent(model: AskModel, askKey: string): void {
    globalStore.set(model.sentIdsAtom, new Set(globalStore.get(model.sentIdsAtom)).add(askKey));
}

// The one answer send, shared by the Cockpit's answer bar and the palette's inline answers. Validates the
// answer against the agent's live ask, fires the RPC once, and marks the ask sent so the answer bar locks.
// Returns false when nothing was sent (no such agent, already sent, incomplete answer, no oref). The creature's
// peek sends the same answer but awaits it, so a failure lands on its button (petactrun.ts).
export function answerAgentAsk(
    model: AskModel,
    agentId: string,
    selections: Record<number, Set<number>>,
    texts: Record<number, string>
): boolean {
    const answer = agentAnswer(model, agentId, selections, texts);
    if (answer == null) {
        return false;
    }
    fireAndForget(() => RpcApi.AnswerAgentCommand(TabRpcClient, { oref: answer.oref, answers: answer.answers }));
    markAskSent(model, answer.askKey);
    return true;
}
