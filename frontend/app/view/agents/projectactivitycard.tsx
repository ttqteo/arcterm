// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Overview's Activity card: a GitHub-style calendar of the project's tokens per day over the last 53 weeks, its
// header and footer numbers, and a tooltip on the hovered or focused day. The cells and numbers are
// projectactivity.ts's, what is read is projectactivitystore.ts's. The grid is one focusable region (arrow keys move
// the focused day), not 371 tab stops. The footer's session count is History's, handed in by the page so the two read
// one number.

import { Skeleton, SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
    ACTIVITY_WEEKS,
    activityGrid,
    cellTooltip,
    last7Line,
    moveCell,
    plural,
    type ActivityCell,
    type ActivityLevel,
} from "./projectactivity";
import { useProjectActivity } from "./projectactivitystore";

const CELL = 14;
const GAP = 4;
const STEP = CELL + GAP;
// the weekday labels' column and its gap, ahead of the first week
const LABELS = 26 + 6;
// the months' row above the cells
const MONTHS_H = 16;

const LEVEL_CLASS: Record<ActivityLevel, string> = {
    0: "bg-edge-mid",
    1: "bg-accent-700",
    2: "bg-accent-500",
    3: "bg-accent-300",
    4: "bg-accent-100",
};
const NO_RECORD_CLASS = "border border-dashed border-edge-strong";
const SMALL_BTN =
    "h-[26px] flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[12px] text-secondary hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function cellClass(cell: ActivityCell, active: boolean): string {
    return cn(
        "box-border size-[14px] rounded-[3px]",
        cell.none ? NO_RECORD_CLASS : LEVEL_CLASS[cell.level],
        active ? "ring-[1.5px] ring-primary" : cell.today ? "ring-1 ring-muted" : ""
    );
}

// where a tooltip sits against its cell: above it, or below for the top rows (the scroller clips what rises past it),
// and shifted off the card's edges so it stays inside
function tipPlace(cell: ActivityCell): { left: number; top: number; className: string } {
    const x = LABELS + cell.col * STEP;
    const y = MONTHS_H + cell.weekday * STEP;
    const below = cell.weekday < 3;
    const h = cell.col < 8 ? "" : cell.col >= ACTIVITY_WEEKS - 9 ? "-translate-x-full" : "-translate-x-1/2";
    return {
        left: cell.col < 8 ? x : cell.col >= ACTIVITY_WEEKS - 9 ? x + CELL : x + CELL / 2,
        top: below ? y + CELL + 6 : y - 6,
        className: cn(h, below ? "" : "-translate-y-full"),
    };
}

function Header({ summary }: { summary: ReactNode }) {
    return (
        <div className="flex items-baseline gap-3">
            <h2 className="text-[11px] font-semibold text-muted">Activity</h2>
            {summary}
            <span className="flex-1" />
            <span className="text-[11px] text-ink-faint">Tokens per day</span>
        </div>
    );
}

function Loading() {
    return (
        <div data-activity-loading aria-busy="true" className="flex flex-col gap-[10px]">
            <Header summary={<SkeletonLine className="h-[12px] w-[220px]" />} />
            <div className="overflow-hidden" style={{ paddingTop: MONTHS_H }}>
                <div className="flex min-w-max" style={{ gap: 6, paddingLeft: LABELS - 6 }}>
                    <div className="flex" style={{ gap: GAP }}>
                        {Array.from({ length: ACTIVITY_WEEKS }, (_, w) => (
                            <div key={w} className="flex flex-col" style={{ gap: GAP }}>
                                {Array.from({ length: 7 }, (_, d) => (
                                    <Skeleton key={d} className="size-[14px] rounded-[3px]" />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// memo: the page re-renders on the app's one-second clock, and the card's ~371 cells need not follow
export const ActivityCard = memo(function ActivityCard({ path, sessions }: { path: string; sessions: number | null }) {
    const act = useProjectActivity(path);
    const grid = useMemo(() => (act.rtn == null ? null : activityGrid(act.rtn, new Date())), [act.rtn]);
    const [hover, setHover] = useState<number | null>(null);
    const [cursor, setCursor] = useState<number | null>(null);
    const [focused, setFocused] = useState(false);
    const scroller = useRef<HTMLDivElement>(null);

    // a narrow card scrolls: start at the right end, where today is
    useEffect(() => {
        const el = scroller.current;
        if (el != null) {
            el.scrollLeft = el.scrollWidth;
        }
    }, [grid]);

    const section =
        "flex flex-col gap-[10px] rounded-[8px] border border-edge-mid bg-surface-raised px-[18px] pb-3 pt-[14px]";
    if (act.error != null) {
        return (
            <section data-activity-card aria-label="Activity" className={section}>
                <Header summary={null} />
                <div data-activity-error className="flex items-center gap-3 text-[12px] text-muted">
                    <span className="min-w-0 truncate">Could not read the activity: {act.error}</span>
                    <button type="button" data-activity-retry onClick={act.retry} className={SMALL_BTN}>
                        Retry
                    </button>
                </div>
            </section>
        );
    }
    if (grid == null) {
        return (
            <section data-activity-card aria-label="Activity" className={section}>
                <Loading />
            </section>
        );
    }

    const cells = grid.cells;
    const last = cells.length - 1;
    const cursorAt = cursor ?? last;
    const shown = hover ?? (focused ? cursorAt : null);
    const shownCell = shown == null ? null : cells[shown];
    const tip = shownCell == null ? null : cellTooltip(shownCell);
    const place = shownCell == null ? null : tipPlace(shownCell);
    const cellIndex = (e: MouseEvent): number | null => {
        const at = (e.target as HTMLElement).closest<HTMLElement>("[data-activity-cell]");
        return at == null ? null : Number(at.dataset.index);
    };
    const onKeyDown = (e: KeyboardEvent) => {
        const to = moveCell(cursorAt, e.key, cells.length);
        if (to != null) {
            e.preventDefault();
            setCursor(to);
            setHover(null);
        }
    };
    const weeks = Array.from({ length: ACTIVITY_WEEKS }, (_, w) => cells.slice(w * 7, w * 7 + 7));

    return (
        <section data-activity-card aria-label="Activity" className={section}>
            <Header
                summary={
                    <span data-activity-summary className="text-[12px] tabular-nums text-secondary">
                        {grid.summary}
                    </span>
                }
            />
            <div ref={scroller} className="overflow-x-auto">
                <div className="relative min-w-max" style={{ paddingTop: MONTHS_H }}>
                    {grid.months.map((m) => (
                        <span
                            key={m.col}
                            data-activity-month={m.label}
                            className="absolute top-0 text-[10px] text-muted"
                            style={{ left: LABELS + m.col * STEP }}
                        >
                            {m.label}
                        </span>
                    ))}
                    <div className="flex gap-[6px]">
                        <div
                            className="flex w-[26px] flex-none flex-col text-[10px] text-ink-faint"
                            style={{ gap: GAP }}
                        >
                            {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
                                <span key={i} className="h-[14px] leading-[14px]">
                                    {l}
                                </span>
                            ))}
                        </div>
                        <div
                            role="group"
                            tabIndex={0}
                            aria-label="Tokens per day, arrow keys move between days"
                            aria-activedescendant={focused ? `activity-cell-${cells[cursorAt].day}` : undefined}
                            onKeyDown={onKeyDown}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setFocused(false)}
                            onMouseOver={(e) => {
                                const i = cellIndex(e);
                                if (i != null) {
                                    setHover(i); // the gaps between cells keep the last one
                                }
                            }}
                            onMouseLeave={() => setHover(null)}
                            onMouseDown={(e) => {
                                const i = cellIndex(e);
                                if (i != null) {
                                    setCursor(i);
                                }
                            }}
                            className="flex focus-visible:outline-none"
                            style={{ gap: GAP }}
                        >
                            {weeks.map((week, w) => (
                                <div key={w} className="flex flex-col" style={{ gap: GAP }}>
                                    {week.map((cell) => {
                                        const i = cell.col * 7 + cell.weekday;
                                        const active = i === shown;
                                        return (
                                            <div
                                                key={cell.day}
                                                id={`activity-cell-${cell.day}`}
                                                data-activity-cell={cell.day}
                                                data-index={i}
                                                data-level={cell.none ? "none" : cell.level}
                                                data-today={cell.today ? "" : undefined}
                                                data-activity-focused={focused && i === cursorAt ? "" : undefined}
                                                role={active && tip != null ? "img" : undefined}
                                                aria-label={
                                                    active && tip != null ? `${tip.title}, ${tip.line}` : undefined
                                                }
                                                className={cellClass(cell, active)}
                                            />
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                    {tip != null && place != null ? (
                        <div
                            role="tooltip"
                            data-activity-tip
                            className={cn(
                                "pointer-events-none absolute z-10 flex flex-col gap-[2px] whitespace-nowrap rounded-[8px] border border-edge-strong bg-surface-hover px-[10px] py-[7px] shadow-popover-sm",
                                place.className
                            )}
                            style={{ left: place.left, top: place.top }}
                        >
                            <span className="text-[12px] font-semibold text-primary">{tip.title}</span>
                            <span className="text-[12px] tabular-nums text-secondary">{tip.line}</span>
                        </div>
                    ) : null}
                </div>
            </div>
            <div
                data-activity-footer
                className="flex flex-wrap items-center gap-x-[14px] gap-y-2 pt-[2px] text-[12px] text-muted"
            >
                <span>
                    Last 7 days: <span className="text-secondary">{last7Line(grid.last7.tokens, sessions)}</span>
                </span>
                <span className="flex items-center gap-[7px]">
                    <span aria-hidden className="mx-px size-[7px] rotate-45 bg-mark-run" />
                    {plural(grid.last7.runs, "run")}
                </span>
                <span className="flex items-center gap-[7px]">
                    <span aria-hidden className="size-2 rounded-full bg-mark-council" />
                    {plural(grid.last7.councils, "council")}
                </span>
                <span className="flex-1" />
                <span data-activity-legend className="flex items-center gap-1 text-[10px] text-ink-faint">
                    <span className="mr-1">Less</span>
                    {([0, 1, 2, 3, 4] as const).map((l) => (
                        <span key={l} className={cn("size-3 rounded-[3px]", LEVEL_CLASS[l])} />
                    ))}
                    <span className="ml-1">More</span>
                    <span className={cn("ml-[10px] box-border size-3 rounded-[3px]", NO_RECORD_CLASS)} />
                    <span className="ml-1">No record</span>
                </span>
            </div>
        </section>
    );
});
