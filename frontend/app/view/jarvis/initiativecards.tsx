// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pinned initiative cards at the top of the Brief's Initiatives region
// (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md decision 3, board Main.dc.html). Presentational: the faces
// come from briefcards.ts and every action is a prop, wired by briefsurface.tsx.

import { cn } from "@/util/util";
import { Ellipsis, Pin } from "lucide-react";
import type { ReactNode } from "react";
import type { InitiativeFace, StatusTone } from "./briefcards";
import { SegmentBar } from "./briefrowviews";
import { CURSOR_RING, cursorAttrs } from "./briefstyle";

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

function InitiativeCard({
    face,
    focused,
    opened,
    actions,
}: {
    face: InitiativeFace;
    focused: boolean;
    opened: boolean;
    actions: InitiativeActions;
}) {
    const { onMenu, onWork } = actions;
    return (
        <div
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
                    <span className="truncate text-[11px] text-muted">{face.meta}</span>
                </div>
                <PinButton face={face} shown={focused} onPin={actions.onPin} className="-mr-1 -mt-0.5" />
            </div>
            <div className="flex items-baseline gap-2">
                <span className="text-[20px] font-semibold tabular-nums text-primary">
                    {face.done}
                    <span className="text-ink-faint">/{face.total}</span>
                </span>
                <span className="text-[11.5px] tabular-nums text-muted">{face.pct}</span>
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
        </div>
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
    cursor,
    opened,
    ...actions
}: {
    faces: InitiativeFace[];
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
                    {faces.map((f) => (
                        <InitiativeCard
                            key={f.oref}
                            face={f}
                            focused={cursor === f.oref}
                            opened={opened === f.oref}
                            actions={actions}
                        />
                    ))}
                    {pinSlot ? <PinSlot /> : null}
                </div>
            ) : null}
        </div>
    );
}
