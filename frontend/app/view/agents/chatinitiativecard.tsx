// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The card of Add to an initiative from Chat and its folded rows (docs/superpowers/specs/2026-11-12-chat-add-to-initiative-
// design.md §3, §6). Task 1 of the plan lands the three exports as stubs with their final signatures, so the conversation
// wiring runs beside the card's view: the host draws its children, a block draws as the code block it is today, and the
// message cards draw nothing. The card itself fills them in.

import type { ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { INITIATIVE_LANG } from "./chatinitiative";
import { CodeBlock } from "./codeblock";

/** The chat an initiative card is drawn in: its agent, and what the card reads off it (the initiative list, the agent's
 *  chunk, whether the agent has exited). */
export function ChatInitiativeHost({ children }: { agent: AgentVM; model: AgentsViewModel; children: ReactNode }) {
    return <>{children}</>;
}

/** A ```arc-initiative block: the card an agent proposes, or its folded row once handled. */
export function InitiativeBlockView({ raw }: { raw: string }) {
    return <CodeBlock code={raw} lang={INITIATIVE_LANG} />;
}

/** The cards the person opened from messages that sit after the chat item with this key: the editor while open, its row
 *  once added. */
export function InitiativeMessageCards(_props: { agentId: string; anchor: string }) {
    return null;
}
