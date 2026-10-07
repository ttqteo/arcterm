// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Keeps ratelimitstore's Claude identity (the /login account's email and each token account's) in step
// with wavesrv. Snapshots are keyed by the real account's email, so every reader needs to know it: it is
// read at boot, after every change in Settings → Claude account, and from each quota answer.
// See docs/superpowers/specs/2026-10-07-claude-account-switch-design.md (decision 8).

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { identityFromList, setClaudeIdentity } from "./ratelimitstore";

export async function refreshClaudeIdentity(): Promise<void> {
    try {
        setClaudeIdentity(identityFromList(await RpcApi.ClaudeAccountListCommand(TabRpcClient)));
    } catch (e) {
        // the identity already held keeps answering; the next refresh tries again
        console.warn("reading the Claude accounts failed", e);
    }
}
