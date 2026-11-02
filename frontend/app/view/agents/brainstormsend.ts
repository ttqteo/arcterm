// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Every brainstorm action reaches the agent as one line, sent as a prompt; Arc never writes brainstorm.json.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "./agents";
import { wakeAgent } from "./agentsleep";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import {
    brainstormLine,
    runPrefill,
    sendBlocker,
    sentKind,
    stopsJudge,
    type BrainstormAction,
} from "./brainstormmodel";
import {
    getBrainstorm,
    setStartingRun,
    shownBrainstormFile,
    updateBrainstorm,
    type BrainstormState,
} from "./brainstormstore";
import { openLauncher } from "./launcherstore";

type PromptIO = {
    prompt(blockId: string, text: string): Promise<void>;
    wake(tabId: string, text: string): Promise<void>;
    stopJudge(blockId: string): Promise<void>;
    sleepAfterRun(tabId: string, runId: string, path: string): Promise<void>;
};

// a session whose arc mod holds a control stream runs the line as a prompt, leaving the user's draft in the
// composer alone; any other session has it typed, as canvas marks are sent. A sleeping agent has no process to send
// to: the line goes with its Wake, which delivers it once the agent is back, as the composer's message does
const tauriPromptIO: PromptIO = {
    async prompt(blockId, text) {
        await RpcApi.AgentPromptCommand(TabRpcClient, { blockid: blockId, text });
    },
    async wake(tabId, text) {
        await wakeAgent(tabId, { message: text });
    },
    async stopJudge(blockId) {
        await RpcApi.BrainstormJudgeStopCommand(TabRpcClient, { blockid: blockId });
    },
    async sleepAfterRun(tabId, runId, path) {
        await RpcApi.AgentsSleepAfterRunCommand(TabRpcClient, { tab: tabId, runid: runId, path });
    },
};

export async function sendBrainstorm(
    agent: AgentVM,
    action: BrainstormAction,
    io: PromptIO = tauriPromptIO,
    now: number = Date.now()
): Promise<void> {
    const line = brainstormLine(action);
    if (line == null) {
        throw new Error("Nothing to send");
    }
    if (!agent.blockId) {
        throw new Error("This agent has no terminal to send to");
    }
    const state = getBrainstorm(agent.id);
    const blocked = sendBlocker(action, shownBrainstormFile(state));
    if (blocked != null) {
        throw new Error(blocked);
    }
    // a judge left running would hold the next approach question's judge, and its result would land for a question
    // already answered
    if (stopsJudge(action, state?.file ?? null, state?.sent != null)) {
        try {
            await io.stopJudge(agent.blockId);
        } catch (e) {
            throw new Error(`Couldn't stop the judge: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    if (agent.sleeping) {
        try {
            await io.wake(agent.id, line);
        } catch (e) {
            throw new Error(`Couldn't wake ${agent.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    } else {
        try {
            await io.prompt(agent.blockId, line);
        } catch (e) {
            throw new Error(`Couldn't send to ${agent.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    // the agent writes its file once, at the end of its turn: until then the pane says it is writing
    const modifiedMs = getBrainstorm(agent.id)?.modifiedMs ?? null;
    updateBrainstorm(agent.id, (s) => ({ ...s, sent: { at: now, modifiedMs, kind: sentKind(action) } }));
}

// the run's id goes back to the agent, which records it in the file: the tree and the pane then show the run. The
// agent's sleep is armed first, so it is in place before the turn that records the run ends: once that turn ends, the
// agent sleeps 15 seconds later. A failed arm leaves the agent to the 30-minute rule and still sends the line
async function notifyRun(agent: AgentVM, runId: string, path: string, io: PromptIO): Promise<void> {
    try {
        await io.sleepAfterRun(agent.id, runId, path);
    } catch (e) {
        console.warn("brainstorm: arming the agent's sleep after its run failed", agent.id, runId, e);
    }
    try {
        await sendBrainstorm(agent, { kind: "run", runId }, io);
    } catch (e) {
        console.warn("brainstorm: telling the agent its run id failed", agent.id, runId, e);
    }
}

// Change on the approve bar: the launcher prefilled, with nothing typed into the agent
export function openRunLauncher(
    model: AgentsViewModel,
    agent: AgentVM,
    s: BrainstormState,
    io: PromptIO = tauriPromptIO
): void {
    if (s.file == null) {
        return;
    }
    // Approve stays off from the launcher's Start until the agent records the run: the agent hears the run's id only
    // once CreateRun returns, up to a minute later, and an Approve lit in between starts the same run again
    const path = s.path;
    openLauncher(model, "run", {
        ...runPrefill(s.file, { projectName: projectOf(agent), cwd: s.cwd }),
        handback: {
            handedOff: () => setStartingRun(agent.id, path, { runId: null }),
            started: (runId: string) => {
                setStartingRun(agent.id, path, { runId });
                void notifyRun(agent, runId, path, io);
            },
            stopped: () => setStartingRun(agent.id, path, null),
        },
    });
}

// the agent hears it is approved first, so a line that cannot be sent leaves the launcher closed
export async function approveAndOpenRun(
    model: AgentsViewModel,
    agent: AgentVM,
    s: BrainstormState,
    io: PromptIO = tauriPromptIO
): Promise<void> {
    await sendBrainstorm(agent, { kind: "approved" }, io);
    openRunLauncher(model, agent, s, io);
}
