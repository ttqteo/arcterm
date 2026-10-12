// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which open modal owns the keyboard. Every ModalShell attaches its own window keydown listener, so
// without this they all fire at once — briefpeekview.tsx documents the consequence: a confirm over a
// peek, and one Escape dismisses both. Last opened wins, which is what "topmost" means for overlays
// that stack in mount order.
//
// The ordering is pure so it is testable; only the holder is module state, and it is read at event
// time rather than captured, so a listener never acts on a stale stack.

export function pushId(stack: string[], id: string): string[] {
    return stack.includes(id) ? stack : [...stack, id];
}

export function popId(stack: string[], id: string): string[] {
    return stack.filter((entry) => entry !== id);
}

export function topId(stack: string[]): string | null {
    return stack.length === 0 ? null : stack[stack.length - 1];
}

let openStack: string[] = [];
const openSheets = new Set<string>();

/** Registers an open modal and returns its unregister. Call from an effect gated on `open`. */
export function registerModal(id: string, variant: "dialog" | "sheet" = "dialog"): () => void {
    openStack = pushId(openStack, id);
    if (variant === "sheet") {
        openSheets.add(id);
    }
    return () => {
        openStack = popId(openStack, id);
        openSheets.delete(id);
    };
}

/** Pure: whether a shell may take focus on open or restore it on close — only the topmost may. */
export function ownsFocus(stack: string[], id: string): boolean {
    return topId(stack) === id;
}

/** Whether any shell is open: an open shell's own listener closes it on Escape. */
export function anyModalOpen(): boolean {
    return openStack.length > 0;
}

/** Whether a dialog is open. A sheet is scoped to its surface and leaves it switchable (modalshell.tsx), so the
 *  surface's keys stay live under it. */
export function anyDialogOpen(): boolean {
    return openStack.some((id) => !openSheets.has(id));
}

export function isTopModal(id: string): boolean {
    return ownsFocus(openStack, id);
}
