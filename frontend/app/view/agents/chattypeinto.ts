// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A character typed on the Agent surface with the focus off every field (a row of the tree just clicked, the
// conversation being read) goes into the focused agent's chat box when no shortcut took it, so picking a chat and typing
// needs no Tab first. This is the key's half of the check; the surface's half (its Chat on screen, no dialog, the focus
// off a field and inside the surface) is agentsurface.tsx's.

export interface TypedKey {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    isComposing: boolean;
    defaultPrevented: boolean;
}

// the character to put in the box, or null when the key is not one: a named key (Enter, ArrowDown, Process while an
// input method composes), a chord, Space (the focused control's press) or a key a shortcut or a control already took
export function typedIntoChat(e: TypedKey): string | null {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
        return null;
    }
    if ([...e.key].length !== 1 || e.key.trim() === "") {
        return null;
    }
    return e.key;
}
