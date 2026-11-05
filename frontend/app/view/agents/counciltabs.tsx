// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Report / Discussion / Map switch of a council, shared by the three views (councilsummary.tsx,
// councildiscussion.tsx, councilmap.tsx): three icon buttons in one segmented box, the one shown on a grey fill. A click
// on another opens it (showCouncil), a click on the one shown runs the view's `onCurrent` (the Report glides down to its
// body). Each tab's word is its title and aria-label, and a screen reader's text beside the icon, so the row stays short
// in any language (Vietnamese's Bản đồ included); the Discussion's carries the number of ideas sent beside its icon, the
// words in its aria-label (counciltabsmodel.ts).
//
// Each view draws its own strip, so a tab click swaps one strip for another. The strips sit in the one place, the left of
// the header row the views share (councilheader.tsx), so the grey fill slides from the tab left to the tab clicked
// (indicatorSlide): the strip on screen keeps where its tabs sit in `shown`, and the strip that replaces it reads that
// as it first renders (fillSlideFrom).

import { indicatorSlide } from "@/app/element/motiontokens";
import { cn } from "@/util/util";
import { FileText, LayoutGrid, MessagesSquare, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { showCouncil } from "./agentcenter";
import { councilTabs, fillSlideFrom, type CouncilTabId, type ShownStrip, type TabSpots } from "./counciltabsmodel";

// relative: the tabs' offsets are measured from the box. isolate: the fill (-z-10) paints over the box's own background
// and under every tab's icon and count, its neighbours' too as it slides past them
const BOX =
    "relative isolate flex flex-none items-center gap-[2px] rounded border border-border bg-surface-raised p-[3px]";

// relative and no z-index: the fill is placed on its tab, and stacks in the box, not in the button
const TAB =
    "relative flex h-[24px] items-center gap-[6px] rounded-sm border-0 bg-transparent px-[8px] outline-none focus-visible:ring-2 focus-visible:ring-accent";

const ICON: Record<CouncilTabId, LucideIcon> = { summary: FileText, discussion: MessagesSquare, map: LayoutGrid };

// the strip on screen as it last laid out, null once it has gone: a strip that mounts as another leaves (a tab click)
// reads it while the old one is still there, in its first render
let shown: ShownStrip | null = null;

export function CouncilTabs({
    c,
    view,
    onCurrent,
    className,
}: {
    c: Council;
    view: CouncilTabId;
    // a click on the tab already shown (the Report scrolls down to its body); without it that tab does nothing
    onCurrent?: () => void;
    className?: string;
}) {
    const tabs = councilTabs(c);
    const box = useRef<HTMLDivElement>(null);
    // read once, as the strip mounts: the view of a mounted strip never changes, a tab click mounts another
    const [from] = useState(() => fillSlideFrom(shown, c.id, view));
    // a tab's width moves with its count and the Map's word
    const widths = tabs.map((t) => t.label + t.badge).join("|");
    useLayoutEffect(() => {
        const el = box.current;
        if (el == null) {
            return;
        }
        const spots: TabSpots = {};
        for (const b of el.querySelectorAll<HTMLElement>("[data-council-tab]")) {
            spots[b.dataset.councilTab as CouncilTabId] = { left: b.offsetLeft, width: b.offsetWidth };
        }
        const mine: ShownStrip = { council: c.id, view, spots };
        shown = mine;
        // cleared after the commit that unmounts this strip, so only a strip mounting in that same commit reads it
        return () =>
            queueMicrotask(() => {
                if (shown === mine) {
                    shown = null;
                }
            });
    }, [c.id, view, widths]);
    return (
        <div ref={box} role="tablist" aria-label="Council view" className={cn(BOX, className)}>
            {tabs.map((tab) => {
                const Icon = ICON[tab.id];
                const on = view === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        data-council-tab={tab.id}
                        title={tab.label}
                        aria-label={tab.count !== "" ? `${tab.label} ${tab.count}` : tab.label}
                        className={cn(
                            TAB,
                            on
                                ? cn("text-primary", onCurrent != null ? "cursor-pointer" : "cursor-default")
                                : "cursor-pointer text-muted hover:text-primary"
                        )}
                        onClick={() => {
                            if (!on) {
                                showCouncil(c.id, tab.id);
                            } else {
                                onCurrent?.();
                            }
                        }}
                    >
                        {on && (
                            <motion.span
                                aria-hidden
                                data-council-tab-fill
                                initial={from == null ? false : { x: from.x, scaleX: from.scale }}
                                animate={{ x: 0, scaleX: 1 }}
                                transition={indicatorSlide}
                                style={{ originX: 0 }}
                                className="absolute inset-0 -z-10 rounded-sm bg-surface-selected"
                            />
                        )}
                        <Icon size={14} aria-hidden />
                        <span data-council-tab-label className="sr-only">
                            {tab.label}
                        </span>
                        {tab.badge !== "" && (
                            <span data-council-tab-count className="text-[11.5px] font-semibold tabular-nums">
                                {tab.badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
