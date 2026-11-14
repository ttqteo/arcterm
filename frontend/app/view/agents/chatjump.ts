// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Chat's jump to latest from outside the pane: the `agent:chat-jump-latest` key presses the round ↓ that chatpane.tsx
// draws above the box while the reader is scrolled up. Each ChatPane registers its jump under its agent id; this module
// has no imports, so no import cycle can run through it (chatinsert.ts does the same for the box).

// the binding's keys, here so the ↓'s tooltip names them without importing the bindings
export const CHAT_JUMP_KEYS = "Mod:ArrowDown";

// false when there is nothing to jump to: the conversation already shows its end
type ChatJump = () => boolean;

const jumps = new Map<string, ChatJump>();

// returns the unregister; a remount that registered the agent again first is left alone
export function registerChatJump(agentId: string, jump: ChatJump): () => void {
    jumps.set(agentId, jump);
    return () => {
        if (jumps.get(agentId) === jump) {
            jumps.delete(agentId);
        }
    };
}

// false when the agent shows no Chat, or its Chat is at the end already
export function jumpChatToLatest(agentId: string): boolean {
    return jumps.get(agentId)?.() ?? false;
}
