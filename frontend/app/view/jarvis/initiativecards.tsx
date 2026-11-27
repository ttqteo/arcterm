// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pinned initiative cards at the top of the Brief's Initiatives region
// (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md decision 3, board Main.dc.html). Presentational: the faces
// come from briefcards.ts and every action is a prop, wired by briefsurface.tsx.

import { springPop } from "@/app/element/motiontokens";
import { usePartMotion, useSpringBatch, type BatchMotion } from "@/app/element/springbatch";
import { cn } from "@/util/util";
import { Ellipsis, Pin } from "lucide-react";
import { AnimatePresence, motion, type TargetAndTransition, type Variants } from "motion/react";
import type { ReactNode } from "react";
import type { InitiativeFace, StatusTone } from "./briefcards";
import { SegmentBar } from "./briefrowviews";
import { CURSOR_RING, cursorAttrs } from "./briefstyle";
import type { ChunkPriority, PriorityCount } from "./chunkorder";

export const STATUS_TEXT: Record<StatusTone, string> = {
    ok: "text-success",
    asking: "text-asking",
    faint: "text-ink-faint",
    muted: "text-muted",
};

export const NOTE_LABEL_TEXT: Record<NonNullable<InitiativeFace["noteLabel"]>, string> = {
    Next: "text-accent",
    "Blocked on": "text-asking",
    Done: "text-success",
};

// A level's badge wears the tone the chunk's own level word has in the tracker (priorityBadge): critical red on its
// tint, high the bright ink, the rest fading down the scale
const PRIORITY_PILL: Record<ChunkPriority, string> = {
    critical: "border-error/40 bg-errorbg text-error font-semibold",
    high: "border-edge-strong bg-pill text-ink-hi font-semibold",
    medium: "border-edge-mid bg-pill text-ink-mid",
    low: "border-edge-mid text-muted",
    information: "border-edge-mid text-ink-faint",
};

const PRIORITY_WORD: Record<ChunkPriority, string> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
    information: "info",
};

// "1 critical  4 high …": how many open chunks carry each level, so the levels show without opening the initiative
export function PriorityBadges({ counts, className }: { counts: PriorityCount[]; className?: string }) {
    if (counts.length === 0) {
        return null;
    }
    const said = counts.map((c) => `${c.n} ${c.level}`).join(", ");
    return (
        <span
            data-jarvis-initiative-priorities={said}
            title={`Open chunks: ${said}`}
            className={cn("flex flex-none items-center gap-1", className)}
        >
            {counts.map((c) => (
                <span
                    key={c.level}
                    data-priority={c.level}
                    className={cn(
                        "whitespace-nowrap rounded-[4px] border px-1 text-[10px] leading-[15px] tabular-nums",
                        PRIORITY_PILL[c.level]
                    )}
                >
                    {c.n} {PRIORITY_WORD[c.level]}
                </span>
            ))}
        </span>
    );
}

// the page cursor and the initiative open in the sheet. The cursor is the Brief's ring; the opened one keeps an
// accent outline so it is found again under the dimmed page.
export const OPENED_OUTLINE = "border-accent ring-1 ring-accent";

export type InitiativeActions = {
    onOpen: (oref: string) => void;
    // Ctrl or Cmd on a click peeks the initiative in place of opening it, as on every Brief row
    onPeek?: (oref: string, e: React.MouseEvent) => void;
    onWork?: (oref: string) => void;
    onMenu?: (oref: string, e: React.MouseEvent) => void;
    onPin: (oref: string) => void;
};

// a click opens, Ctrl or Cmd peeks
export function openOrPeekClick(face: InitiativeFace, actions: InitiativeActions) {
    return (e: React.MouseEvent) => {
        if ((e.ctrlKey || e.metaKey) && actions.onPeek != null) {
            actions.onPeek(face.oref, e);
            return;
        }
        actions.onOpen(face.oref);
    };
}

// The pin glyph: filled on a pinned initiative (a click unpins it), an outline on hover or under the cursor otherwise
export function PinButton({
    face,
    shown,
    onPin,
    className,
}: {
    face: InitiativeFace;
    // always shown, not only on hover: the row is under the cursor
    shown: boolean;
    onPin: (oref: string) => void;
    className?: string;
}) {
    const label = face.pinned ? `Unpin ${face.title}` : `Pin ${face.title} to the top`;
    return (
        <button
            type="button"
            data-jarvis-pin={face.pinned ? "pinned" : "unpinned"}
            title={face.pinned ? "Unpin (p)" : "Pin to the top (p)"}
            aria-label={label}
            aria-pressed={face.pinned}
            onClick={(e) => {
                e.stopPropagation();
                onPin(face.oref);
            }}
            className={cn(
                "flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-ink-hi focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                face.pinned || shown ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                className
            )}
        >
            <Pin size={14} aria-hidden fill={face.pinned ? "currentColor" : "none"} />
        </button>
    );
}

export function MoreMenuButton({
    face,
    onMenu,
}: {
    face: InitiativeFace;
    onMenu: (oref: string, e: React.MouseEvent) => void;
}) {
    return (
        <button
            type="button"
            data-jarvis-initiative-menu
            title="Pin, rename, edit, pause, archive, link or delete"
            aria-label={`Actions for ${face.title}`}
            onClick={(e) => {
                e.stopPropagation();
                onMenu(face.oref, e);
            }}
            className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <Ellipsis size={15} aria-hidden />
        </button>
    );
}

function WorkButton({ face, onWork }: { face: InitiativeFace; onWork: (oref: string) => void }) {
    const go = face.action === "go";
    return (
        <button
            type="button"
            data-jarvis-work-on={face.action}
            title={go ? "Go to the agent open on this initiative (w)" : "Work on this in a new agent (w)"}
            onClick={(e) => {
                e.stopPropagation();
                onWork(face.oref);
            }}
            className="flex h-[26px] flex-none cursor-pointer items-center gap-1.5 rounded-[6px] border border-edge-strong bg-surface px-[9px] text-[11.5px] font-semibold text-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            {go ? "Go to agent" : "Work on"}
            <kbd className="rounded-[3px] border border-edge-strong px-[3px] font-mono text-[10px] font-normal leading-[14px] text-muted">
                w
            </kbd>
        </button>
    );
}

// springPop for a card in the grid: a card pinned or unpinned one at a time pops in and out on the spring. A leaving card
// reads `custom`, the batch the grid was in on the render that removed it (its own props are the last it drew): a batch
// leaves at once. The card pops from where it is: the grid's cells reflow when it goes, as they do for any change.
const cardPop: Variants = {
    initial: springPop.initial,
    animate: springPop.animate,
    exit: (batch?: BatchMotion) =>
        batch === "instant"
            ? { ...(springPop.exit as TargetAndTransition), transition: { duration: 0 } }
            : (springPop.exit as TargetAndTransition),
};

function InitiativeCard({
    face,
    focused,
    opened,
    batch,
    actions,
}: {
    face: InitiativeFace;
    focused: boolean;
    opened: boolean;
    batch: BatchMotion;
    actions: InitiativeActions;
}) {
    const { onMenu, onWork } = actions;
    const part = usePartMotion(cardPop);
    return (
        <motion.div
            {...part}
            initial={batch === "instant" ? false : part.initial}
            custom={batch}
            role="button"
            tabIndex={-1}
            aria-label={`Open ${face.title}`}
            data-jarvis-card={face.oref}
            data-jarvis-card-opened={opened ? "true" : undefined}
            {...cursorAttrs(focused)}
            onClick={openOrPeekClick(face, actions)}
            onContextMenu={
                onMenu != null
                    ? (e) => {
                          e.preventDefault();
                          onMenu(face.oref, e);
                      }
                    : undefined
            }
            className={cn(
                "group flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-[10px] border border-edge-mid bg-surface-raised px-3.5 pb-3 pt-3.5 hover:border-edge-strong",
                focused && CURSOR_RING,
                opened && OPENED_OUTLINE
            )}
        >
            <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span
                        data-jarvis-card-title
                        title={face.title}
                        className="line-clamp-2 text-[14px] font-semibold leading-[19px] text-primary"
                    >
                        {face.title}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
                        {face.moved ? (
                            <span
                                aria-label="Changed since you opened Jarvis"
                                title="Changed since you opened Jarvis"
                                data-jarvis-initiative-moved
                                className="size-1.5 flex-none self-center rounded-full bg-accent"
                            />
                        ) : null}
                        <span className="truncate">{face.meta}</span>
                    </span>
                </div>
                <PinButton face={face} shown={focused} onPin={actions.onPin} className="-mr-1 -mt-0.5" />
            </div>
            <div className="flex items-baseline gap-2">
                {face.hasProgress ? (
                    <>
                        <span className="text-[20px] font-semibold tabular-nums text-primary">
                            {face.done}
                            <span className="text-ink-faint">/{face.total}</span>
                        </span>
                        <span className="text-[11.5px] tabular-nums text-muted">{face.pct}</span>
                    </>
                ) : (
                    // a pinned topic: its sub-initiatives hold the work, so there is no count of its own
                    <span className="text-[20px] font-semibold text-ink-faint">Topic</span>
                )}
                <PriorityBadges counts={face.priorities} className="ml-1 self-center" />
                <span className="flex-1" />
                <span
                    data-jarvis-card-status
                    className={cn("truncate text-[11px] font-semibold", STATUS_TEXT[face.status.tone])}
                >
                    {face.status.text}
                </span>
            </div>
            <SegmentBar segments={face.segments} />
            <div className="flex min-h-[44px] flex-col gap-[3px]">
                {face.noteLabel != null ? (
                    <>
                        <span className={cn("text-[10.5px] font-semibold", NOTE_LABEL_TEXT[face.noteLabel])}>
                            {face.noteLabel}
                        </span>
                        <span title={face.note} className="line-clamp-2 text-[12.5px] leading-[17px] text-secondary">
                            {face.note}
                        </span>
                    </>
                ) : (
                    <span className="text-[12px] text-ink-faint">No open chunk.</span>
                )}
            </div>
            <div className="flex items-center gap-2">
                {face.action != null && onWork != null ? <WorkButton face={face} onWork={onWork} /> : null}
                <span className="flex-1" />
                {onMenu != null ? <MoreMenuButton face={face} onMenu={onMenu} /> : null}
            </div>
        </motion.div>
    );
}

// the empty slot after one to five pins: a quiet place, not a button, saying where the next card comes from
function PinSlot() {
    return (
        <div
            data-jarvis-pin-slot
            className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-edge-mid px-4 text-center"
        >
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-faint">
                <Pin size={13} aria-hidden />
                Pin an initiative
            </span>
            <span className="text-[11px] text-ink-faint">with its pin in the list, or p</span>
        </div>
    );
}

export function InitiativeCards({
    faces,
    heading,
    pinSlot,
    review,
    filter,
    cursor,
    opened,
    ...actions
}: {
    faces: InitiativeFace[];
    // what chose the cards (the search): a card arriving or leaving alone springs, a new filter or three or more at once
    // shows at once (springbatch.ts)
    filter: string;
    // "Pinned N of M" (pinnedHeading)
    heading: string;
    // close the grid with the "Pin an initiative" slot (showPinSlot)
    pinSlot: boolean;
    // the heading's right end: Review · N
    review?: ReactNode;
    // the oref under the page cursor
    cursor?: string | null;
    // the oref open in the sheet
    opened?: string | null;
} & InitiativeActions) {
    const batch = useSpringBatch(
        faces.map((f) => f.oref),
        filter
    );
    return (
        <div data-jarvis-cards className="flex min-w-0 flex-col gap-3">
            <div data-jarvis-cards-heading className="flex min-h-6 items-center gap-2.5">
                <span className="text-[15px] font-semibold text-primary">Initiatives</span>
                <span data-jarvis-cards-count className="text-[11.5px] tabular-nums text-muted">
                    {heading}
                </span>
                <span className="flex-1" />
                {review}
            </div>
            {faces.length > 0 ? (
                // two columns until the Brief (the @container in briefsurface.tsx) is about as wide as a 1280px window
                <div data-jarvis-cards-grid className="grid grid-cols-2 gap-3 @min-[1180px]:grid-cols-3">
                    <AnimatePresence initial={false} custom={batch}>
                        {faces.map((f) => (
                            <InitiativeCard
                                key={f.oref}
                                face={f}
                                focused={cursor === f.oref}
                                opened={opened === f.oref}
                                batch={batch}
                                actions={actions}
                            />
                        ))}
                    </AnimatePresence>
                    {pinSlot ? <PinSlot /> : null}
                </div>
            ) : null}
        </div>
    );
}
