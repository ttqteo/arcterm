// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The avatar popup's item view: a peeked target shown in place of the hub. The shell is the same for every
// kind (Back to Jarvis, close, Open and Focus this); the body comes from the registry and reports whether its
// target is still there. The key hints and the panel's own keys stay with petpeek.tsx, which owns the dialog.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { enterFocusFor } from "@/app/view/agents/focusstore";
import { cn, fireAndForget } from "@/util/util";
import { ChevronLeft, X } from "lucide-react";
import { openTarget } from "./openref";
import { PEEK_BODIES } from "./peek/peekregistry";
import { goneLine, itemButtons, kindNoun, openLabel, type ItemKeyCommand } from "./peekitemmodel";
import { closePeek, peekTargetKey, type PeekFacts, type PeekItem } from "./peekstore";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// what the popup does around a command: close returns focus to the avatar, back keeps it in the panel, and
// leave drops the focus return because the user is being sent somewhere
export type ItemChrome = { close: () => void; back: () => void; leave: () => void };

// Returns whether the command did anything, so a key that does nothing (Open while loading) is not consumed.
export function runItemCommand(
    model: AgentsViewModel,
    item: PeekItem,
    facts: PeekFacts | null,
    command: ItemKeyCommand,
    chrome: ItemChrome
): boolean {
    const buttons = itemButtons(item.target.kind, facts);
    switch (command) {
        case "close":
            chrome.close();
            return true;
        case "back":
            chrome.back();
            return true;
        case "open":
            if (buttons.open !== "enabled") {
                return false;
            }
            chrome.leave();
            closePeek();
            fireAndForget(() => openTarget(model, item.target));
            return true;
        case "focus":
            if (buttons.focus !== "enabled") {
                return false;
            }
            enterFocusFor(model, facts.focus);
            chrome.close();
            return true;
    }
}

// States.dc.html's loading frame: the kind is already known, so it says so while the rest is a placeholder
function LoadingBody({ item }: { item: PeekItem }) {
    return (
        <div data-pet-peek-skeleton className="flex flex-col">
            <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent-soft">
                    {kindNoun(item.target.kind)}
                </span>
                <span className="h-3 w-[170px] rounded-[4px] bg-surface-selected" />
            </div>
            <div className="flex flex-col gap-2.5 p-3.5">
                <span className="h-[9px] w-[70%] rounded-[4px] bg-surface-selected" />
                <span className="h-[9px] w-[92%] rounded-[4px] bg-surface-selected" />
                <span className="mt-1 h-10 rounded-[8px] bg-surface-hover" />
                <span className="h-[90px] rounded-[9px] bg-surface-hover" />
            </div>
        </div>
    );
}

export function PeekItemView({
    model,
    item,
    facts,
    titleId,
    onCommand,
}: {
    model: AgentsViewModel;
    item: PeekItem;
    facts: PeekFacts | null;
    titleId: string;
    onCommand: (command: ItemKeyCommand) => void;
}) {
    const kind = item.target.kind;
    const buttons = itemButtons(kind, facts);
    const Body = PEEK_BODIES[kind];
    return (
        <>
            <div data-pet-peek-header className="flex min-h-11 flex-none items-center gap-1 px-2">
                <h2 id={titleId} className="sr-only">
                    {`Peek at a ${kindNoun(kind)}`}
                </h2>
                <button
                    type="button"
                    aria-label="Back to the Jarvis card"
                    onClick={() => onCommand("back")}
                    className={cn(
                        "flex h-7 flex-none items-center gap-1 whitespace-nowrap rounded-[7px] px-2 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-primary",
                        FOCUS_RING
                    )}
                >
                    <ChevronLeft aria-hidden="true" size={12} strokeWidth={2} />
                    Jarvis
                </button>
                <span className="flex-1" />
                <button
                    type="button"
                    aria-label="Close Jarvis panel"
                    onClick={() => onCommand("close")}
                    className={cn(
                        "flex h-7 w-7 flex-none items-center justify-center rounded-[7px] text-muted hover:bg-surface-hover hover:text-primary",
                        FOCUS_RING
                    )}
                >
                    <X aria-hidden="true" size={14} strokeWidth={2} />
                </button>
            </div>

            <div data-pet-peek-body className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-border">
                {item.status === "loading" ? (
                    <LoadingBody item={item} />
                ) : facts?.gone ? (
                    <p data-pet-peek-gone className="px-3.5 py-3 text-[12px] text-muted">
                        {goneLine(kind)}
                    </p>
                ) : (
                    // keyed by target, so a peek at another item mounts a fresh body that reports for it
                    <Body key={peekTargetKey(item.target)} model={model} target={item.target} />
                )}
            </div>

            {buttons.open !== "absent" || buttons.focus !== "absent" ? (
                <div className="flex flex-none items-center gap-2 border-t border-border px-3.5 py-2.5">
                    {buttons.open !== "absent" ? (
                        <button
                            type="button"
                            data-pet-peek-open
                            disabled={buttons.open === "disabled"}
                            onClick={() => onCommand("open")}
                            className={cn(
                                "rounded-[7px] bg-accent px-[13px] py-[7px] text-[12px] font-semibold text-background hover:bg-accenthover",
                                "disabled:cursor-default disabled:opacity-35 disabled:hover:bg-accent",
                                FOCUS_RING
                            )}
                        >
                            {openLabel(kind)}
                        </button>
                    ) : null}
                    {buttons.focus !== "absent" ? (
                        <button
                            type="button"
                            data-pet-peek-focus
                            disabled={buttons.focus === "disabled"}
                            onClick={() => onCommand("focus")}
                            className={cn(
                                "rounded-[7px] border border-edge-mid bg-surface px-3 py-[7px] text-[12px] font-semibold text-secondary hover:bg-surface-hover",
                                "disabled:cursor-default disabled:opacity-50 disabled:hover:bg-surface",
                                FOCUS_RING
                            )}
                        >
                            Focus this
                        </button>
                    ) : null}
                </div>
            ) : null}
        </>
    );
}
