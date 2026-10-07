// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Keeps the Claude account's 5-hour and weekly windows known while no claude session runs. A session
// learns its windows only from its first response, so before this nothing showed until one had run.
// wavesrv asks Anthropic's usage endpoint with Claude Code's stored login (or reads Claude Code's
// cached copy of that answer) and this saves the answer as the claude snapshot ratelimitstore keeps,
// so every reader shows it, labeled "as of" like any saved snapshot. The answer names the /login
// account it read, and the snapshot is filed under that account, not under "Default".

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { normalizeEmail, noteLoginEmail, recordRateLimit } from "./ratelimitstore";

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

// where the answer is saved: under the /login account it names, else (a wavesrv that does not say) Default
export function quotaKey(q: CommandGetClaudeQuotaRtnData): string {
    const email = normalizeEmail(q?.email);
    return email ? `claude:${email}` : "claude:default";
}

// Saves an answer as the snapshot of the account it names; false when it holds no reading.
function recordAnswer(q: CommandGetClaudeQuotaRtnData): boolean {
    const usage = quotaUsage(q);
    if (usage == null) {
        return false;
    }
    // wavesrv answers only for the Default account; the identity learns its email first, so the
    // snapshot saved as "claude:default" before it was known moves to that account
    noteLoginEmail(q.email);
    recordRateLimit(quotaKey(q), usage, q.capturedat);
    return true;
}

async function readClaudeQuota(): Promise<void> {
    try {
        recordAnswer(await RpcApi.GetClaudeQuotaCommand(TabRpcClient));
    } catch (e) {
        // the saved snapshot keeps answering; the next poll tries again
        console.warn("reading the Claude quota failed", e);
    }
}

export interface RefreshResult {
    ok: boolean;
    retryAt?: number; // epoch ms: a 429 backoff held the ask, and the endpoint may be asked again then
}

// What a manual refresh reports: ok when a reading came back and nothing held the ask. A held ask still
// answers with the reading wavesrv kept, which is recorded all the same.
export function refreshOutcome(q: CommandGetClaudeQuotaRtnData, recorded: boolean): RefreshResult {
    if (q?.retryat) {
        return { ok: false, retryAt: q.retryat };
    }
    return { ok: recorded };
}

// Asks the usage endpoint now, whatever the poll's spacing (decision 10), and records the answer as the
// poll does. wavesrv still refuses to ask during a 429 backoff, and says until when.
export async function refreshClaudeQuota(): Promise<RefreshResult> {
    try {
        const q = await RpcApi.RefreshClaudeQuotaCommand(TabRpcClient);
        return refreshOutcome(q, recordAnswer(q));
    } catch (e) {
        console.warn("refreshing the Claude quota failed", e);
        return { ok: false };
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
