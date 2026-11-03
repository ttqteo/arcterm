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
    await openTarget(model, { kind: "workflowscan", runId: rtn.run.id });
    return rtn.run;
}
