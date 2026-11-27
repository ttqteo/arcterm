// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Claude account word an agent shows beside its model, in the chat footer and under its sidebar row. It
// shows only while the open claude agents run on two accounts or more: with one account in play the word says
// nothing. Accounts are told apart by their quota key (agentQuotaKey), so a token account tied to the /login email
// counts as that one account, as its limits do.

import { agentAccountId } from "./chatlimitstrip";
import { CLAUDE_ACCOUNT_META, defaultAccountName } from "./claudeaccount";
import { agentQuotaKey, type ClaudeIdentity } from "./ratelimitstore";

export interface AccountBadge {
    text: string; // the account as named: its label, or the /login email in full; a long one truncates where drawn
    title: string; // the tooltip: the account in full
}

// what a badge needs of an agent (AgentVM's fields)
export interface AccountBadgeAgent {
    id: string;
    agent?: string;
    usage?: { account?: string } | null;
    accountPick?: string; // the block's agent:claudeaccount, the account its launch picked
    loginEmail?: string;
}

// The badge of each claude agent, by agent id: empty while they all run on one account (or none is claude).
export function agentAccountBadges(
    agents: AccountBadgeAgent[],
    identity: ClaudeIdentity,
    activeId: string
): Record<string, AccountBadge> {
    const seen = new Map<string, { key: string; label: string }>();
    for (const a of agents) {
        if (a.agent !== "claude") {
            continue;
        }
        const meta = a.accountPick ? { [CLAUDE_ACCOUNT_META]: a.accountPick } : undefined;
        const accountId = agentAccountId(a.usage, meta, activeId);
        const label =
            accountId === ""
                ? defaultAccountName(a.loginEmail || identity.loginEmail)
                : (identity.accounts.find((x) => x.id === accountId)?.label ?? accountId);
        seen.set(a.id, { key: agentQuotaKey(accountId, a.loginEmail, identity), label });
    }
    if (new Set([...seen.values()].map((s) => s.key)).size < 2) {
        return {};
    }
    const out: Record<string, AccountBadge> = {};
    for (const [id, s] of seen) {
        out[id] = { text: s.label, title: `Claude account: ${s.label}` };
    }
    return out;
}
