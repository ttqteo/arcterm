// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which held card (the Token burn card, an Antigravity question) pops up over the cockpit. A held card blocks its agent until
// someone answers, so it pops over any surface, the agent's own included: drawn above the terminal it crowded the TUI.
// Pure; heldaskdialog.tsx draws it, and heldaskbar.tsx the strip that brings back one hidden with Later.

import { atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";

// the asks hidden with Later: they stay open in the strip above their agent's terminal and in the Cockpit, but do not pop
// up again
export const heldAskDismissedAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

// the agent whose held ask the popup shows, or null; read by the key dispatcher, which holds surface keys under it
export const heldAskOpenAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export function heldAskKey(agent: AgentVM): string {
    return agent.ask?.askId ?? agent.id;
}

export function isHeldAsk(agent: AgentVM): boolean {
    return agent.state === "asking" && agent.ask?.hold === true;
}

// heldAskToPop is the first agent waiting on a held command that has not been hidden
export function heldAskToPop(agents: AgentVM[], dismissed: Set<string>): AgentVM | null {
    return agents.find((a) => isHeldAsk(a) && !dismissed.has(heldAskKey(a))) ?? null;
}

// Answer on the strip: the hidden ask pops up again
export function undismissed(dismissed: Set<string>, key: string): Set<string> {
    const next = new Set(dismissed);
    next.delete(key);
    return next;
}
