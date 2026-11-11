// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Workflow lens: which scan run it follows, and the start of one. The palette's Scan workflow
// row (cockpit/palette-scan.ts) starts a scan through createWorkflowScan too, so a scan started there is the one the
// lens shows next. The workflowscan: address is not part of this: it keeps landing on the scan's agent (openref.ts).

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { usageLensAtom } from "./usagestore";

// module-level, not lens state: the surface unmounts on a switch, and a start from the palette writes this while the
// lens is not on screen. null = nothing followed yet; the lens then looks for the newest scan run (newestScanRun).
export const workflowScanRunAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// creating the run starts the scan agent's tab, which outlasts the 5s default
export const START_SCAN_TIMEOUT_MS = 60_000;

export function followWorkflowScan(runId: string | null): void {
    globalStore.set(workflowScanRunAtom, runId);
}

// Starts the scan run and makes the lens follow it. A start error propagates: the caller shows it where its button was.
export async function createWorkflowScan(channelId: string): Promise<Run> {
    const rtn = await RpcApi.WorkflowScanStartCommand(
        TabRpcClient,
        { channelid: channelId, workspaceid: globalStore.get(atoms.workspaceId) },
        { timeout: START_SCAN_TIMEOUT_MS }
    );
    if (rtn?.run == null) {
        throw new Error("starting the scan returned no run");
    }
    followWorkflowScan(rtn.run.id);
    return rtn.run;
}

// The lens's own Scan workflow: the run starts and the lens stays where it is, showing it work (no open: the scan's
// agent is one button away, and the person asked from the lens to watch it here).
export async function startWorkflowScanFromLens(channelId: string): Promise<Run> {
    const run = await createWorkflowScan(channelId);
    globalStore.set(usageLensAtom, "workflow");
    return run;
}
