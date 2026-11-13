// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's For later region (spec 2026-11-13-jarvis-later-design.md): the side column's last region, every session
// marked for later as one flat list, newest mark first. A passive list: it counts toward no badge and nags about no
// old mark. The rows are briefforlater.ts's; this draws them. A click opens the session (a live one's agent, an ended
// one's transcript, never a launch), Resume continues an ended one, Done clears the mark behind the Brief's undo.

import { cn } from "@/util/util";
import type { LaterRow, LaterSession } from "./briefforlater";
import { CURSOR_RING, cursorAttrs, FAINT_TEXT, REGION_LABEL, ROW_BORDER, SMALL_BTN } from "./briefstyle";

export const FOR_LATER_EMPTY = "Nothing marked for later.";

export function ForLaterRegion<S extends LaterSession>({
    rows,
    total,
    more,
    expanded,
    onToggle,
    cursor,
    onOpen,
    onResume,
    onDone,
}: {
    rows: LaterRow<S>[]; // the rows drawn, past the window when expanded
    total: number; // every mark the search keeps, drawn or not
    more: number; // what the window hid
    expanded: boolean;
    onToggle: () => void;
    cursor: string | undefined;
    onOpen: (row: LaterRow<S>) => void;
    onResume: (row: LaterRow<S>) => void;
    onDone: (row: LaterRow<S>) => void;
}) {
    return (
        <section data-jarvis-brief-region="later" className="flex min-w-0 flex-col gap-[9px]">
            <div className="flex items-center gap-[9px]">
                <span className={cn(REGION_LABEL, "text-ink-mid")}>For later</span>
                <span className="flex-none text-[10.5px] font-medium tabular-nums text-ink-mid">{rows.length}</span>
                <span className="h-px min-w-3 flex-1 bg-edge-faint" />
                <span className={FAINT_TEXT}>newest mark first</span>
            </div>
            <div className="flex flex-col">
                {total === 0 ? (
                    <p data-jarvis-brief-empty="later" className="m-0 text-[11.5px] text-muted">
                        {FOR_LATER_EMPTY}
                    </p>
                ) : null}
                {rows.map((r) => (
                    <LaterRowView
                        key={r.key}
                        row={r}
                        focused={cursor === r.navId}
                        onOpen={onOpen}
                        onResume={onResume}
                        onDone={onDone}
                    />
                ))}
                {more > 0 || expanded ? (
                    <button
                        type="button"
                        data-jarvis-brief-later-more={expanded ? "less" : "more"}
                        onClick={onToggle}
                        className="cursor-pointer self-start px-[11px] py-[7px] text-[10.5px] text-accent-soft hover:underline"
                    >
                        {expanded ? "show less" : `+${more} more`}
                    </button>
                ) : null}
            </div>
        </section>
    );
}

function LaterRowView<S extends LaterSession>({
    row,
    focused,
    onOpen,
    onResume,
    onDone,
}: {
    row: LaterRow<S>;
    focused: boolean;
    onOpen: (row: LaterRow<S>) => void;
    onResume: (row: LaterRow<S>) => void;
    onDone: (row: LaterRow<S>) => void;
}) {
    const live = row.session?.live === true;
    return (
        <div
            data-jarvis-brief-row="later"
            data-jarvis-later-state={live ? "live" : row.state}
            {...cursorAttrs(focused)}
            onClick={row.canOpen ? () => onOpen(row) : undefined}
            className={cn(
                "group flex items-center gap-3 py-[7px] hover:bg-surface-hover",
                ROW_BORDER,
                row.canOpen ? "cursor-pointer" : "cursor-default",
                focused && CURSOR_RING
            )}
        >
            <span
                aria-hidden
                className={cn("h-[7px] w-[7px] flex-none rounded-full", live ? "bg-working" : "bg-edge-strong")}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                    title={row.state === "looking" ? row.key : row.title}
                    className={cn(
                        "min-w-0 truncate text-[13px]",
                        row.state === "found" ? "text-ink-hi" : "text-muted",
                        row.state === "looking" && "font-mono"
                    )}
                >
                    {row.title}
                </span>
                {row.project !== "" || live ? (
                    <span className={cn("truncate", FAINT_TEXT)}>
                        {[row.project, live ? "live" : ""].filter(Boolean).join(" · ")}
                    </span>
                ) : null}
            </div>
            {row.canResume ? (
                <button
                    type="button"
                    data-jarvis-later-resume
                    onClick={(e) => {
                        e.stopPropagation();
                        onResume(row);
                    }}
                    className={cn(SMALL_BTN, "flex-none")}
                >
                    Resume
                </button>
            ) : null}
            <button
                type="button"
                data-jarvis-later-done
                title="Clear the mark"
                onClick={(e) => {
                    e.stopPropagation();
                    onDone(row);
                }}
                className={cn(SMALL_BTN, "flex-none")}
            >
                Done
            </button>
            <span title="Marked for later" className="w-8 flex-none text-right text-[11px] tabular-nums text-ink-mid">
                {row.age}
            </span>
        </div>
    );
}
