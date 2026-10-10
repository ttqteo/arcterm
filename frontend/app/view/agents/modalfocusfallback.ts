// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Where focus goes when a dialog closes over the Agent surface and cannot hand it back (modalfocus.ts), rather than
// <body>, where no key reaches the surface. From a terminal still in the document but hidden, a palette pick (or
// agent:split falling back to replace) put another agent in its cell: typing follows the pick to that agent's
// terminal, as focusCell's hand-off does in a grid. Otherwise (a confirmed close removed the terminal, or focus was
// never in one) the surface wrapper takes it: its keys work, and nothing types into an agent the user did not pick.
export function agentFocusFallback(
    previous: HTMLElement | null,
    pickedTerminal: HTMLElement | null,
    wrap: HTMLElement | null
): HTMLElement | null {
    const fromCell = previous?.isConnected === true && previous.closest("[data-agent-terminal]") != null;
    if (fromCell && pickedTerminal?.checkVisibility()) {
        return pickedTerminal;
    }
    return wrap;
}
