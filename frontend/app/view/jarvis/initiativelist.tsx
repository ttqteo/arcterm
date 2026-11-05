// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Every initiative that is not a card, as one compact list under the cards
// (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md decision 4, board Main.dc.html). Presentational: the faces
// and the window come from briefcards.ts, the project tabs are today's, passed in, and every action is a prop.

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import type { InitiativeFace } from "./briefcards";
import { SegmentBar } from "./briefrowviews";
import { CURSOR_RING, cursorAttrs } from "./briefstyle";
import {
    NOTE_LABEL_TEXT,
    OPENED_OUTLINE,
    openOrPeekClick,
    PinButton,
    STATUS_TEXT,
    type InitiativeActions,
} from "./initiativecards";

// a sub-initiative's row is indented this many px per level under the one it is part of
const NEST_INDENT = 20;

function InitiativeListRow({
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
    const { onMenu } = actions;
    // what the Next column says: the chunk named, or the status cell's word when there is none to name
    const label = face.noteLabel;
    return (
        <div
            role="button"
            tabIndex={-1}
            aria-label={`Open ${face.title}`}
            data-jarvis-initiative-row={face.oref}
            data-jarvis-initiative-depth={face.depth}
            data-jarvis-initiative-opened={opened ? "true" : undefined}
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
            style={face.depth > 0 ? { marginLeft: face.depth * NEST_INDENT } : undefined}
            className={cn(
                "group relative grid h-9 flex-none cursor-pointer grid-cols-[minmax(0,1.2fr)_120px_minmax(0,1.6fr)_54px_24px] items-center gap-3.5 rounded-[6px] border border-transparent px-2.5 hover:bg-surface-hover",
                focused && cn("bg-surface-hover", CURSOR_RING),
                opened && OPENED_OUTLINE,
                face.status.text === "paused" && "opacity-60"
            )}
        >
            {face.depth > 0 ? (
                <span
                    aria-hidden
                    data-jarvis-initiative-elbow
                    className="pointer-events-none absolute -left-3 -top-1.5 h-[22px] w-2.5 rounded-bl-[6px] border-b-[1.5px] border-l-[1.5px] border-edge-strong"
                />
            ) : null}
            <span title={face.title} className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-[12.5px] font-semibold text-ink-hi">{face.title}</span>
                <span data-jarvis-initiative-meta className="min-w-0 flex-none truncate text-[11px] text-muted">
                    · {face.meta}
                </span>
                {face.subCount > 0 ? (
                    <span data-jarvis-initiative-sub className="flex-none text-[10.5px] font-medium text-ink-mid">
                        +{face.subCount} sub
                    </span>
                ) : null}
            </span>
            <span className="flex items-center gap-2">
                <SegmentBar segments={face.segments} size="sm" className="flex-1" />
                <span className="w-[34px] flex-none text-right text-[11px] tabular-nums text-secondary">
                    {face.done}/{face.total}
                </span>
            </span>
            <span title={face.note} className="min-w-0 truncate text-[12px] text-muted">
                {label != null ? (
                    <>
                        <span className={cn("text-[10.5px] font-semibold", NOTE_LABEL_TEXT[label])}>{label} </span>
                        {face.note}
                    </>
                ) : (
                    <span className={STATUS_TEXT[face.status.tone]}>{face.status.text}</span>
                )}
            </span>
            <span data-jarvis-initiative-when className="truncate text-right text-[11px] tabular-nums text-muted">
                {face.when}
            </span>
            <PinButton face={face} shown={focused} onPin={actions.onPin} />
        </div>
    );
}

export function InitiativeList({
    faces,
    more,
    expanded,
    onToggleMore,
    tabs,
    empty,
    footer,
    cursor,
    opened,
    ...actions
}: {
    // the rows the window shows (listWindow)
    faces: InitiativeFace[];
    // the rows past the window, for "+N more"
    more: number;
    expanded: boolean;
    onToggleMore: () => void;
    // today's project tabs, beside the label
    tabs?: ReactNode;
    // drawn in the box's place when there is no row (a filter that matched nothing, no initiatives yet)
    empty?: ReactNode;
    // after "+N more" in the box's last line: Show N archived
    footer?: ReactNode;
    cursor?: string | null;
    opened?: string | null;
} & InitiativeActions) {
    const hasRows = faces.length > 0 || more > 0 || footer != null;
    return (
        <div data-jarvis-initiative-list className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="mr-1.5 text-[12.5px] font-semibold text-secondary">All initiatives</span>
                {tabs}
            </div>
            {hasRows ? (
                <div className="flex min-w-0 flex-col rounded-[8px] border border-edge-faint p-1">
                    {faces.map((f) => (
                        <InitiativeListRow
                            key={f.oref}
                            face={f}
                            focused={cursor === f.oref}
                            opened={opened === f.oref}
                            actions={actions}
                        />
                    ))}
                    {more > 0 || expanded || footer != null ? (
                        <div className="flex flex-wrap items-center gap-2 px-1.5 pb-0.5 pt-1 empty:hidden">
                            {more > 0 || expanded ? (
                                <button
                                    type="button"
                                    data-jarvis-initiatives-more={expanded ? "less" : "more"}
                                    onClick={onToggleMore}
                                    className="h-6 cursor-pointer rounded-[6px] border border-edge-mid bg-surface px-2 text-[11px] text-secondary hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    {expanded ? "Show less" : `+${more} more`}
                                </button>
                            ) : null}
                            {footer}
                        </div>
                    ) : null}
                </div>
            ) : (
                (empty ?? null)
            )}
        </div>
    );
}
