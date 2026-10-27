// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one-time strip at the top of the brainstorm pane that says how to use it, on one row. Shown until it is
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
            className="mx-[22px] my-[8px] flex flex-none items-start gap-[10px] rounded-[6px] border border-edge-mid bg-surface-raised px-[12px] py-[5px]"
        >
            <span className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-accent" aria-hidden />
            {/* the parts wrap whole onto a second row when the pane is narrow */}
            <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-x-[8px] gap-y-[2px] p-0 text-[12px] leading-[18px] text-secondary">
                {HINT_LINES.map((line, i) => (
                    <li key={line} className="min-w-0">
                        {i > 0 ? (
                            <span className="mr-[8px] text-muted" aria-hidden>
                                ·
                            </span>
                        ) : null}
                        {line}
                    </li>
                ))}
            </ul>
            <button
                type="button"
                data-brainstorm-hints-dismiss
                onClick={dismiss}
                title="Got it, don't show this again"
                aria-label="Got it, don't show this again"
                className="flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <X size={13} strokeWidth={2} aria-hidden />
            </button>
        </div>
    );
}
