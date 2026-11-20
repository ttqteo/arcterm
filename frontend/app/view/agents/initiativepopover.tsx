// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Link to initiative picker's open state, for an agent with no initiative. The linked agent's initiative is its tab on
// the Agent rail (railinitiativepane.tsx): the popover this file held, opened in place on the agent header, went when the
// tab took its chunks, plan to review and notes.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

// The agent whose Link to initiative picker is open, else null: its header's "+ Link to initiative" chip, the "…" menu's
// row in the Chat view (which has no chip) and the `i` key all open the one picker.
export const initiativeLinkPickerAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

/** The selector of `agentId`'s own "+ Link to initiative" chip (agentheader.tsx puts the agent's id on it). In a split
 *  several agents' headers are on the page at once, so a bare `[data-initiative-link]` finds another agent's chip. */
export function linkChipSelector(agentId: string): string {
    return `[data-initiative-link="${agentId.replace(/["\\]/g, "\\$&")}"]`;
}

/** Opens the Link to initiative picker for `agentId` when its own header carries the chip (Chat's lean header and
 *  Terminal's both do; an ended session's or a run worker's has none), and says whether it did. The `i` key asks this
 *  way (the global binding, bindings.ts). */
export function openInitiativeLinkPicker(agentId: string): boolean {
    if (document.querySelector(linkChipSelector(agentId)) == null) {
        return false;
    }
    globalStore.set(initiativeLinkPickerAtom, agentId);
    return true;
}
