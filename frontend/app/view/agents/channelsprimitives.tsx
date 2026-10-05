// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Shared pieces for the run views: the live-ask answer row, and the jump to an agent's own surface.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import type { AgentsViewModel } from "./agents";
import { askSentKey, type AgentVM } from "./agentsviewmodel";
import { AnswerBar } from "./answerbar";

export function jumpToAgent(model: AgentsViewModel, id: string) {
    globalStore.set(model.focusIdAtom, id);
    globalStore.set(model.surfaceAtom, "agent");
}

// An asking worker's answer row, reusing the cockpit's AnswerBar + model answer state.
export function AskRow({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const answerSel = useAtomValue(model.answerSelAtom);
    const answerText = useAtomValue(model.answerTextAtom);
    const sentIds = useAtomValue(model.sentIdsAtom);
    const dismiss = agent.ask?.oref
        ? () => fireAndForget(() => RpcApi.AgentAskClearCommand(TabRpcClient, agent.ask!.oref!))
        : undefined;
    return (
        <div className="rounded-[9px] border border-edge-mid bg-lane p-3">
            <AnswerBar
                model={model}
                agent={agent}
                selections={answerSel[agent.id] ?? {}}
                texts={answerText[agent.id] ?? {}}
                sent={sentIds.has(askSentKey(agent) ?? "")}
                numbered
                onToggle={(qi, oi) => model.toggleAnswer(agent.id, qi, oi)}
                onText={(qi, value) => model.setAnswerText(agent.id, qi, value)}
                onSubmit={() => model.submitAnswer(agent.id)}
                onDismiss={dismiss}
            />
        </div>
    );
}
