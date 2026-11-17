// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's mirror of remotemode.Eligible, so the Agent header and its key show Hand to phone only where the
// backend would take it. It cannot see whether the session is still live or whether a role-less tab is a
// `wsh jarvis run` child; for those the backend refuses and the caller toasts its message.

import type { AgentVM } from "./agentsviewmodel";
import type { RunRole } from "./runlineage";

const HANDABLE_RUNTIMES = new Set(["claude", "pi"]);

export function canHandToPhone(
    agent: Pick<AgentVM, "kind" | "blockId" | "agent">,
    role: RunRole | null | undefined
): boolean {
    return (
        (agent.kind == null || agent.kind === "agent") &&
        !!agent.blockId &&
        HANDABLE_RUNTIMES.has(agent.agent ?? "") &&
        (role == null || role.kind === "lead")
    );
}

export function isHandedOver(status: RemoteStatusData | null, tabId: string): boolean {
    return status?.handed?.includes(tabId) ?? false;
}
