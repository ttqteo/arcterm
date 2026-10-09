// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which held command's card (`wsh memgate`'s Low RAM) pops up over the cockpit. A held command blocks its agent until
// someone answers, and its card sits only above that agent's terminal, so from any other surface it went unseen. Pure;
// heldaskdialog.tsx draws it.

import { atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";

// the asks hidden with Later: they stay open on their agent's card and in the Cockpit, but do not pop up again
export const heldAskDismissedAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

// the agent whose held ask the popup shows, or null; read by the key dispatcher, which holds surface keys under it
export const heldAskOpenAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export function heldAskKey(agent: AgentVM): string {
    return agent.ask?.askId ?? agent.id;
}

// heldAskToPop is the first agent waiting on a held command that has not been hidden, skipping one whose card is already
// on screen: the Agent surface showing that agent draws it above the terminal (heldaskbar.tsx)
export function heldAskToPop(agents: AgentVM[], dismissed: Set<string>, onScreenId: string | null): AgentVM | null {
    for (const a of agents) {
        if (a.state === "asking" && a.ask?.hold && a.id !== onScreenId && !dismissed.has(heldAskKey(a))) {
            return a;
        }
    }
    return null;
}
