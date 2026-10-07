// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Keeps the Claude account's 5-hour and weekly windows known while no claude session runs. A session
// learns its windows only from its first response, so before this nothing showed until one had run.
// wavesrv asks Anthropic's usage endpoint with Claude Code's stored login (or reads Claude Code's
// cached copy of that answer) and this saves the answer as the claude snapshot ratelimitstore keeps,
// so every reader shows it, labeled "as of" like any saved snapshot.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { recordRateLimit } from "./ratelimitstore";

// wavesrv asks the endpoint at most once per five minutes, however many windows poll
const POLL_MS = 5 * 60 * 1000;

// the windows as AgentUsage spells them; null when nothing is known or the reading has no time
export function quotaUsage(q: CommandGetClaudeQuotaRtnData): AgentUsage | null {
    if (!q?.capturedat || (q.fivehourpct == null && q.weekpct == null)) {
        return null;
    }
    const usage: AgentUsage = {};
    if (q.fivehourpct != null) {
        usage.fivehourpct = q.fivehourpct;
        usage.fivehourreset = q.fivehourreset;
    }
    if (q.weekpct != null) {
        usage.weekpct = q.weekpct;
        usage.weekreset = q.weekreset;
    }
    return usage;
}

async function readClaudeQuota(): Promise<void> {
    try {
        const q = await RpcApi.GetClaudeQuotaCommand(TabRpcClient);
        const usage = quotaUsage(q);
        if (usage != null) {
            // wavesrv answers only for the Default account
            recordRateLimit("claude:default", usage, q.capturedat);
        }
    } catch (e) {
        // the saved snapshot keeps answering; the next poll tries again
        console.warn("reading the Claude quota failed", e);
    }
}

let polling = false;

export function startClaudeQuotaPolling(): void {
    if (polling) {
        return;
    }
    polling = true;
    void readClaudeQuota();
    setInterval(() => void readClaudeQuota(), POLL_MS);
}
