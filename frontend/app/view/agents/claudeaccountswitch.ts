// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The app-wide Claude account switch, shared by Settings → Agents (a row picked) and Chat's usage strip (its Switch
// button): write claude:activeaccount, then offer the running agents still on the old account a restart on the new
// one (ClaudeAccountRestartModal), leaving out the projects that run on an account of their own. switchPlan decides
// what the switch does and is pure; switchClaudeAccount applies it.
// See docs/superpowers/specs/2026-11-18-chat-suggest-card-design.md (decision 11).

import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentVM } from "./agentsviewmodel";
import { defaultAccountName, projectsWithOwnAccount, restartCandidates, type RestartCandidate } from "./claudeaccount";
import type { ClaudeIdentity } from "./ratelimitstore";
import type { Lineage } from "./runlineage";

export interface SwitchInput {
    agents: AgentVM[];
    lineage: Lineage;
    projects: Record<string, ProjectKeywords> | null | undefined;
    // the accounts wavesrv lists (ClaudeAccountListCommand), with their names and whether their token is gone
    accounts: { id: string; label: string; notoken?: boolean }[];
    identity: ClaudeIdentity;
    // the account wavesrv runs new sessions on ("" for Default); null while the list has not loaded
    active: string | null;
    // a tab the restart dialog must not offer: the strip restarts its own agent itself
    exclude?: string;
}

export interface SwitchPlan {
    writeActive: boolean; // false when the target already is the active account: nothing to write
    candidates: RestartCandidate[]; // what the restart dialog offers; empty means no dialog
    accountName: string; // the target's name, for the dialog's title
}

// What switching to account `id` ("" for Default) does. The dialog is offered even when `id` is already active (an
// agent launched on another account is still on the old one), but never for a project that runs on an account of its
// own, nor for the `exclude` tab.
export function switchPlan(id: string, input: SwitchInput): SwitchPlan {
    const pinned = projectsWithOwnAccount(input.projects, input.accounts);
    const candidates = restartCandidates(input.agents, id, input.lineage).filter(
        (c) => (c.project == null || !pinned.has(c.project)) && c.tabId !== input.exclude
    );
    const accountName =
        id === ""
            ? defaultAccountName(input.identity.loginEmail)
            : (input.accounts.find((a) => a.id === id)?.label ?? id);
    return { writeActive: id !== input.active, candidates, accountName };
}

// Switch to account `id`: write the setting (wavesrv applies it to its own environment before it broadcasts the
// change), then open the restart dialog when agents remain to move. A failed write throws and opens nothing.
export async function switchClaudeAccount(id: string, input: SwitchInput): Promise<void> {
    const plan = switchPlan(id, input);
    if (plan.writeActive) {
        // a dynamic-key patch needs the cast, as settingsui's writeConfig does
        const patch = { "claude:activeaccount": id } as Parameters<typeof RpcApi.SetConfigCommand>[1];
        await RpcApi.SetConfigCommand(TabRpcClient, patch);
    }
    if (plan.candidates.length > 0) {
        modalsModel.pushModal("ClaudeAccountRestartModal", {
            candidates: plan.candidates,
            account: id,
            accountName: plan.accountName,
        });
    }
}
