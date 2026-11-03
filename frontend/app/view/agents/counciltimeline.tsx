// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One seat's timeline in the Seats popover (councilseats.tsx): what the expert did, oldest first with the newest at the
// bottom, which stays in view as rows arrive. A row is the time, an icon and the word for what it did (Read, Search, Ran
// command, Proposed, Replied), its target and its result. A verify command is a verbatim machine token, so it is the one
// thing drawn in mono; a command's result is a tick or a cross with Passed or Failed beside it, and the command Go is
// running now (the last step, no result, in a council that runs) wears the working dot and the word Running. Status is
// never colour alone. Back goes to the list of seats. The rows and the words are councilmapmodel.ts's (`timelineRows`,
// `mapWords`), so they follow the council's language. Every part carries a data-council-timeline* attribute for the CDP
// scenarios council-discussion and council-map.

import { cn } from "@/util/util";
import {
    Check,
    ChevronLeft,
    FileText,
    Lightbulb,
    MessageCircle,
    Search,
    SquareTerminal,
    X,
    type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { CouncilAvatar } from "./councilchat";
import type { SeatChip } from "./councilchatmodel";
import { mapWords, timelineRows, type TimelineRow } from "./councilmapmodel";

// the icon of each kind of step; a kind the cockpit does not know is drawn as a dot
const KIND_ICON: Record<string, LucideIcon> = {
    read: FileText,
    search: Search,
    run: SquareTerminal,
    propose: Lightbulb,
    reply: MessageCircle,
};

function Result({ row, runningWord }: { row: TimelineRow; runningWord: string }) {
    if (row.running) {
        return (
            <span data-council-timeline-result="running" className="inline-flex items-center gap-[5px] text-working">
                <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-working pulse-dot" />
                {runningWord}
            </span>
        );
    }
    if (row.result === "") {
        return null;
    }
    if (row.outcome !== "") {
        const Mark = row.outcome === "pass" ? Check : X;
        return (
            <span
                data-council-timeline-result={row.outcome}
                className={cn(
                    "inline-flex items-center gap-[4px] font-semibold",
                    row.outcome === "pass" ? "text-success-soft" : "text-error-soft"
                )}
            >
                <Mark size={11} strokeWidth={2.4} aria-hidden className="flex-none" />
                {row.result}
            </span>
        );
    }
    return (
        <span data-council-timeline-result="text" className="text-muted">
            {row.result}
        </span>
    );
}

/** The body of the Seats popover when a seat's timeline is open: a way back, the seat, and its steps. */
export function CouncilTimeline({ c, chip, onBack }: { c: Council; chip: SeatChip; onBack: () => void }) {
    const words = useMemo(() => mapWords(c), [c]);
    const rows = useMemo(() => timelineRows(c, chip.id), [c, chip.id]);
    const scroller = useRef<HTMLDivElement>(null);
    // the newest step is at the bottom: keep it in view when the timeline opens and as rows arrive
    useLayoutEffect(() => {
        const el = scroller.current;
        if (el != null) {
            el.scrollTop = el.scrollHeight;
        }
    }, [rows.length, chip.id]);
    return (
        <div data-council-timeline={chip.id} data-steps={rows.length} className="flex min-h-0 flex-col">
            <div className="flex flex-none items-center gap-[6px] px-[5px] pb-[6px] pt-[5px]">
                <button
                    type="button"
                    data-council-timeline-back
                    aria-label={words.back}
                    onClick={onBack}
                    className="flex h-[26px] flex-none cursor-pointer items-center gap-[2px] rounded-[6px] border-0 bg-transparent pl-[2px] pr-[8px] text-[12px] font-semibold text-secondary outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <ChevronLeft size={14} strokeWidth={2} aria-hidden />
                    {words.back}
                </button>
            </div>
            <div className="flex flex-none items-center gap-[9px] px-3 pb-[8px]">
                <CouncilAvatar tone={chip.tone} name={chip.name} initials={chip.initials} />
                <span data-council-timeline-title className="min-w-0 truncate text-[13px] font-semibold text-primary">
                    {words.timelineOf(chip.name)}
                </span>
            </div>
            <div
                ref={scroller}
                role="list"
                data-council-timeline-list
                aria-label={words.timelineOf(chip.name)}
                className="sc flex max-h-[360px] min-h-0 flex-col gap-px overflow-y-auto border-t border-edge-faint px-[5px] py-[5px]"
            >
                {rows.length === 0 && (
                    <div data-council-timeline-empty className="px-[8px] py-[10px] text-[12.5px] text-muted">
                        {words.noSteps}
                    </div>
                )}
                {rows.map((row, i) => {
                    const Icon = KIND_ICON[row.kind];
                    return (
                        <div
                            key={`${row.ts}-${i}`}
                            role="listitem"
                            data-council-timeline-row={row.kind}
                            className="flex items-start gap-[8px] rounded-[6px] px-[8px] py-[5px] text-[12px] leading-[1.45]"
                        >
                            <span
                                data-council-timeline-time
                                className="w-[52px] flex-none pt-px tabular-nums text-muted"
                            >
                                {row.time}
                            </span>
                            <span className="flex w-[104px] flex-none items-center gap-[5px] pt-px text-secondary">
                                {Icon != null ? (
                                    <Icon size={12} strokeWidth={1.9} aria-hidden className="flex-none text-muted" />
                                ) : (
                                    <span aria-hidden className="h-[4px] w-[4px] flex-none rounded-full bg-ink-faint" />
                                )}
                                <span data-council-timeline-kind className="min-w-0 truncate">
                                    {row.kindWord}
                                </span>
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                {row.mono ? (
                                    <span
                                        data-council-timeline-command
                                        title={row.target}
                                        className="break-all font-mono text-[11.5px] text-primary"
                                    >
                                        {row.target}
                                    </span>
                                ) : (
                                    <span
                                        data-council-timeline-target
                                        title={row.target}
                                        className="break-words text-primary"
                                    >
                                        {row.target}
                                    </span>
                                )}
                                <Result row={row} runningWord={words.running} />
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
