// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a key typed on the Agent surface goes, read from the DOM: the keys' half is chattypeinto.ts. The type-into
// listener (agentsurface.tsx) and the bindings that stand down for it or stand in for them (buildAgentBindings) ask
// the same questions, so a letter is never both a shortcut and typed.

import { isEditableTarget, ownsKeys } from "@/app/store/keybindings/dispatcher";
import { chatInputOf } from "./cellinput";

function surfaceWrap(): HTMLElement | null {
    if (typeof document === "undefined" || typeof document.querySelector !== "function") {
        return null;
    }
    return document.querySelector<HTMLElement>("[data-cockpit-surface-wrap]");
}

// The agent whose chat box a character typed now goes into: the focused agent, when its cell shows Chat and the focus
// is on the Agent surface off every field (a row of the tree, the conversation) or on nothing. Null otherwise, and
// then a bare letter is a shortcut again (an agent in Terminal, a canvas or review in its place).
export function chatTypingAgent(focusId: string | null | undefined): string | null {
    const wrap = surfaceWrap();
    if (focusId == null || wrap == null) {
        return null;
    }
    const active = document.activeElement;
    if (active != null && active !== document.body && !wrap.contains(active)) {
        return null;
    }
    if (isEditableTarget(active) || ownsKeys(active)) {
        return null;
    }
    return chatInputOf(wrap, focusId) != null ? focusId : null;
}

// Whether an ⌥ chord standing in for a bare letter is live where the focus is: off every field, or in a chat box
// (where ⌥+letter would only type a symbol). Never in the terminal or another field, whose ⌥ keys are their own.
export function altChordFocusOk(): boolean {
    if (typeof document === "undefined") {
        return true;
    }
    const active = document.activeElement;
    if (!isEditableTarget(active) && !ownsKeys(active)) {
        return true;
    }
    return active?.closest?.("[data-agent-chat-composer]") != null;
}
