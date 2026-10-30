// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council chat's keyboard cursor, published while its channel is on screen and read by the council bindings in
// bindings.ts (j/k over the ideas, Enter opens one's thread, Esc closes it). The same shape as listnav.ts: the view
// owns the state and the registry only reads it, so a binding never reaches into the view.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";

export interface CouncilChatNav {
    order: readonly string[]; // the ideas j and k move over, in the order the channel draws them
    focusedId: string | null; // the idea the keyboard cursor is on
    openId: string | null; // the idea whose thread is open
    focus: (id: string) => void;
    open: (id: string) => void;
    close: () => void;
}

export const councilChatNavAtom = atom<CouncilChatNav | null>(null) as PrimitiveAtom<CouncilChatNav | null>;

/** Publishes `nav` for the caller's lifetime. Memoize it (useMemo) so the registration only churns when the ideas or the
 *  cursor change. */
export function useCouncilChatNav(nav: CouncilChatNav): void {
    useEffect(() => {
        globalStore.set(councilChatNavAtom, nav);
        return () => {
            globalStore.set(councilChatNavAtom, (prev) => (prev === nav ? null : prev));
        };
    }, [nav]);
}
