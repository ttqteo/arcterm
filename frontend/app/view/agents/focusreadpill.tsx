// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Focus read's toggle and its buttons, one pill floating in a reading pane's corner: Chat's (chatpane.tsx, each agent's
// own switch, beside Skim or under it on a narrow pane) and the File tab's markdown Preview (mddoc.tsx, one switch for every document). Turning it on
// puts the focus in the pane's scroller, so J/K step at once; while it is on, the toggle grows down into one pill with
// the size, the step buttons and (in Chat) the quote, which say their keys on their face. The pane places it (`className`).

import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { ChevronDown, ChevronUp, Quote, TextSearch } from "lucide-react";
import type { RefObject } from "react";
import { nextFocusReadSize } from "./chatfocusread";
import { chatFocusReadSizeAtom, FOCUS_READ_KEYS, focusReaderOf, type FocusReader } from "./chatfocusreadstore";

export function FocusReadPill({
    readerId,
    on,
    setOn,
    scrollRef,
    onTitle,
    offTitle,
    quote,
    className,
}: {
    /** the id the pane's useFocusRead registers its reader under */
    readerId: string;
    on: boolean;
    setOn: (next: boolean) => void;
    scrollRef: RefObject<HTMLElement | null>;
    /** the toggle's tooltip, given the key that toggles it */
    onTitle: (keys: string) => string;
    offTitle: (keys: string) => string;
    /** whether the pill has Q (Chat's quote into the box) */
    quote: boolean;
    className?: string;
}) {
    const keys = formatChordString(FOCUS_READ_KEYS);
    return (
        <div
            data-chat-focus-read-group
            className={cn(
                "absolute z-20 flex w-[26px] flex-col overflow-hidden rounded-[8px] border border-edge-mid bg-surface-raised",
                className
            )}
        >
            <button
                type="button"
                data-chat-focus-read-toggle
                aria-pressed={on}
                aria-label="Focus read"
                title={on ? onTitle(keys) : offTitle(keys)}
                onClick={() => {
                    setOn(!on);
                    if (!on) {
                        scrollRef.current?.focus({ preventScroll: true });
                    }
                }}
                className={cn(
                    "flex h-[24px] w-full cursor-pointer items-center justify-center",
                    on ? "bg-accentbg text-accent" : "text-muted hover:bg-surface-hover"
                )}
            >
                <TextSearch size={13} strokeWidth={2} aria-hidden />
            </button>
            {on ? <FocusReadSteps readerId={readerId} scrollRef={scrollRef} quote={quote} /> : null}
        </div>
    );
}

// Focus read's buttons, the lower part of its pill: how many blocks it lights at a time (×1 … ×5, a click for the next),
// the previous and next group, then past a hairline the quote, each step with its key on its face so the keys need no tooltip. A click leaves the focus in the
// scroller, so the keys go on from there.
const FOCUS_STEPS = [
    { key: "K", label: "Previous blocks (K or ↑)", Icon: ChevronUp, act: (r: FocusReader) => r.step(-1) },
    { key: "J", label: "Next blocks (J, ↓ or Space)", Icon: ChevronDown, act: (r: FocusReader) => r.step(1) },
    { key: "Q", label: "Quote the lit blocks into the box (Q)", Icon: Quote, act: (r: FocusReader) => r.quote?.() },
] as const;

function FocusReadSteps({
    readerId,
    scrollRef,
    quote,
}: {
    readerId: string;
    scrollRef: RefObject<HTMLElement | null>;
    quote: boolean;
}) {
    const [size, setSize] = useAtom(chatFocusReadSizeAtom);
    const next = nextFocusReadSize(size);
    const sizeLabel = `${size} ${size === 1 ? "block" : "blocks"} at a time (click for ${next})`;
    const steps = quote ? FOCUS_STEPS : FOCUS_STEPS.filter((s) => s.key !== "Q");
    return (
        <div data-chat-focus-read-steps className="flex flex-col border-t border-edge-mid">
            <button
                type="button"
                data-chat-focus-read-size={size}
                aria-label={sizeLabel}
                title={sizeLabel}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                    setSize(next);
                    scrollRef.current?.focus({ preventScroll: true });
                }}
                className="flex h-[24px] cursor-pointer items-center justify-center border-b border-edge-mid font-mono text-[10.5px] font-semibold text-secondary hover:bg-surface-hover hover:text-primary"
            >
                ×{size}
            </button>
            {steps.map(({ key, label, Icon, act }) => (
                <button
                    key={key}
                    type="button"
                    data-chat-focus-read-step={key.toLowerCase()}
                    aria-label={label}
                    title={label}
                    // the scroller keeps the focus: a button that took it would leave J/K with nowhere to act
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                        const reader = focusReaderOf(readerId);
                        if (reader != null) {
                            act(reader);
                        }
                        scrollRef.current?.focus({ preventScroll: true });
                    }}
                    className={cn(
                        "group flex h-[30px] cursor-pointer flex-col items-center justify-center gap-[3px] text-secondary hover:bg-surface-hover hover:text-primary",
                        key === "Q" && "border-t border-edge-mid"
                    )}
                >
                    <Icon size={12} strokeWidth={2} aria-hidden />
                    <kbd className="font-mono text-[9px] leading-none text-muted group-hover:text-secondary">{key}</kbd>
                </button>
            ))}
        </div>
    );
}
