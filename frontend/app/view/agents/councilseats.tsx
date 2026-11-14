// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The seats of a council in the Discussion's header row: one button, the seats' avatars stacked (a dot on each one at
// work, waiting or failed; the others dimmed while one seat is the filter), two of them, the lit ones first
// (stackSeats), then +N. A hover or a click opens the whole list under it: each seat a row with its name, its kind, what it is
// doing and its count of messages. A click on a row shows that seat's messages alone in the channel and its ideas alone in
// the Ideas rail, a click on it again shows everyone; an agent's row holds a button for its terminal and, on every row, a
// Timeline button that swaps the popover's body for that seat's timeline (counciltimeline.tsx), with Back to the list. The
// popover opens whenever councilTimelineAtom is set (a Timeline button, an expert card on the Map or in the Discussion)
// and clears it when it closes. A failed seat's Retry is its failure line's, in the channel (councilchat.tsx). The stack
// never scrolls or clips, so it no longer cuts a seat in half at a narrow pane.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingFocusManager,
    FloatingPortal,
    offset,
    safePolygon,
    shift,
    useClick,
    useDismiss,
    useFloating,
    useHover,
    useInteractions,
} from "@floating-ui/react";
import { useAtom } from "jotai";
import { Bot, ChevronDown, History } from "lucide-react";
import { useEffect, useState } from "react";
import { CouncilAvatar } from "./councilchat";
import { seatChips, stackSeats, type SeatChip } from "./councilchatmodel";
import { mapWords } from "./councilmapmodel";
import { councilOnlyAtom, councilTimelineAtom } from "./councilstore";
import { CouncilTimeline } from "./counciltimeline";

export const SEAT_DOT: Record<SeatChip["dot"], string> = {
    working: "bg-working pulse-dot",
    waiting: "bg-asking",
    failed: "bg-error",
    idle: "bg-ink-faint",
};

// how many avatars the stack shows before +N: the whole list is a hover away
const STACK = 2;

const PLUS =
    "-ml-[5px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-surface-raised px-[5px] text-[10px] font-semibold tabular-nums text-muted ring-2 ring-surface";

function avatarDot(dot: SeatChip["dot"]): "working" | "waiting" | "failed" | null {
    return dot === "idle" ? null : dot;
}

// the elements that ask for a seat's timeline (an expert card on the Map or the Discussion) mark themselves with this: a
// press on one is not "outside", or the popover would close on the press and open again on the click
const TIMELINE_TRIGGER = "data-council-timeline-trigger";

export function CouncilSeats({ c, onOpenTerminal }: { c: Council; onOpenTerminal: (tab: string) => void }) {
    const [only, setOnly] = useAtom(councilOnlyAtom(c.id));
    const [timeline, setTimeline] = useAtom(councilTimelineAtom(c.id));
    const [open, setOpen] = useState(false);
    const chips = seatChips(c);
    const words = mapWords(c);
    const onlyChip = only != null ? chips.find((chip) => chip.id === only) : undefined;
    const timelineChip = timeline != null ? chips.find((chip) => chip.id === timeline) : undefined;

    // the popover opens whenever a seat's timeline is asked for (a Timeline button below, an expert card), and clearing the
    // atom when it closes keeps a closed popover from reopening on the next render
    useEffect(() => {
        if (timeline != null) {
            setOpen(true);
        }
    }, [timeline]);
    // the atom outlives this view: it is let go when the view leaves, so a council opened again does not open on a timeline
    useEffect(() => () => setTimeline(null), [setTimeline]);
    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) {
            setTimeline(null);
        }
    };

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange,
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    // a hover opens it and leaving closes it; a click keeps it open (stickIfOpen) until a click outside or Escape. A timeline
    // is asked for, not hovered: while one shows, leaving the popover does not close it
    const { getReferenceProps, getFloatingProps } = useInteractions([
        useHover(context, { enabled: timeline == null, delay: { open: 80, close: 60 }, handleClose: safePolygon() }),
        useClick(context),
        useDismiss(context, {
            outsidePress: (event) =>
                !(event.target instanceof Element && event.target.closest(`[${TIMELINE_TRIGGER}]`)),
        }),
    ]);

    const label = onlyChip
        ? `Seats: showing ${onlyChip.name}'s messages alone. Open the list to pick another seat or everyone`
        : `Seats: ${chips.length}. Open the list to show one seat's messages`;

    return (
        <>
            <button
                ref={refs.setReference}
                type="button"
                data-council-seats
                data-only={only ?? undefined}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open}
                {...getReferenceProps()}
                className={cn(
                    "flex h-[30px] flex-none cursor-pointer items-center gap-[5px] rounded-md border pl-[8px] pr-[5px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    open || onlyChip ? "border-edge-mid" : "border-transparent hover:border-edge-mid"
                )}
            >
                <span className="flex items-center pl-[5px]">
                    {stackSeats(chips, STACK).map((chip) => (
                        <span
                            key={chip.id}
                            data-council-seat-avatar={chip.id}
                            className="-ml-[5px] flex rounded-full bg-surface ring-2 ring-surface"
                        >
                            <CouncilAvatar
                                tone={chip.tone}
                                name={chip.name}
                                initials={chip.initials}
                                dim={onlyChip != null && chip.id !== only}
                                dot={avatarDot(chip.dot)}
                                dotClassName="border-surface"
                            />
                        </span>
                    ))}
                    {chips.length > STACK && (
                        <span data-council-seats-more className={PLUS}>
                            +{chips.length - STACK}
                        </span>
                    )}
                </span>
                <ChevronDown size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
            </button>
            <FloatingPortal>
                {/* above ModalShell's z-[70] backdrop, like the other cockpit popovers */}
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[80]">
                    <FloatingFocusManager context={context} disabled={!open} modal={false} initialFocus={-1}>
                        <PopoverReveal
                            open={open}
                            origin="top right"
                            className={cn(
                                "flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[11px] border border-border frost shadow-popover-md",
                                // the timeline's rows hold a command and its result: wider than the list of seats
                                timelineChip != null ? "w-[440px]" : "w-[320px]"
                            )}
                        >
                            {timelineChip != null ? (
                                <CouncilTimeline c={c} chip={timelineChip} onBack={() => setTimeline(null)} />
                            ) : (
                                <>
                                    <div className="flex h-[30px] flex-none items-center justify-between px-3 pt-1">
                                        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">
                                            Seats
                                        </span>
                                        {onlyChip && (
                                            <button
                                                type="button"
                                                data-council-seats-everyone
                                                onClick={() => setOnly(null)}
                                                className="cursor-pointer rounded-[5px] border-0 bg-transparent px-1 text-[11.5px] font-semibold text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                                            >
                                                Show everyone
                                            </button>
                                        )}
                                    </div>
                                    <div
                                        role="list"
                                        data-council-seat-list
                                        aria-label="Seats: a click shows the ideas one seat wrote or replied to"
                                        className="sc flex max-h-[360px] flex-col gap-px overflow-y-auto px-[5px] pb-[5px]"
                                    >
                                        {chips.map((chip) => (
                                            <SeatRow
                                                key={chip.id}
                                                chip={chip}
                                                on={chip.id === only}
                                                timelineWord={words.timeline}
                                                onToggle={() => setOnly(chip.id === only ? null : chip.id)}
                                                onTimeline={() => setTimeline(chip.id)}
                                                onOpenTerminal={onOpenTerminal}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </PopoverReveal>
                    </FloatingFocusManager>
                </div>
            </FloatingPortal>
        </>
    );
}

function SeatRow({
    chip,
    on,
    timelineWord,
    onToggle,
    onTimeline,
    onOpenTerminal,
}: {
    chip: SeatChip;
    on: boolean;
    timelineWord: string;
    onToggle: () => void;
    onTimeline: () => void;
    onOpenTerminal: (tab: string) => void;
}) {
    const count = chip.ideas + chip.replies;
    const live = chip.dot !== "idle";
    return (
        <div
            role="listitem"
            data-council-expert-chip={chip.id}
            data-lit={chip.dot === "working" || chip.dot === "waiting" ? "true" : "false"}
            data-dot={chip.dot}
            title={`${chip.name} · ${chip.kind}${live ? `: ${chip.doing}` : ""}. ${chip.title}`}
            className="flex items-center gap-[2px]"
        >
            <button
                type="button"
                data-council-filter={chip.id}
                aria-pressed={on}
                aria-label={`${chip.name}, ${count} messages. ${on ? "Show everyone" : "Show only their messages"}`}
                disabled={count === 0}
                onClick={onToggle}
                className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-center gap-[10px] rounded-[7px] border-0 px-[8px] py-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default",
                    on
                        ? "bg-accentbg shadow-[inset_2px_0_0_var(--color-accent)]"
                        : "bg-transparent hover:bg-surface-hover disabled:hover:bg-transparent"
                )}
            >
                <CouncilAvatar tone={chip.tone} name={chip.name} initials={chip.initials} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="flex min-w-0 items-baseline gap-[6px]">
                        <span className="truncate text-[12.5px] font-semibold text-primary">{chip.name}</span>
                        <span className="flex-none text-[11px] text-ink-faint">{chip.kind}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] text-muted">
                        {live && (
                            <span
                                aria-hidden
                                className={cn("h-[6px] w-[6px] flex-none rounded-full", SEAT_DOT[chip.dot])}
                            />
                        )}
                        <span data-council-seat-doing className="min-w-0 truncate">
                            {chip.doing}
                        </span>
                    </span>
                </span>
                <span
                    className={cn(
                        "flex-none text-[12px] tabular-nums",
                        count > 0 ? "text-secondary" : "text-ink-faint"
                    )}
                >
                    {count}
                </span>
            </button>
            <button
                type="button"
                data-council-chip-timeline={chip.id}
                aria-label={`${timelineWord}: ${chip.name}`}
                title={`${timelineWord}: ${chip.name}`}
                onClick={onTimeline}
                className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <History size={15} strokeWidth={1.8} aria-hidden />
            </button>
            {chip.agent && (
                <button
                    type="button"
                    data-council-chip-open={chip.tab}
                    aria-label={`Go to ${chip.name}`}
                    title={`Go to ${chip.name}`}
                    onClick={() => onOpenTerminal(chip.tab)}
                    className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {/* the agent itself, not a terminal: Bot is the tree's mark for an agent */}
                    <Bot size={15} strokeWidth={1.8} aria-hidden />
                </button>
            )}
        </div>
    );
}
