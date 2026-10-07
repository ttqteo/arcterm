// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Whether the peek key is held, so a link that would open a target can show it peeks instead (the [data-peek] rule in
// tailwindsetup.css, and the footer's lit peek chip). cockpit-root.tsx feeds window key and blur events through
// nextCtrlHeld. The peek key is Ctrl, and Command on a Mac, where Control+click is the right click.

import { isMacOS } from "@/util/platformutil";
import { atom, type PrimitiveAtom } from "jotai";

export const ctrlHeldAtom = atom(false) as PrimitiveAtom<boolean>;

export type CtrlEvent = { type: string; key?: string };

// blur clears it: the key released while another window has focus sends this one no keyup, and the flag would
// otherwise stay set, with every link underlined, until the next press
export function nextCtrlHeld(held: boolean, ev: CtrlEvent): boolean {
    if (ev.type === "blur") {
        return false;
    }
    if (ev.key !== (isMacOS() ? "Meta" : "Control")) {
        return held;
    }
    return ev.type === "keydown";
}

// Whether a click asks for a peek rather than an open.
export function isPeekGesture(e: { ctrlKey: boolean; metaKey?: boolean } | undefined): boolean {
    if (e == null) {
        return false;
    }
    return isMacOS() ? !!e.metaKey : e.ctrlKey;
}

// The peek click as the footer and the cheat sheet name it.
export function peekClickLabel(): string {
    return isMacOS() ? "⌘-click" : "ctrl+click";
}
