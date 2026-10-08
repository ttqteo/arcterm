// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Focus handoff for ModalShell. A modal that never takes focus is not keyboard-operable: the close-agent
// confirm dialog opened over a focused xterm (double Ctrl+C), and xterm's own keydown handler calls
// stopPropagation() on Enter and Escape, so the dialog's window-level listeners never ran — and the
// keystroke was forwarded to the live agent shell instead. Taking focus fixes both halves.
//
// It must not steal focus from a child that already claimed it (an autoFocus'd input), and it must hand
// focus back on close so the terminal is live again without a click.

export function focusTrapTarget(
    focusables: HTMLElement[],
    active: Element | null,
    reverse: boolean
): HTMLElement | null {
    if (focusables.length === 0) {
        return null;
    }
    const index = active == null ? -1 : focusables.indexOf(active as HTMLElement);
    if (index < 0) {
        return reverse ? focusables[focusables.length - 1] : focusables[0];
    }
    const next = reverse ? index - 1 : index + 1;
    return focusables[(next + focusables.length) % focusables.length];
}

export function takeModalFocus(panel: HTMLElement | null, previous: HTMLElement | null): () => void {
    if (panel != null && !panel.contains(previous)) {
        panel.focus();
    }
    return () => {
        // a confirmed close tears down what had focus; refocusing a detached node would silently
        // land focus on <body> instead of leaving it where the browser already put it. A hidden one
        // (the Agent surface's xterm after a palette pick navigated away) cannot take focus either.
        if (previous?.isConnected && previous.checkVisibility()) {
            previous.focus();
            return;
        }
        // with nowhere to hand focus back, don't leave it in this panel: it outlives the close through
        // the exit animation, and a surface mounting in the same commit cannot claim focus past it
        const active = document.activeElement as HTMLElement | null;
        if (panel?.contains(active)) {
            active.blur();
        }
    };
}

// Whether an Escape is the shell's to act on. A popover portaled out of the panel (a route picker's menu, with focus
// in its search box) closes itself on Escape, and the dialog under it must stay. With nothing focused (<body>), or an
// Escape dispatched on document or window (no element at all, as the CDP scenarios close dialogs), the Escape is the
// shell's: no popover can own it.
export function shellOwnsEscape(
    panel: { contains(node: Node | null): boolean } | null,
    target: EventTarget | null,
    body: EventTarget | null
): boolean {
    if (panel == null || target == null || target === body || (target as Partial<Node>).nodeType !== 1) {
        return true;
    }
    return panel.contains(target as Node);
}
