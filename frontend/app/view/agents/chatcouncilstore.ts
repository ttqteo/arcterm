// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The councils Chat's cards read (docs/superpowers/specs/2026-11-14-chat-council-design.md, Builder decisions 2 and 3).
// The conversation names a council by its start call, so only the anchored ids are loaded: each once through
// councilstore.ts's `loadCouncil`, then read from the `councilAtom` it keeps current on `council:changed`. No second fetch
// path, no polling. This file also holds the in-memory memory of which councils this app session saw ended, the part of
// "has ended once" (chatcouncil.ts `councilEndedOnce`) that no council record carries.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import { canRemoveCouncil } from "./councilmodel";
import { councilAtom, loadCouncil } from "./councilstore";

/** The ids of the councils this app session saw in an ended state (done, stopped, failed, not run), so one resumed since
 *  (a stopped or failed council run again, which carries no summary) stays a row at its call. Lives for the app session:
 *  after a restart a council stopped and then resumed returns to the end of the conversation until it ends again. */
export const councilsEndedOnceAtom = atom<ReadonlySet<string>>(new Set<string>()) as PrimitiveAtom<ReadonlySet<string>>;

/** The councils this app session saw ended, for `councilEndedOnce`'s `seenEnded`. */
export function useCouncilsEndedOnce(): ReadonlySet<string> {
    return useAtomValue(councilsEndedOnceAtom);
}

/** Reads the councils a conversation's `councilstart` parts name, by id: the council, or null while it is not loaded (or is
 *  gone). Loads each id once, the first time it is named, and keeps the councils it sees ended in `councilsEndedOnceAtom`. */
export function useChatCouncils(ids: readonly string[]): ReadonlyMap<string, Council | null> {
    const key = ids.join("\n");
    const list = useMemo(() => (key === "" ? [] : key.split("\n")), [key]);
    const read = useMemo(
        () => atom((get) => new Map(list.map((id): [string, Council | null] => [id, get(councilAtom(id))]))),
        [list]
    );
    const councils = useAtomValue(read);
    const loaded = useRef(new Set<string>());
    useEffect(() => {
        for (const id of list) {
            if (!loaded.current.has(id)) {
                loaded.current.add(id);
                void loadCouncil(id);
            }
        }
    }, [list]);
    useEffect(() => {
        const seen = globalStore.get(councilsEndedOnceAtom);
        const ended = [...councils].filter(([id, c]) => c != null && canRemoveCouncil(c) && !seen.has(id));
        if (ended.length > 0) {
            globalStore.set(councilsEndedOnceAtom, new Set([...seen, ...ended.map(([id]) => id)]));
        }
    }, [councils]);
    return councils;
}
