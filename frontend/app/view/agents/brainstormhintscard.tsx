// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one-time card at the top of the brainstorm pane that says how to use it, in four lines. Shown until it is
// dismissed; the dismissal is kept in localStorage (brainstormhints.ts), so it comes once per machine. Its own file name
// because `./brainstormhints` already resolves to the .ts beside it.

import { X } from "lucide-react";
import { useState } from "react";
import { browserHintStore, HINT_LINES, hintsSeen, markHintsSeen, shouldShowHints } from "./brainstormhints";

// A dismissal whose write failed still holds until the app is reloaded, across the pane's remounts
let dismissedThisSession = false;

export function BrainstormHints() {
    // read once per mount: a pane that opens after the dismissal reads it back from the store
    const [seen] = useState(() => hintsSeen(browserHintStore()));
    const [dismissed, setDismissed] = useState(dismissedThisSession);
    if (!shouldShowHints(seen, dismissed || dismissedThisSession)) {
        return null;
    }
    const dismiss = () => {
        dismissedThisSession = true;
        markHintsSeen(browserHintStore());
        setDismissed(true);
    };
    return (
        <div
            data-brainstorm-hints
            role="note"
            aria-label="How to use a brainstorm"
            className="mx-[22px] my-[12px] flex flex-none items-start gap-[12px] rounded-[8px] border border-edge-mid bg-surface-raised px-[14px] py-[10px]"
        >
            <span className="mt-[6px] h-[7px] w-[7px] flex-none rounded-full bg-accent" aria-hidden />
            <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-[3px] p-0 text-[12.5px] leading-[1.5] text-secondary">
                {HINT_LINES.map((line) => (
                    <li key={line}>{line}</li>
                ))}
            </ul>
            <button
                type="button"
                data-brainstorm-hints-dismiss
                onClick={dismiss}
                title="Got it, don't show this again"
                aria-label="Got it, don't show this again"
                className="flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <X size={13} strokeWidth={2} aria-hidden />
            </button>
        </div>
    );
}
