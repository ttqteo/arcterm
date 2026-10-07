// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";
import { useEffect } from "react";
import type { Binding } from "./types";

// The live union of all currently-active bindings. Read by the dispatcher, which-key bar, and cheat sheet.
export const bindingsAtom = atom<Binding[]>([]);

export function registerBindings(bindings: Binding[]): void {
    globalStore.set(bindingsAtom, [...globalStore.get(bindingsAtom), ...bindings]);
}

export function unregisterBindings(bindings: Binding[]): void {
    const removing = new Set(bindings);
    globalStore.set(
        bindingsAtom,
        globalStore.get(bindingsAtom).filter((b) => !removing.has(b))
    );
}

// Register a stable array of bindings for the lifetime of the calling component.
// Pass a memoized array (useMemo) so it is not re-registered every render.
export function useKeybindings(bindings: Binding[]): void {
    useEffect(() => {
        registerBindings(bindings);
        return () => unregisterBindings(bindings);
    }, [bindings]);
}

// The keys of the registered binding with this id, or undefined while none is registered: what a control's shortcut
// hint reads, so it can never name a key the binding no longer has.
export function useBindingKeys(id: string): string | undefined {
    return useAtomValue(bindingsAtom).find((b) => b.id === id)?.keys;
}
