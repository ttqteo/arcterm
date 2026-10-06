// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Land again: the button form of `wsh runs land <run-id>`, the retry for a run whose branch the engine held
// instead of merging back. The peek, the Brief's queue and the run sheet all offer it, and all read its
// outcome through landOutcome, so the three cannot disagree about what a held retry says.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { loadAttention } from "@/app/view/agents/attentionstore";

// orchestrate.LandTimeout (a re-run of Check and Verify, 20 minutes each, plus 5 for the merge) and the same
// 10s of slack `wsh runs land` adds: the rpc layer's 5s default would give up on a land still re-running Verify.
export const LAND_RPC_TIMEOUT_MS = 45 * 60_000 + 10_000;

export interface LandOutcome {
    failed: boolean;
    text: string;
}

/** Pure: what one land retry reports. A held land is not an rpc error — the server answers with the reason —
 *  so it is read here as a failure, or the button would report success on a branch that is still not merged. */
export function landOutcome(land: RunLand | null | undefined): LandOutcome {
    if (land?.state === "landed") {
        return { failed: false, text: land.commit ? `Landed as ${land.commit.slice(0, 8)}.` : "Landed." };
    }
    if (land?.state === "held") {
        return { failed: true, text: `Still held: ${land.reason || "the engine gave no reason"}` };
    }
    return { failed: true, text: `The land ended ${land?.state || "without a state"}.` };
}

// Retries the land, then reloads the attention list so a landed run's row leaves now rather than on the next poll.
export async function landAgain(channelId: string, runId: string): Promise<LandOutcome> {
    const land = await RpcApi.LandRunCommand(
        TabRpcClient,
        { channelid: channelId, runid: runId },
        { timeout: LAND_RPC_TIMEOUT_MS }
    );
    await loadAttention();
    return landOutcome(land);
}
