// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The palette's Scan workflow row: start a workflow scan in the home project, then open the run through the one
// router (workflowscan:<runid>), which lands on the scan's agent, where it asks which fixes to apply.

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { openTarget } from "@/app/view/jarvis/openref";

// creating the run starts the scan agent's tab, which outlasts the 5s default
const START_SCAN_TIMEOUT_MS = 60_000;

// The agent enters the roster only once its tab's block loads in the frontend or its hook reports a status, both
// after the start returns. Past this wait the open goes on without it and lands on the run's sheet.
const SCAN_AGENT_WAIT_MS = 15_000;

// Does this roster hold the agent a run spawned? (AgentVM.runId, the same match openref's scanAgent makes.)
export function rosterHoldsRun(roster: ReadonlyArray<{ runId?: string }>, runId: string): boolean {
    return roster.some((a) => a.runId === runId);
}

function scanAgentUp(model: AgentsViewModel, runId: string): boolean {
    return (
        rosterHoldsRun(globalStore.get(model.agentsAtom), runId) ||
        rosterHoldsRun(globalStore.get(model.terminalsAtom), runId)
    );
}

// Resolves once the run's agent is in the agents or terminals roster, at once when it already is, or after
// timeoutMs without it. Never rejects; the subscriptions and the timer are gone on every path.
function waitForScanAgent(model: AgentsViewModel, runId: string, timeoutMs: number): Promise<void> {
    if (scanAgentUp(model, runId)) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const unsubs: Array<() => void> = [];
        const timer = setTimeout(finish, timeoutMs);
        function finish() {
            clearTimeout(timer);
            unsubs.forEach((unsub) => unsub());
            resolve();
        }
        const check = () => {
            if (scanAgentUp(model, runId)) {
                finish();
            }
        };
        unsubs.push(globalStore.sub(model.agentsAtom, check), globalStore.sub(model.terminalsAtom, check));
    });
}

// A start error propagates: the palette shows it as its action error, where the row was. An open that fails after
// the scan began reports itself (openTarget's own toast); the scan runs on.
export async function startWorkflowScan(model: AgentsViewModel, channelId: string): Promise<Run> {
    const rtn = await RpcApi.WorkflowScanStartCommand(
        TabRpcClient,
        { channelid: channelId, workspaceid: globalStore.get(atoms.workspaceId) },
        { timeout: START_SCAN_TIMEOUT_MS }
    );
    if (rtn?.run == null) {
        throw new Error("starting the scan returned no run");
    }
    // openTarget reads the roster once, so a start that opens before the agent shows would land on the sheet
    await waitForScanAgent(model, rtn.run.id, SCAN_AGENT_WAIT_MS);
    await openTarget(model, { kind: "workflowscan", runId: rtn.run.id });
    return rtn.run;
}
