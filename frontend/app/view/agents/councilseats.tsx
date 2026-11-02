// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The seats of a council in the Discussion's header row: each is a filter (its letters, its count of messages, a dot while
// it works, waits or failed); a click shows that seat's messages alone in the chat, a click on it again shows everyone.
// What a seat is doing is on hover and in a sr-only span; an agent's seat holds a button for its terminal. A failed seat's
// Retry is its failure line's, in the chat (councilchat.tsx). On a narrow pane the strip scrolls sideways before it pushes
// the cost and Close out of the row.

import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { SquareTerminal } from "lucide-react";
import { CouncilAvatar } from "./councilchat";
import { seatChips, type SeatChip } from "./councilchatmodel";
import { councilOnlyAtom } from "./councilstore";

export const SEAT_DOT: Record<SeatChip["dot"], string> = {
    working: "bg-working pulse-dot",
    waiting: "bg-asking",
    failed: "bg-error",
    idle: "bg-ink-faint",
};

export function CouncilSeats({ c, onOpenTerminal }: { c: Council; onOpenTerminal: (tab: string) => void }) {
    const [only, setOnly] = useAtom(councilOnlyAtom(c.id));
    const chips = seatChips(c);
    return (
        <div
            role="list"
            aria-label="Seats: a click shows one seat's messages"
            className="flex min-w-0 flex-[0_1_auto] items-center gap-[2px] overflow-x-auto [scrollbar-width:none] @max-[900px]:min-w-[44px] [&::-webkit-scrollbar]:hidden"
        >
            {chips.map((chip) => {
                const on = chip.id === only;
                const count = chip.ideas + chip.replies;
                const live = chip.dot !== "idle";
                return (
                    <div
                        key={chip.id}
                        role="listitem"
                        data-council-expert-chip={chip.id}
                        data-lit={chip.dot === "working" || chip.dot === "waiting" ? "true" : "false"}
                        data-dot={chip.dot}
                        title={`${chip.name} · ${chip.kind}${live ? `: ${chip.doing}` : ""}. ${chip.title}`}
                        className="flex flex-none items-center"
                    >
                        <button
                            type="button"
                            data-council-filter={chip.id}
                            aria-pressed={on}
                            aria-label={`${chip.name}, ${count} messages. ${on ? "Show everyone" : "Show only their messages"}`}
                            disabled={count === 0}
                            onClick={() => setOnly(on ? null : chip.id)}
                            className={cn(
                                "flex h-[30px] cursor-pointer items-center gap-[5px] rounded-md border pl-1 pr-2 text-[12px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default",
                                on
                                    ? "border-edge-mid bg-surface-selected text-primary"
                                    : "border-transparent text-muted hover:bg-surface-hover disabled:hover:bg-transparent"
                            )}
                        >
                            <CouncilAvatar tone={chip.tone} name={chip.name} initials={chip.initials} />
                            {count > 0 && <span className="flex-none">{count}</span>}
                            {live && (
                                <span
                                    aria-hidden
                                    className={cn("h-[6px] w-[6px] flex-none rounded-full", SEAT_DOT[chip.dot])}
                                />
                            )}
                            <span data-council-seat-doing className="sr-only">
                                {chip.doing}
                            </span>
                        </button>
                        {chip.agent && (
                            <button
                                type="button"
                                data-council-chip-open={chip.tab}
                                aria-label={`Open the terminal of ${chip.name}`}
                                title={`Open the terminal of ${chip.name}`}
                                onClick={() => onOpenTerminal(chip.tab)}
                                className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                <SquareTerminal size={15} strokeWidth={1.8} aria-hidden />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
