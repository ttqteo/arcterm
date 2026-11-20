// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent's edits: the files one agent changed itself, rebuilt by the backend (GitAgentEditsCommand) from its
// transcript. Only Claude Code writes the file-history backups that rebuild needs, so only a claude agent has
// the range; the AgentVM's `agent` field is its runtime, absent meaning claude.
export function editsApply(runtime: string | undefined): boolean {
    return (runtime || "claude") === "claude";
}

export type EditFlag = "approximate" | "outside";
