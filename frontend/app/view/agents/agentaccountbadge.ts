// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the Claude account word an agent shows beside its model, in the chat footer. Every
// claude agent names its account, also while all of them run on one: the /login (Default) account and the active
// account can differ, and the word is how the person sees which one an agent took.

import { agentAccountId } from "./chatlimitstrip";
import { CLAUDE_ACCOUNT_META, defaultAccountName } from "./claudeaccount";
import type { ClaudeIdentity } from "./ratelimitstore";

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

// The badge of each claude agent, by agent id; an agent of another harness has none.
export function agentAccountBadges(
    agents: AccountBadgeAgent[],
    identity: ClaudeIdentity,
    activeId: string
): Record<string, AccountBadge> {
    const out: Record<string, AccountBadge> = {};
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
        out[a.id] = { text: label, title: `Claude account: ${label}` };
    }
    return out;
}
