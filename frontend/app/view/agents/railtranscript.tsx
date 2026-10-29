// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail's Transcript tab: the agent's conversation, drawn beside its terminal
// (docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md). The body is an empty panel for now; the strip's
// entry, the tab's width and its key come first.

import type { AgentVM } from "./agentsviewmodel";

export function RailTranscript({ agent }: { agent: AgentVM }) {
    return <div data-rail-transcript={agent.id} className="flex min-h-0 flex-1 flex-col" />;
}
