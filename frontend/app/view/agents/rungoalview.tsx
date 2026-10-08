// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A run's goal as the run's heading, shared by the Jarvis run sheet and the Agent surface's run body.
// Collapsed it is the first paragraph, clamped to two lines. A goal that hides nothing (it fits and has one
// paragraph) is only the heading; one that does gets a Show more control, and opening it lifts the clamp and
// sets the rest below as prose. The heading keeps its size either way, so opening reads as more text rather
// than as a zoom.

import { cn } from "@/util/util";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { InlineMarkdown } from "./inlinemarkdown";
import { MarkdownMessage } from "./markdownmessage";
import { splitGoal } from "./rungoal";

// the record peek's Show more (briefpeekview.tsx BODY_LINK)
const MORE_LINK =
    "inline-flex cursor-pointer items-center gap-1 self-start text-[10.5px] text-accent-soft hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function RunGoal({
    goal,
    className,
    headingClassName,
    proseClassName,
}: {
    goal: string;
    className?: string;
    headingClassName: string;
    proseClassName: string;
}) {
    const { lead, rest } = useMemo(() => splitGoal(goal), [goal]);
    // open belongs to the goal it was opened on, so the next run's goal starts collapsed
    const [openGoal, setOpenGoal] = useState<string | null>(null);
    const open = openGoal === goal;
    const [clipped, setClipped] = useState(false);
    const leadRef = useRef<HTMLDivElement>(null);
    // measured only while clamped: open, the lead never overflows, and the control must stay to close it
    useLayoutEffect(() => {
        const el = leadRef.current;
        if (el == null || open) {
            return;
        }
        const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [lead, open]);
    const hasMore = clipped || rest !== "";
    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            <div ref={leadRef} className={cn(headingClassName, !open && "line-clamp-2")}>
                <InlineMarkdown text={lead} />
            </div>
            {open && rest !== "" ? <MarkdownMessage text={rest} className={proseClassName} /> : null}
            {hasMore ? (
                <button
                    type="button"
                    data-run-goal-toggle
                    aria-expanded={open}
                    onClick={() => setOpenGoal(open ? null : goal)}
                    className={MORE_LINK}
                >
                    {open ? "Show less" : "Show more"}
                    {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
            ) : null}
        </div>
    );
}
