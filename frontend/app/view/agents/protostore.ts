// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The variant picks of a clickable prototype. One owner per board, keyed by boardPicksKey (the board's URL without its
// query and hash), so the Canvas gallery's viewer and an agent's pane share what the person picked. The frame that draws
// the board posts the whole map to its iframe when it changes (protomodel.ts slotPickMessage).

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { SlotPicks } from "./protomodel";

export const slotPicksAtom = atomFamily((_key: string) => atom<SlotPicks>({}) as PrimitiveAtom<SlotPicks>);

export function setSlotPick(key: string, id: string, letter: string): void {
    const a = slotPicksAtom(key);
    const prev = globalStore.get(a);
    if (prev[id] === letter) {
        return;
    }
    globalStore.set(a, { ...prev, [id]: letter });
}
