// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The shortcut a button carries inside it, as the app bar's search shows ⌘P: the chord of a registered binding,
// looked up by id (keybindings/store.ts useBindingKeys), drawn by the platform-aware formatter. Renders nothing while
// the binding is not registered. The colour is the caller's, since it sits on both the accent and a raised surface.

import { useBindingKeys } from "@/app/store/keybindings/store";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";

export function ShortcutHint({ id, className }: { id: string; className?: string }) {
    const keys = useBindingKeys(id);
    if (keys == null) {
        return null;
    }
    return (
        <kbd className={cn("rounded-[5px] border px-1.5 py-0.5 font-mono text-[11px] font-normal", className)}>
            {formatChordString(keys)}
        </kbd>
    );
}
