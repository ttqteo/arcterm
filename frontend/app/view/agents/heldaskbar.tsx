// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { askingLabel, type AgentVM } from "./agentsviewmodel";
import { heldAskDismissedAtom, heldAskKey, isHeldAsk, undismissed } from "./heldaskpopup";

// A held command's card (the Token burn card, an Antigravity question) hidden with Later, as a strip above the agent's
// terminal: the terminal shows only the command waiting, and the card itself pops up as a dialog (heldaskdialog.tsx),
// so this is the one way back to it from the agent. Answer pops it up again. While the dialog is up, nothing shows here.
export function HeldAskBar({ agent }: { agent: AgentVM }) {
    const dismissed = useAtomValue(heldAskDismissedAtom);
    if (!isHeldAsk(agent) || !dismissed.has(heldAskKey(agent))) {
        return null;
    }
    return (
        <div
            data-held-ask={agent.id}
            className="mx-1 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-edge-mid bg-surface-raised px-3 py-[6px] text-[12px] text-secondary"
        >
            <span className="shrink-0 font-semibold text-asking">{askingLabel(agent)}</span>{" "}
            <span className="min-w-0 flex-1 truncate">is waiting for your answer</span>
            <button
                type="button"
                onClick={() => globalStore.set(heldAskDismissedAtom, undismissed(dismissed, heldAskKey(agent)))}
                className="inline-flex h-[25px] shrink-0 cursor-pointer items-center rounded-[6px] border border-accent/45 bg-transparent px-2.5 text-[11.5px] font-semibold text-accent-soft hover:bg-accent/10"
            >
                Answer
            </button>
        </div>
    );
}
