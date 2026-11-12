// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { runChatFork, type ForkPoint } from "./chatfork";
import { setWakeDraft } from "./wakingstore";

/** Chat's Fork and Fork from here, on the real RPC, launch, draft store and toasts (runChatFork). */
export function forkFromChat(model: AgentsViewModel, agent: AgentVM, point?: ForkPoint): void {
    fireAndForget(() =>
        runChatFork(
            {
                fork: (data) => RpcApi.ForkAgentSessionCommand(TabRpcClient, data),
                launch: (opts) => launchAgent(model, opts),
                setDraft: setWakeDraft,
                toast: pushToast,
            },
            agent,
            point
        )
    );
}
