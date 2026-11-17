// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Which of the agent header's view buttons sit in the header itself (Settings → Appearance → Agent header): Split,
// Float and Fullscreen. One turned off is still in the header's More (⋯) menu, so nothing is lost, only moved. Split
// and Fullscreen are off by default, which keeps the header to More, Float and Close; a narrow header folds all three
// into More whatever these say.

export const HEADER_BUTTONS = ["split", "float", "fullscreen"] as const;
export type HeaderButton = (typeof HEADER_BUTTONS)[number];
export type HeaderButtons = Record<HeaderButton, boolean>;

export const DEFAULT_HEADER_BUTTONS: HeaderButtons = { split: false, float: true, fullscreen: false };

/** Pure: a stored value read back; a button that is missing or not a boolean takes its default. */
export function headerButtonsOf(raw: unknown): HeaderButtons {
    const src = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const out = { ...DEFAULT_HEADER_BUTTONS };
    for (const b of HEADER_BUTTONS) {
        if (typeof src[b] === "boolean") {
            out[b] = src[b] as boolean;
        }
    }
    return out;
}

/** Pure: whether a button shows in the header (true) or only in More: off in the settings, or a narrow header. */
export function inHeader(buttons: HeaderButtons, b: HeaderButton, folded: boolean): boolean {
    return !folded && buttons[b];
}

/** The Settings row of each button: its id, title and what it does. */
export const HEADER_BUTTON_ROWS: { button: HeaderButton; id: string; title: string; desc: string }[] = [
    {
        button: "split",
        id: "appearance.headersplit",
        title: "Split",
        desc: "Show another agent beside this one. Off keeps it in the header's More (⋯) menu.",
    },
    {
        button: "float",
        id: "appearance.headerfloat",
        title: "Float window",
        desc: "Float the agent in a window of its own. Off keeps it in the header's More (⋯) menu.",
    },
    {
        button: "fullscreen",
        id: "appearance.headerfullscreen",
        title: "Fullscreen",
        desc: "Fill the window with the agent's terminal. Off keeps it in the header's More (⋯) menu.",
    },
];
