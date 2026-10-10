// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The creature's speech. One bubble, anchored to whichever corner the creature is sitting in, gone after
// a few seconds (design §4 decision 8): a bubble that persists until acknowledged is the thing you come
// to resent over a live terminal. Auto-dismiss loses nothing — the peek reads back everything it said,
// and the creature keeps an unread marker until you look.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { InlineMarkdown } from "@/app/view/agents/inlinemarkdown";
import { cn } from "@/util/util";
import { autoUpdate, offset, shift, useFloating, type Placement } from "@floating-ui/react";
import { useEffect, useRef, useState } from "react";
import type { PetCorner } from "./petledge";
import { bubbleMs, bubbleText, eventLabel, type NotifyLevel, type PetEvent } from "./petvoice";

// speak away from the edge the creature is pinned to, aligned with it
const PLACEMENT: Record<PetCorner, Placement> = {
    "bottom-right": "top-end",
    "bottom-left": "top-start",
};

// the corner a bubble grows from: its edge on the anchor's side, at the aligned end
function originOf(p: Placement): string {
    const [side, align] = p.split("-");
    return `${side === "top" ? "bottom" : "top"} ${align === "start" ? "left" : "right"}`;
}

// Only a notification's level and a question get a dot, because those are the ones asking for something.
// Accent stays reserved for things you can act on, so every other label reads muted.
const LEVEL_TONE: Record<NotifyLevel, { dot: string; label: string }> = {
    info: { dot: "bg-edge-strong", label: "text-muted" },
    warn: { dot: "bg-warning", label: "text-warning-soft" },
    error: { dot: "bg-error", label: "text-error-soft" },
};

export function eventTone(event: PetEvent): { dot: string | null; label: string } {
    if (event.kind === "notify") {
        return LEVEL_TONE[event.level ?? "info"];
    }
    return { dot: event.kind === "ask" ? "bg-accent" : null, label: "text-muted" };
}

// the register as a label: the dot (when the kind earns one) and the words, one grammar for bubble and peek
export function EventLabel({ event, className }: { event: PetEvent; className?: string }) {
    const tone = eventTone(event);
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 font-semibold uppercase tracking-[.09em]",
                tone.label,
                className
            )}
        >
            {tone.dot != null ? <span className={cn("h-1.5 w-1.5 flex-none rounded-full", tone.dot)} /> : null}
            {eventLabel(event)}
        </span>
    );
}

export function PetBubble({
    event,
    anchor,
    corner,
    placement,
    flat,
    onOpen,
    onDismiss,
}: {
    event: PetEvent | null;
    anchor: HTMLElement | null;
    corner: PetCorner;
    // folded (cockpit/sprout-mini.tsx): which way from Sprout it opens, and no drop shadow over the app behind
    placement?: Placement;
    flat?: boolean;
    onOpen: () => void;
    onDismiss: () => void;
}) {
    // the exit animation still needs something to draw after `event` clears, so the last utterance is
    // latched rather than read live
    const [said, setSaid] = useState<PetEvent | null>(null);
    useEffect(() => {
        if (event != null) {
            setSaid(event);
        }
    }, [event]);

    // held in a ref, not in the dep list: the creature re-renders on every nowAtom tick, and a callback
    // identity in the deps would restart this timer each second so the bubble never dismissed.
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;
    const id = event?.id;
    const ms = event != null ? bubbleMs(event) : 0;
    // a bubble under the pointer is being read: it stays, and gets its full time again once the pointer leaves. Kept
    // by id, so a pointer that never left a bubble (it closed under it) cannot hold the next one open.
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const hovered = id != null && hoveredId === id;
    useEffect(() => {
        if (id == null || hovered) {
            return;
        }
        const t = setTimeout(() => dismissRef.current(), ms);
        return () => clearTimeout(t);
    }, [id, ms, hovered]);

    const where = placement ?? PLACEMENT[corner];
    const { refs, floatingStyles } = useFloating({
        open: event != null,
        placement: where,
        // fixed, like the creature it hangs off: the cockpit body clips its overflow, and an
        // absolutely-positioned bubble in a corner is exactly what that clip would cut in half
        strategy: "fixed",
        middleware: [offset(10), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    useEffect(() => {
        refs.setPositionReference(anchor);
    }, [anchor, refs]);

    return (
        // data-mini-hit: folded, the click-through poll lets the cursor reach it (miniclickthrough.ts)
        <div ref={refs.setFloating} data-mini-hit="bubble" style={floatingStyles} className="z-[61]">
            {/* unconditional, driven by `open` — a `{open ? … : null}` caller defeats PopoverReveal's
                AnimatePresence and the exit never plays */}
            <PopoverReveal
                open={event != null}
                origin={originOf(where)}
                className={cn(
                    "w-[268px] rounded-[12px] border bg-surface-raised has-[button:hover]:border-edge-strong",
                    flat ? "border-edge-strong" : "border-border shadow-popover-md"
                )}
            >
                {said != null ? (
                    <button
                        type="button"
                        data-pet-bubble
                        onClick={onOpen}
                        onMouseEnter={() => setHoveredId(said.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        className="flex w-full cursor-pointer flex-col gap-1.5 rounded-[12px] px-3 py-[11px] text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <EventLabel event={said} className="text-[9px]" />
                        {/* clamped: a notification title passes through verbatim and would otherwise stretch
                            the bubble. Inline only, and links as plain text — the bubble is one button. */}
                        <span
                            className={cn(
                                "text-[12px] leading-[1.45] text-secondary [overflow-wrap:anywhere]",
                                said.kind === "quote" ? "line-clamp-4" : "line-clamp-3"
                            )}
                        >
                            <InlineMarkdown text={bubbleText(said)} plainLinks />
                        </span>
                    </button>
                ) : null}
            </PopoverReveal>
        </div>
    );
}
