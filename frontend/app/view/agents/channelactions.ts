// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Impure side of a channel message: turns typed text into the right verb-command(s). dispatch ->
// launchAgent (a new worker) + a "dispatch" message; consult -> a streamed one-shot review; steer ->
// ControllerInputCommand (inject into a live worker's PTY) + a "directive" message; post -> a "human"
// message. Every branch records a channel message so the timeline is the single source of truth (and a
// manager can replay it). The one caller left is the command palette's fast-dispatch rows, which
// synthesize the "@runtime goal" / "ask @runtime goal" transport strings themselves.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "./agents";
import { submitToAgent } from "./agentsubmit";
import type { AgentVM } from "./agentsviewmodel";
import { planMessage, type RosterEntry } from "./channelmessages";
import { consultStreamKey, consultStreamsAtom, setConsultStream } from "./channelsstore";
import { composeStartupCommand, runtimeStartupCommand, type Runtime } from "./launch";
import { naFlagsAtom } from "./naflagsstore";

// A consult runs a headless CLI that can take up to the backend's 120s consultTimeout. The RPC layer
// otherwise applies a 5s default handler timeout (DefaultTimeoutMs), which would kill the stream long
// before the reply lands (codex emits its first reply chunk only at ~6s). Give it headroom past 120s.
const CONSULT_RPC_TIMEOUT_MS = 130_000;

// Apply the user's persisted per-runtime launch flags (New Agent modal / Settings) so a channel
// dispatch honors the same flags as a manual launch, instead of a bare startup command.
function flaggedStartup(runtime: Runtime): string {
    const flags = globalStore.get(naFlagsAtom)[runtime] ?? {};
    return composeStartupCommand(runtimeStartupCommand(runtime), runtime, flags);
}

async function post(channelId: string, kind: string, author: string, text: string, refORef: string): Promise<void> {
    await RpcApi.PostChannelMessageCommand(TabRpcClient, {
        channelid: channelId,
        kind,
        author,
        text,
        reforef: refORef,
    });
}

export async function sendChannelMessage(args: {
    model: AgentsViewModel;
    channelId: string;
    projectPath: string;
    projectName: string;
    roster: RosterEntry[];
    text: string;
}): Promise<void> {
    const { model, channelId, projectPath, projectName, roster, text } = args;
    const plan = planMessage(text, roster);
    if (plan.kind === "consult") {
        const consultId = crypto.randomUUID();
        // one question row (author "you"), grouped to its replies by the shared consultId
        await RpcApi.PostChannelMessageCommand(TabRpcClient, {
            channelid: channelId,
            kind: "consult",
            author: "you",
            text: plan.text,
            reforef: `consult:${consultId}`,
        });
        // fan out: one streaming consult per runtime, accumulating into the ephemeral atom
        await Promise.all(
            plan.runtimes.map(async (runtime) => {
                setConsultStream(consultId, runtime, { text: "", status: "streaming" });
                try {
                    const gen = RpcApi.ConsultCommand(
                        TabRpcClient,
                        {
                            channelid: channelId,
                            runtime,
                            prompt: plan.text,
                            consultid: consultId,
                        },
                        { timeout: CONSULT_RPC_TIMEOUT_MS }
                    );
                    let acc = "";
                    for await (const chunk of gen) {
                        acc += chunk?.text ?? "";
                        setConsultStream(consultId, runtime, { text: acc, status: "streaming" });
                    }
                    setConsultStream(consultId, runtime, { text: acc, status: "done" });
                } catch {
                    // the backend still posts a consult-reply with the error; mark the live row done
                    setConsultStream(consultId, runtime, {
                        text: globalStore.get(consultStreamsAtom)[consultStreamKey(consultId, runtime)]?.text ?? "",
                        status: "error",
                    });
                }
            })
        );
        return;
    }
    if (plan.kind === "dispatch") {
        const tabId = await launchAgent(model, {
            runtime: plan.runtime,
            startupCommand: flaggedStartup(plan.runtime),
            task: plan.text,
            projectPath,
            projectName: projectName || "agent",
        });
        await post(channelId, "dispatch", plan.runtime, plan.text, `tab:${tabId}`);
        return;
    }
    if (plan.kind === "steer") {
        if (plan.blockId) {
            await submitToAgent(plan.blockId, plan.text);
        }
        await post(channelId, "directive", "you", plan.text, `tab:${plan.targetId}`);
        return;
    }
    await post(channelId, "human", "you", plan.text, "");
}

// steerWorker injects a directive into a live worker's terminal (Override on an answered card) and
// records a directive message, mirroring the composer's steer branch. workerORef is a "tab:<id>" oref;
// the roster entry supplies the blockId to write to. No-ops (returns false) if the worker is gone.
export async function steerWorker(args: {
    channelId: string;
    workerORef: string;
    agents: AgentVM[];
    text: string;
}): Promise<boolean> {
    const { channelId, workerORef, agents, text } = args;
    if (!workerORef.startsWith("tab:")) {
        return false;
    }
    const worker = agents.find((a) => a.id === workerORef.slice("tab:".length));
    if (!worker?.blockId) {
        return false;
    }
    await submitToAgent(worker.blockId, text);
    await post(channelId, "directive", "you", text, workerORef);
    return true;
}
